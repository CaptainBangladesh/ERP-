import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  CRM_ROUTE,
  type LeadAttachmentListResponse,
  type LeadAttachmentResponse,
  type LeadListResponse,
  type LeadResponse,
  type LeadSubmissionListResponse,
  type SendLeadEmailRequest,
} from '@erp/shared';
import { CurrentSession, type RequestSession } from '../../platform/auth';
import { RequirePermission } from '../../platform/authorization';
import type { UploadedFile as PlatformUploadedFile } from '../../platform/upload';
import { validated, type Valid } from '../../platform/validation';
import { LeadsService } from './leads.service';
import { LeadOutreachService } from './lead-outreach.service';
import { CreateLeadBody, QualifyLeadBody, UpdateLeadBody, SendLeadEmailBody } from './schemas';

@Controller(CRM_ROUTE)
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly outreach: LeadOutreachService,
  ) {}

  @Post('leads')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('crm:leads:write')
  async add(
    @Body(validated(CreateLeadBody)) body: Valid<typeof CreateLeadBody>,
  ): Promise<LeadResponse> {
    return this.leads.createLead(body);
  }

  @Get('leads')
  @RequirePermission('crm:leads:read')
  async list(@Query() query: Record<string, unknown>): Promise<LeadListResponse> {
    return this.leads.listLeads(query);
  }

  @Get('leads/:id')
  @RequirePermission('crm:leads:read')
  async one(@Param('id') id: string): Promise<LeadResponse> {
    return this.leads.leadDetail(id);
  }

  @Patch('leads/:id')
  @RequirePermission('crm:leads:write')
  async change(
    @Param('id') id: string,
    @Body(validated(UpdateLeadBody)) body: Valid<typeof UpdateLeadBody>,
    @CurrentSession() session: RequestSession,
  ): Promise<LeadResponse> {
    return this.leads.changeLead(id, body, { userId: session.user.id, name: session.user.name });
  }

  @Post('leads/:id/qualify')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('crm:leads:write')
  async qualify(
    @Param('id') id: string,
    @Body(validated(QualifyLeadBody)) body: Valid<typeof QualifyLeadBody>,
    @CurrentSession() session: RequestSession,
  ): Promise<LeadResponse> {
    return this.leads.qualifyLead(id, body, { userId: session.user.id, name: session.user.name });
  }

  @Post('leads/:id/disqualify')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('crm:leads:write')
  async disqualify(
    @Param('id') id: string,
    @CurrentSession() session: RequestSession,
  ): Promise<LeadResponse> {
    return this.leads.disqualifyLead(id, { userId: session.user.id, name: session.user.name });
  }

  @Post('leads/:id/reopen')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('crm:leads:write')
  async reopen(
    @Param('id') id: string,
    @CurrentSession() session: RequestSession,
  ): Promise<LeadResponse> {
    return this.leads.reopenLead(id, { userId: session.user.id, name: session.user.name });
  }

  @Post('leads/clean-duplicates')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('crm:leads:write')
  async cleanDuplicates(): Promise<{ removedCount: number }> {
    return this.leads.cleanDuplicates();
  }

  @Delete('leads/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('crm:leads:write')
  async remove(@Param('id') id: string): Promise<void> {
    return this.leads.deleteLead(id);
  }

  @Post('leads/:id/send-email')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('crm:leads:write')
  async sendEmail(
    @Param('id') id: string,
    @Body(validated(SendLeadEmailBody)) body: Valid<typeof SendLeadEmailBody>,
    @CurrentSession() session: RequestSession,
  ): Promise<any> {
    return this.outreach.sendOneOnOneEmail(id, body, { userId: session.user.id, name: session.user.name });
  }

  @Get('leads/:id/files')
  @RequirePermission('crm:leads:read')
  async listFiles(@Param('id') id: string): Promise<LeadAttachmentListResponse> {
    return this.leads.listAttachments(id);
  }

  /**
   * Multipart, as lead imports already are — the bytes are the point. A JSON body naming a
   * filename could only ever produce an attachment that could not be opened, which is what the
   * first cut of this endpoint did.
   */
  @Post('leads/:id/files')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('crm:leads:write')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @Param('id') id: string,
    @UploadedFile() file: PlatformUploadedFile | undefined,
    @CurrentSession() session: RequestSession,
  ): Promise<LeadAttachmentResponse> {
    return this.leads.addAttachment(id, file as PlatformUploadedFile, {
      userId: session.user.id,
      name: session.user.name,
    });
  }

  /**
   * The stored bytes, with the content-type they were stored under, so a browser opens a PDF
   * and renders an image rather than being handed an anonymous blob. `inline` rather than
   * `attachment`: the Files tab wants a thumbnail and a preview as much as it wants a save.
   *
   * The two per-file headers ride on the `StreamableFile` rather than on the response object,
   * because a handler that took the response would be a handler whose failures skipped the
   * exception filter — the conformance pack refuses it, and a not-found here has to look like
   * every other not-found.
   */
  @Get('leads/:id/files/:fileId/download')
  @RequirePermission('crm:leads:read')
  @Header('Cache-Control', 'private, no-store')
  async downloadFile(
    @Param('id') id: string,
    @Param('fileId') fileId: string,
  ): Promise<StreamableFile> {
    const file = await this.leads.attachmentBytes(id, fileId);
    return new StreamableFile(file.bytes, {
      type: file.mimeType,
      disposition: `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    });
  }

  @Delete('leads/:id/files/:fileId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('crm:leads:write')
  async removeFile(@Param('id') id: string, @Param('fileId') fileId: string): Promise<void> {
    return this.leads.removeAttachment(id, fileId);
  }

  /** Every capture-form response this lead has sent, for the Survey tab. */
  @Get('leads/:id/submissions')
  @RequirePermission('crm:leads:read')
  async listSubmissions(@Param('id') id: string): Promise<LeadSubmissionListResponse> {
    return this.leads.listSubmissions(id);
  }
}
