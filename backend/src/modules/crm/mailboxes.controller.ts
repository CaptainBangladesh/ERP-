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
import {
  CRM_ROUTE,
  type ConnectMailboxUrlResponse,
  type MailboxConnectionListResponse,
  type MailboxConnectionSummary,
  type MailboxProvider,
} from '@erp/shared';
import { CurrentSession, Public, type RequestSession } from '../../platform/auth';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import { MailboxesService } from './mailboxes.service';
import { CreateConnectUrlBody } from './schemas';

@Controller(CRM_ROUTE)
export class MailboxesController {
  constructor(private readonly mailboxesService: MailboxesService) {}

  @Post('mailboxes/connect-url')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('crm:leads:read')
  async createConnectUrl(
    @CurrentSession() session: RequestSession,
    @Body(validated(CreateConnectUrlBody)) body: Valid<typeof CreateConnectUrlBody>,
  ): Promise<ConnectMailboxUrlResponse> {
    return this.mailboxesService.createConnectUrl(body.provider as MailboxProvider, {
      userId: session.user.id,
    });
  }

  @Public()
  @Get('mailboxes/callback')
  async handleCallback(
    @Query() query: Record<string, unknown>,
  ): Promise<{ success: boolean; mailboxId: string }> {
    const state = typeof query.state === 'string' ? query.state : '';
    const code = typeof query.code === 'string' ? query.code : 'mock_code';
    return this.mailboxesService.handleOAuthCallback(state, code);
  }

  @Get('mailboxes')
  @RequirePermission('crm:leads:read')
  async listMailboxes(
    @CurrentSession() session: RequestSession,
  ): Promise<MailboxConnectionListResponse> {
    const items = await this.mailboxesService.listMailboxes(session.user.id);
    return { items };
  }

  @Post('mailboxes/:id/revoke')
  @RequirePermission('crm:leads:read')
  @HttpCode(HttpStatus.OK)
  async disconnectMailbox(
    @Param('id') id: string,
  ): Promise<MailboxConnectionSummary> {
    return this.mailboxesService.disconnectMailbox(id);
  }
}
