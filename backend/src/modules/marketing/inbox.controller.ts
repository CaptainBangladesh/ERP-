import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type {
  ConvertConversationToLeadResponse,
  SocialConversationListResponse,
  SocialMessageListResponse,
  SocialMessageResponse,
  SocialMessageStatus,
} from '@erp/shared';
import { RequirePermission } from '../../platform/authorization';
import { Valid, validated } from '../../platform/validation';
import { InboxService } from './inbox.service';
import {
  ConvertConversationToLeadBody,
  SendReplyMessageBody,
  UpdateSocialMessageStatusBody,
} from './schemas';

@Controller('api/marketing/inbox')
export class InboxController {
  constructor(private readonly inboxService: InboxService) {}

  @Get('messages')
  @RequirePermission('marketing:inbox:read')
  async listMessages(@Query() query: Record<string, unknown>): Promise<SocialMessageListResponse> {
    return this.inboxService.listMessages(query);
  }

  @Get('conversations')
  @RequirePermission('marketing:inbox:read')
  async listConversations(
    @Query() query: Record<string, unknown>,
  ): Promise<SocialConversationListResponse> {
    const brandId = typeof query.brandId === 'string' ? query.brandId : '';
    const status = typeof query.status === 'string' ? query.status : undefined;
    return this.inboxService.listConversations(brandId, status);
  }

  @Get('conversations/:conversationId/messages')
  @RequirePermission('marketing:inbox:read')
  async getConversationMessages(
    @Param('conversationId') conversationId: string,
    @Query() query: Record<string, unknown>,
  ): Promise<SocialMessageListResponse> {
    const brandId = typeof query.brandId === 'string' ? query.brandId : '';
    return this.inboxService.getConversationMessages(brandId, conversationId);
  }

  @Post('reply')
  @RequirePermission('marketing:inbox:write')
  async sendReply(
    @Body(validated(SendReplyMessageBody)) body: Valid<typeof SendReplyMessageBody>,
  ): Promise<SocialMessageResponse> {
    return this.inboxService.sendOutboundReply(body);
  }

  @Patch('messages/:id/status')
  @RequirePermission('marketing:inbox:write')
  async updateMessageStatus(
    @Param('id') id: string,
    @Body(validated(UpdateSocialMessageStatusBody)) body: Valid<typeof UpdateSocialMessageStatusBody>,
  ): Promise<SocialMessageResponse> {
    return this.inboxService.updateMessageStatus(id, body.status as SocialMessageStatus);
  }

  @Patch('conversations/:conversationId/status')
  @RequirePermission('marketing:inbox:write')
  async updateConversationStatus(
    @Param('conversationId') conversationId: string,
    @Query() query: Record<string, unknown>,
    @Body(validated(UpdateSocialMessageStatusBody)) body: Valid<typeof UpdateSocialMessageStatusBody>,
  ): Promise<{ success: boolean; updatedCount: number }> {
    const brandId = typeof query.brandId === 'string' ? query.brandId : '';
    return this.inboxService.updateConversationStatus(
      brandId,
      conversationId,
      body.status as SocialMessageStatus,
    );
  }

  @Post('convert-to-lead')
  @RequirePermission('marketing:inbox:write')
  async convertToLead(
    @Body(validated(ConvertConversationToLeadBody)) body: Valid<typeof ConvertConversationToLeadBody>,
  ): Promise<ConvertConversationToLeadResponse> {
    return this.inboxService.convertConversationToLead(body);
  }
}
