import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import type { SocialInboxWebhookResponse } from '@erp/shared';
import { Public } from '../../platform/auth';
import { InjectPrisma, type ScopedPrisma, Tenancy } from '../../platform/tenancy';
import { Valid, validated } from '../../platform/validation';
import { InboxService } from './inbox.service';
import { SocialInboxWebhookBody } from './schemas';

@Controller('api/marketing/webhooks/social-inbox')
export class SocialInboxWebhooksController {
  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly tenancy: Tenancy,
    private readonly inboxService: InboxService,
  ) {}

  /**
   * Webhook verification challenge (Meta/Instagram Messenger verification handshake).
   */
  @Public()
  @Get(':platform')
  verifyWebhook(
    @Param('platform') platform: string,
    @Query() query: Record<string, unknown>,
  ): string {
    const mode = typeof query['hub.mode'] === 'string' ? query['hub.mode'] : undefined;
    const challenge = typeof query['hub.challenge'] === 'string' ? query['hub.challenge'] : undefined;
    if (mode === 'subscribe' && challenge) {
      return challenge;
    }
    return challenge || `Verified ${platform} webhook endpoint`;
  }

  /**
   * Ingests incoming direct messages / comments from Meta, Instagram, X (Twitter), or direct simulation.
   */
  @Public()
  @Post(':platform')
  @HttpCode(HttpStatus.OK)
  async handleSocialInboxWebhook(
    @Param('platform') platform: string,
    @Body(validated(SocialInboxWebhookBody)) body: Valid<typeof SocialInboxWebhookBody>,
    @Query() query: Record<string, unknown>,
  ): Promise<SocialInboxWebhookResponse> {
    const rawBody = body as Record<string, any>;
    const normalizedPlatform = platform.toLowerCase();

    // 1. Extract message content and sender across platforms
    let senderId: string | undefined = rawBody.senderId;
    let senderName: string | undefined = rawBody.senderName;
    let senderAvatar: string | undefined = rawBody.senderAvatar;
    let recipientId: string | undefined = rawBody.recipientId;
    let content: string | undefined = rawBody.content || rawBody.text || rawBody.message;
    let conversationId: string | undefined = rawBody.conversationId;

    // Meta (Instagram / Messenger) webhook format
    if (Array.isArray(rawBody.entry) && rawBody.entry.length > 0) {
      const entry = rawBody.entry[0];
      if (Array.isArray(entry.messaging) && entry.messaging.length > 0) {
        const msgEvent = entry.messaging[0];
        senderId = msgEvent.sender?.id || senderId;
        recipientId = msgEvent.recipient?.id || recipientId;
        content = msgEvent.message?.text || content;
        conversationId = conversationId || `${normalizedPlatform}_${senderId}`;
      } else if (Array.isArray(entry.changes) && entry.changes.length > 0) {
        // Comment or feed change
        const change = entry.changes[0];
        const val = change.value;
        if (val) {
          senderId = val.from?.id || val.user_id || senderId;
          senderName = val.from?.name || val.username || senderName;
          content = val.text || val.message || content;
          conversationId = conversationId || val.comment_id || `${normalizedPlatform}_${senderId}`;
        }
      }
    }

    // X (Twitter) Direct Message format
    if (Array.isArray(rawBody.direct_message_events) && rawBody.direct_message_events.length > 0) {
      const dmEvent = rawBody.direct_message_events[0];
      if (dmEvent.message_create) {
        senderId = dmEvent.message_create.sender_id || senderId;
        recipientId = dmEvent.message_create.target?.recipient_id || recipientId;
        content = dmEvent.message_create.message_data?.text || content;
        conversationId = conversationId || `x_${senderId}`;
      }
    }

    // Fallbacks
    senderId = senderId || 'unknown_sender';
    conversationId = conversationId || `thread_${senderId}`;
    if (!content) {
      return {
        received: false,
        platform: normalizedPlatform,
      };
    }

    // 2. Resolve Brand and Company
    const requestedBrandId = (typeof query.brandId === 'string' ? query.brandId : undefined) || body.brandId;
    const requestedCompanyId = (typeof query.companyId === 'string' ? query.companyId : undefined) || (body as Record<string, any>).companyId;

    let targetCompanyId = requestedCompanyId;
    let targetBrandId = requestedBrandId;
    let targetAccountId: string | null = null;

    if (!targetCompanyId || !targetBrandId) {
      const resolved = await this.tenancy.withoutCompanyScope(
        'marketing.inbox_webhooks.brand_lookup',
        async () => {
          if (requestedBrandId) {
            const b = await this.prisma.marketingBrand.findUnique({
              where: { id: requestedBrandId },
            });
            if (b) return { brand: b, accountId: null };
          }

          // Match by recipientId matching socialAccount.platformAccountId
          if (recipientId) {
            const acc = await this.prisma.socialAccount.findFirst({
              where: { platformAccountId: recipientId },
              include: { brand: true },
            });
            if (acc?.brand) {
              return { brand: acc.brand, accountId: acc.id };
            }
          }

          // Match by platform
          const accByPlatform = await this.prisma.socialAccount.findFirst({
            where: { platform: { contains: normalizedPlatform, mode: 'insensitive' } },
            include: { brand: true },
          });
          if (accByPlatform?.brand) {
            return { brand: accByPlatform.brand, accountId: accByPlatform.id };
          }

          // Fallback to first brand
          const firstBrand = await this.prisma.marketingBrand.findFirst();
          return firstBrand ? { brand: firstBrand, accountId: null } : null;
        },
      );

      if (resolved) {
        targetCompanyId = targetCompanyId || resolved.brand.companyId;
        targetBrandId = targetBrandId || resolved.brand.id;
        targetAccountId = resolved.accountId;
      }
    }

    if (!targetCompanyId || !targetBrandId) {
      return {
        received: false,
        platform: normalizedPlatform,
      };
    }

    // 3. Process incoming message inside company scope
    return this.tenancy.runInCompany(
      { companyId: targetCompanyId, grants: 'all' },
      async () => {
        const result = await this.inboxService.receiveInboundMessage({
          brandId: targetBrandId!,
          socialAccountId: targetAccountId,
          conversationId: conversationId!,
          senderId: senderId!,
          senderName: senderName || `User ${senderId!.slice(0, 8)}`,
          senderAvatar,
          content: content!,
          metadata: {
            platform: normalizedPlatform,
            recipientId,
            raw: body,
          },
        });

        return {
          received: true,
          platform: normalizedPlatform,
          messageId: result.inboundMessage.id,
          autoReplied: !!result.autoReplyMessage,
          flowId: result.flowId,
        };
      },
    );
  }
}
