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
  type EmailTemplateListResponse,
  type EmailTemplateSummary,
  type PreviewTemplateResponse,
} from '@erp/shared';
import { CurrentSession, type RequestSession } from '../../platform/auth';
import { RequirePermission } from '../../platform/authorization';
import { validated, type Valid } from '../../platform/validation';
import { EmailTemplatesService } from './email-templates.service';
import {
  CreateEmailTemplateBody,
  PreviewTemplateBody,
  UpdateEmailTemplateBody,
} from './schemas';

@Controller(CRM_ROUTE)
export class EmailTemplatesController {
  constructor(private readonly emailTemplatesService: EmailTemplatesService) {}

  @Post('email-templates')
  @RequirePermission('crm:leads:read')
  async createTemplate(
    @CurrentSession() session: RequestSession,
    @Body(validated(CreateEmailTemplateBody)) body: Valid<typeof CreateEmailTemplateBody>,
  ): Promise<EmailTemplateSummary> {
    return this.emailTemplatesService.create(body, { userId: session.user.id });
  }

  @Get('email-templates')
  @RequirePermission('crm:leads:read')
  async listTemplates(): Promise<EmailTemplateListResponse> {
    const items = await this.emailTemplatesService.list();
    return { items };
  }

  @Get('email-templates/:id')
  @RequirePermission('crm:leads:read')
  async getTemplate(@Param('id') id: string): Promise<EmailTemplateSummary> {
    return this.emailTemplatesService.get(id);
  }

  @Patch('email-templates/:id')
  @RequirePermission('crm:leads:read')
  async updateTemplate(
    @Param('id') id: string,
    @Body(validated(UpdateEmailTemplateBody)) body: Valid<typeof UpdateEmailTemplateBody>,
  ): Promise<EmailTemplateSummary> {
    return this.emailTemplatesService.update(id, body);
  }

  @Delete('email-templates/:id')
  @RequirePermission('crm:leads:read')
  @HttpCode(HttpStatus.OK)
  async deleteTemplate(@Param('id') id: string): Promise<{ success: boolean }> {
    return this.emailTemplatesService.delete(id);
  }

  @Post('email-templates/:id/preview')
  @RequirePermission('crm:leads:read')
  @HttpCode(HttpStatus.OK)
  async previewTemplate(
    @Param('id') id: string,
    @Body(validated(PreviewTemplateBody)) body: Valid<typeof PreviewTemplateBody>,
  ): Promise<PreviewTemplateResponse> {
    return this.emailTemplatesService.preview(
      id,
      body.leadId,
      body.mailboxConnectionId,
    );
  }
}
