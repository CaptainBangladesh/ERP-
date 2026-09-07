import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ApiException } from '../../http/api-exception';
import { Prisma } from '@prisma/client';
import {
  MARKETING_ERROR_CODES,
  type ConvertConversationToLeadResponse,
  type SocialConversationListResponse,
  type SocialConversationSummary,
  type SocialMessageDirection,
  type SocialMessageListResponse,
  type SocialMessageResponse,
  type SocialMessageStatus,
  type SocialMessageSummary,
} from '@erp/shared';
import { listQuery } from '../../platform/list';
import { companyApplied, InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import { Valid } from '../../platform/validation';
import { CrmLeadIntake } from '../crm';
import {
  ConvertConversationToLeadBody,
  CreateSocialMessageBody,
  SendReplyMessageBody,
  SOCIAL_MESSAGE_LIST,
} from './schemas';
import { DmFlowsService } from './dm-flows.service';
import { CrmBridgeService } from './crm-bridge.service';

const INBOX_SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000001';
const INBOX_SYSTEM_USER_NAME = 'Social Inbox CRM Bridge';

export function toSocialMessageSummary(m: {
  id: string;
  brandId: string;
  socialAccountId: string | null;
  conversationId: string;
  senderId: string;
  senderName: string | null;
  senderAvatar: string | null;
  recipientId: string | null;
  content: string;
  direction: string;
  status: string;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
}): SocialMessageSummary {
  return {
    id: m.id,
    brandId: m.brandId,
    socialAccountId: m.socialAccountId,
    conversationId: m.conversationId,
    senderId: m.senderId,
    senderName: m.senderName,
    senderAvatar: m.senderAvatar,
    recipientId: m.recipientId,
    content: m.content,
    direction: m.direction as SocialMessageDirection,
    status: m.status as SocialMessageStatus,
    metadata: m.metadata && typeof m.metadata === 'object' ? (m.metadata as Record<string, unknown>) : null,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);

  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly dmFlows: DmFlowsService,
    private readonly crmBridge: CrmBridgeService,
    private readonly crm: CrmLeadIntake,
  ) {}

  async listMessages(query: Record<string, unknown>): Promise<SocialMessageListResponse> {
    const slice = listQuery(query, SOCIAL_MESSAGE_LIST);
    const [items, total] = await Promise.all([
      this.prisma.socialMessage.findMany({
        ...slice.findMany<Prisma.SocialMessageFindManyArgs>(),
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.socialMessage.count(slice.count<Prisma.SocialMessageCountArgs>()),
    ]);

    return slice.respond(items.map(toSocialMessageSummary), total);
  }

  async listConversations(
    brandId: string,
    filterStatus?: string,
  ): Promise<SocialConversationListResponse> {
    const where: Prisma.SocialMessageWhereInput = { brandId };
    if (filterStatus && filterStatus !== 'all') {
      where.status = filterStatus;
    }

    const messages = await this.prisma.socialMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        socialAccount: true,
      },
    });

    // Group by conversationId
    const groups = new Map<string, typeof messages>();
    for (const msg of messages) {
      const existing = groups.get(msg.conversationId);
      if (existing) {
        existing.push(msg);
      } else {
        groups.set(msg.conversationId, [msg]);
      }
    }

    const conversations: SocialConversationSummary[] = [];
    for (const [conversationId, groupMessages] of groups.entries()) {
      if (!groupMessages || groupMessages.length === 0) continue;
      // Latest message is first because sorted by createdAt DESC
      const latest = groupMessages[0];
      if (!latest) continue;
      const inboundMessages = groupMessages.filter((m) => m.direction === 'inbound');
      const latestInbound = inboundMessages[0] || latest;
      const unreadCount = groupMessages.filter((m) => m.status === 'unread').length;

      // Determine platform from socialAccount or metadata
      const platform =
        latest.socialAccount?.platform ||
        (latest.metadata as any)?.platform ||
        'social';

      conversations.push({
        conversationId,
        brandId: latest.brandId,
        socialAccountId: latest.socialAccountId,
        senderId: latestInbound.senderId,
        senderName: latestInbound.senderName || latestInbound.senderId,
        senderAvatar: latestInbound.senderAvatar,
        platform,
        latestMessageContent: latest.content,
        latestMessageAt: latest.createdAt.toISOString(),
        unreadCount,
        totalMessages: groupMessages.length,
        status: latest.status as SocialMessageStatus,
      });
    }

    // Sort by latest message date descending
    conversations.sort(
      (a, b) => new Date(b.latestMessageAt).getTime() - new Date(a.latestMessageAt).getTime(),
    );

    return {
      items: conversations,
      page: {
        number: 1,
        size: conversations.length,
        total: conversations.length,
        pages: 1,
      },
    };
  }

  async getConversationMessages(
    brandId: string,
    conversationId: string,
  ): Promise<SocialMessageListResponse> {
    const items = await this.prisma.socialMessage.findMany({
      where: { brandId, conversationId },
      orderBy: { createdAt: 'asc' },
    });

    return {
      items: items.map(toSocialMessageSummary),
      page: {
        number: 1,
        size: items.length,
        total: items.length,
        pages: 1,
      },
    };
  }

  /**
   * Ingests an incoming message, saves it as an inbound SocialMessage,
   * evaluates against DmAutomationFlow keyword rules, and automatically
   * generates and stores an outbound reply if a keyword matches.
   */
  async receiveInboundMessage(input: {
    brandId: string;
    socialAccountId?: string | null;
    conversationId: string;
    senderId: string;
    senderName?: string | null;
    senderAvatar?: string | null;
    content: string;
    metadata?: Record<string, unknown>;
  }): Promise<{
    inboundMessage: SocialMessageResponse;
    autoReplyMessage: SocialMessageResponse | null;
    flowId?: string;
  }> {
    const inbound = await this.prisma.socialMessage.create({
      data: companyApplied<Prisma.SocialMessageUncheckedCreateInput>({
        brandId: input.brandId,
        socialAccountId: input.socialAccountId ?? null,
        conversationId: input.conversationId,
        senderId: input.senderId,
        senderName: input.senderName ?? input.senderId,
        senderAvatar: input.senderAvatar ?? null,
        content: input.content,
        direction: 'inbound',
        status: 'unread',
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      }),
    });

    let autoReply: SocialMessageResponse | null = null;
    let flowId: string | undefined;

    // Check for keyword trigger flows
    try {
      const evaluation = await this.dmFlows.evaluateMessage(
        input.brandId,
        input.content,
        input.socialAccountId,
      );

      if (evaluation) {
        flowId = evaluation.flow.id;
        const createdReply = await this.prisma.socialMessage.create({
          data: companyApplied<Prisma.SocialMessageUncheckedCreateInput>({
            brandId: input.brandId,
            socialAccountId: input.socialAccountId ?? null,
            conversationId: input.conversationId,
            senderId: 'automation_assistant',
            senderName: 'Automation Assistant',
            recipientId: input.senderId,
            content: evaluation.replyText,
            direction: 'outbound',
            status: 'resolved',
            metadata: {
              autoReply: true,
              flowId: evaluation.flow.id,
              flowName: evaluation.flow.name,
              leadMagnetUrl: evaluation.flow.leadMagnetUrl,
            } as Prisma.InputJsonValue,
          }),
        });

        autoReply = toSocialMessageSummary(createdReply);
        this.logger.log(
          `Auto-replied to conversation ${input.conversationId} via flow '${evaluation.flow.name}'`,
        );
      }
    } catch (err) {
      this.logger.warn(`Failed evaluating DM flow: ${(err as Error).message}`);
    }

    return {
      inboundMessage: toSocialMessageSummary(inbound),
      autoReplyMessage: autoReply,
      flowId,
    };
  }

  async sendOutboundReply(
    input: Valid<typeof SendReplyMessageBody>,
  ): Promise<SocialMessageResponse> {
    // Determine platform from socialAccountId or previous messages in conversation
    let platform: string | null = null;
    if (input.socialAccountId && typeof this.prisma.socialAccount?.findUnique === 'function') {
      const account = await this.prisma.socialAccount.findUnique({
        where: { id: input.socialAccountId },
      });
      if (account) platform = account.platform;
    }

    const latestInbound =
      typeof this.prisma.socialMessage?.findFirst === 'function'
        ? await this.prisma.socialMessage.findFirst({
            where: {
              brandId: input.brandId,
              conversationId: input.conversationId,
              direction: 'inbound',
            },
            orderBy: { createdAt: 'desc' },
            include: { socialAccount: true },
          })
        : null;

    if (!platform && latestInbound?.socialAccount) {
      platform = latestInbound.socialAccount.platform;
    }

    const metadata: Record<string, unknown> = {
      manualReply: true,
    };

    if (platform === 'instagram' || platform === 'facebook') {
      if (latestInbound) {
        const elapsedHours =
          (Date.now() - latestInbound.createdAt.getTime()) / (1000 * 60 * 60);
        if (elapsedHours > 24) {
          if (input.humanAgentTag) {
            if (elapsedHours > 24 * 7) {
              throw new ApiException(
                MARKETING_ERROR_CODES.messagingWindowExpired,
                'Outbound DM messaging window expired: Meta 7-day human agent window has passed.',
                HttpStatus.UNPROCESSABLE_ENTITY,
              );
            }
            metadata.humanAgentTag = true;
            metadata.tag = 'HUMAN_AGENT';
          } else {
            throw new ApiException(
              MARKETING_ERROR_CODES.messagingWindowExpired,
              'Outbound DM messaging window expired: Meta requires user interaction within 24 hours. Use the HUMAN_AGENT tag for inquiries up to 7 days.',
              HttpStatus.UNPROCESSABLE_ENTITY,
            );
          }
        }
      }
    }

    const created = await this.prisma.socialMessage.create({
      data: companyApplied<Prisma.SocialMessageUncheckedCreateInput>({
        brandId: input.brandId,
        socialAccountId: input.socialAccountId ?? null,
        conversationId: input.conversationId,
        senderId: 'team_operator',
        senderName: input.senderName || 'Support Agent',
        recipientId: input.recipientId ?? null,
        content: input.content,
        direction: 'outbound',
        status: 'pending',
        metadata: metadata as Prisma.InputJsonValue,
      }),
    });

    return toSocialMessageSummary(created);
  }

  async updateMessageStatus(
    id: string,
    status: SocialMessageStatus,
  ): Promise<SocialMessageResponse> {
    const existing = await this.prisma.socialMessage.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiException('social_message_not_found', 'Message not found.', HttpStatus.NOT_FOUND);
    }

    const updated = await this.prisma.socialMessage.update({
      where: { id },
      data: { status },
    });

    return toSocialMessageSummary(updated);
  }

  async updateConversationStatus(
    brandId: string,
    conversationId: string,
    status: SocialMessageStatus,
  ): Promise<{ success: boolean; updatedCount: number }> {
    const res = await this.prisma.socialMessage.updateMany({
      where: { brandId, conversationId },
      data: { status },
    });

    return { success: true, updatedCount: res.count };
  }

  /**
   * Converts an active social inbox conversation into a CRM Lead.
   * Compiles the conversation history, calls CrmBridgeService.handoffLead,
   * attaches transcript to CRM Activity timeline, and marks conversation resolved.
   */
  async convertConversationToLead(
    input: Valid<typeof ConvertConversationToLeadBody>,
  ): Promise<ConvertConversationToLeadResponse> {
    const messages = await this.prisma.socialMessage.findMany({
      where: { brandId: input.brandId, conversationId: input.conversationId },
      orderBy: { createdAt: 'asc' },
    });

    if (messages.length === 0) {
      throw new ApiException('social_conversation_not_found', 'Conversation not found.', HttpStatus.NOT_FOUND);
    }

    // Extract details or best defaults
    const inbound = messages.find((m) => m.direction === 'inbound') || messages[0];
    if (!inbound) {
      throw new ApiException('social_message_not_found', 'No messages found in conversation.', HttpStatus.NOT_FOUND);
    }
    let leadName = input.name?.trim() || inbound.senderName?.trim();
    if (!leadName || leadName === inbound.senderId) {
      leadName = `Social Lead (${input.conversationId.slice(0, 8)})`;
    }

    // Scan conversation text for email if not explicitly provided
    let leadEmail = input.email?.trim();
    if (!leadEmail) {
      const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/;
      for (const msg of messages) {
        const match = msg.content.match(emailRegex);
        if (match) {
          leadEmail = match[1];
          break;
        }
      }
    }

    // Scan conversation text for phone if not provided
    let leadPhone = input.phone?.trim();
    if (!leadPhone) {
      const phoneRegex = /(\+?[0-9]{1,3}[-.\s]?)?(\(?\d{3}\)?[-.\s]?)[\d]{3}[-.\s]?\d{4}/;
      for (const msg of messages) {
        const match = msg.content.match(phoneRegex);
        if (match) {
          leadPhone = match[0].trim();
          break;
        }
      }
    }

    // Compile conversation transcript
    const transcript = messages
      .map(
        (m) =>
          `[${m.direction.toUpperCase()} | ${m.createdAt.toISOString()}] ${
            m.senderName || m.senderId
          }: ${m.content}`,
      )
      .join('\n');

    // 1. Hand off lead to CRM
    const handoffResult = await this.crmBridge.handoffLead({
      name: leadName,
      email: leadEmail,
      phone: leadPhone,
      organisationName: input.organisationName?.trim(),
      sourceName: 'Social Inbox DM Conversation',
      brandId: input.brandId,
      customFields: {
        conversationId: input.conversationId,
        socialAccountId: messages[0]?.socialAccountId ?? undefined,
        totalMessages: messages.length,
      },
      utm: {
        source: 'social_inbox',
        medium: 'direct_message',
        campaign: 'dm_lead_handoff',
      },
      rawPayload: {
        conversationId: input.conversationId,
        messagesCount: messages.length,
      },
    });

    // 2. Attach the full conversation transcript to the lead's CRM timeline.
    //
    // Through the same surface the form and ad-webhook paths use. There was a second path here
    // — a direct `activity.create` on the CRM's table — and a boundary with two doors is a
    // boundary that will grow a third.
    try {
      await this.crm.appendInboundActivity(
        {
          leadId: handoffResult.leadId,
          notes: `Social DM Conversation History (Thread: ${input.conversationId}):\n\n${transcript}`,
        },
        { userId: INBOX_SYSTEM_USER_ID, name: INBOX_SYSTEM_USER_NAME },
      );
    } catch (err) {
      this.logger.warn(`Could not attach transcript to the CRM timeline: ${(err as Error).message}`);
    }

    // 3. Mark conversation messages as resolved
    await this.prisma.socialMessage.updateMany({
      where: { brandId: input.brandId, conversationId: input.conversationId },
      data: { status: 'resolved' },
    });

    return {
      success: true,
      leadId: handoffResult.leadId,
      isNewLead: handoffResult.isNew,
      conversationId: input.conversationId,
      messageCount: messages.length,
      leadName: handoffResult.lead.name,
    };
  }
}
