import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  CRM_ROUTE,
  type LeadGuidanceResponse,
  type PlaybookEnrollmentSummary,
  type PlaybookListResponse,
  type PlaybookResponse,
} from '@erp/shared';
import { CurrentSession, type RequestSession } from '../../platform/auth';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import { PlaybooksService } from './playbooks.service';
import { CreatePlaybookBody, EnrollPlaybookBody, UpdatePlaybookBody } from './schemas';

/**
 * Two audiences, one subject. Authoring plays is manager-gated (`crm:playbooks:write`); reading
 * the guidance on a lead and walking a lead through a play is the rep's work, gated by
 * `crm:leads:read`/`crm:leads:write`.
 */
@Controller(CRM_ROUTE)
export class PlaybooksController {
  constructor(private readonly playbooksService: PlaybooksService) {}

  // ─── authoring ────────────────────────────────────────────────────────────────────

  @Get('playbooks')
  @RequirePermission('crm:leads:read')
  async listPlaybooks(): Promise<PlaybookListResponse> {
    const items = await this.playbooksService.list();
    return { items };
  }

  @Get('playbooks/:id')
  @RequirePermission('crm:leads:read')
  async getPlaybook(@Param('id') id: string): Promise<PlaybookResponse> {
    return this.playbooksService.get(id);
  }

  @Post('playbooks')
  @RequirePermission('crm:playbooks:write')
  async createPlaybook(
    @CurrentSession() session: RequestSession,
    @Body(validated(CreatePlaybookBody)) body: Valid<typeof CreatePlaybookBody>,
  ): Promise<PlaybookResponse> {
    return this.playbooksService.create(body, { userId: session.user.id });
  }

  @Patch('playbooks/:id')
  @RequirePermission('crm:playbooks:write')
  async updatePlaybook(
    @Param('id') id: string,
    @Body(validated(UpdatePlaybookBody)) body: Valid<typeof UpdatePlaybookBody>,
  ): Promise<PlaybookResponse> {
    return this.playbooksService.update(id, body);
  }

  @Delete('playbooks/:id')
  @RequirePermission('crm:playbooks:write')
  @HttpCode(HttpStatus.OK)
  async deletePlaybook(@Param('id') id: string): Promise<{ success: boolean }> {
    return this.playbooksService.delete(id);
  }

  // ─── guided selling, on the lead ────────────────────────────────────────────────────

  @Get('leads/:leadId/guidance')
  @RequirePermission('crm:leads:read')
  async leadGuidance(@Param('leadId') leadId: string): Promise<LeadGuidanceResponse> {
    return this.playbooksService.leadGuidance(leadId);
  }

  @Post('leads/:leadId/playbook')
  @RequirePermission('crm:leads:write')
  async enroll(
    @Param('leadId') leadId: string,
    @Body(validated(EnrollPlaybookBody)) body: Valid<typeof EnrollPlaybookBody>,
  ): Promise<PlaybookEnrollmentSummary> {
    return this.playbooksService.enroll(leadId, body.playbookId);
  }

  @Post('leads/:leadId/playbook/advance')
  @RequirePermission('crm:leads:write')
  @HttpCode(HttpStatus.OK)
  async advance(@Param('leadId') leadId: string): Promise<PlaybookEnrollmentSummary> {
    return this.playbooksService.advance(leadId);
  }

  @Delete('leads/:leadId/playbook')
  @RequirePermission('crm:leads:write')
  @HttpCode(HttpStatus.OK)
  async unenroll(@Param('leadId') leadId: string): Promise<{ success: boolean }> {
    return this.playbooksService.unenroll(leadId);
  }
}
