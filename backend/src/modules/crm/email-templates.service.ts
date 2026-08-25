import { HttpStatus, Injectable } from '@nestjs/common';
import {
  EMAIL_TEMPLATE_ERROR_CODES,
  type CreateEmailTemplateRequest,
  type EmailTemplateSummary,
  type PreviewTemplateResponse,
  type UpdateEmailTemplateRequest,
} from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import {
  companyApplied,
  InjectPrisma,
  type ScopedPrisma,
} from '../../platform/tenancy';
import { LeadFieldsService } from './lead-fields.service';
import { LeadsService } from './leads.service';
import { MailboxesService } from './mailboxes.service';
import {
  htmlToPlainText,
  resolveTemplate,
  validateTemplateTags,
} from './template-tag-resolver';

@Injectable()
export class EmailTemplatesService {
  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly leadFieldsService: LeadFieldsService,
    private readonly leadsService: LeadsService,
    private readonly mailboxesService: MailboxesService,
  ) {}

  async create(
    body: CreateEmailTemplateRequest,
    actor: { userId: string },
  ): Promise<EmailTemplateSummary> {
    await this.validateTags(body.subject, body.body);

    const created = await this.prisma.emailTemplate.create({
      data: companyApplied({
        name: body.name.trim(),
        subject: body.subject.trim(),
        body: body.body.trim(),
        createdByUserId: actor.userId,
      }),
    });

    return describeTemplate(created);
  }

  async list(): Promise<EmailTemplateSummary[]> {
    const rows = await this.prisma.emailTemplate.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r: any) => describeTemplate(r));
  }

  async get(id: string): Promise<EmailTemplateSummary> {
    const row = await this.prisma.emailTemplate.findUnique({
      where: { id },
    });
    if (!row) throw templateNotFound();
    return describeTemplate(row);
  }

  async update(
    id: string,
    patch: UpdateEmailTemplateRequest,
  ): Promise<EmailTemplateSummary> {
    const existing = await this.prisma.emailTemplate.findUnique({
      where: { id },
    });
    if (!existing) throw templateNotFound();

    const newSubject = patch.subject !== undefined ? patch.subject.trim() : existing.subject;
    const newBody = patch.body !== undefined ? patch.body.trim() : existing.body;

    await this.validateTags(newSubject, newBody);

    const updated = await this.prisma.emailTemplate.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.subject !== undefined ? { subject: newSubject } : {}),
        ...(patch.body !== undefined ? { body: newBody } : {}),
      },
    });

    return describeTemplate(updated);
  }

  async delete(id: string): Promise<{ success: boolean }> {
    const existing = await this.prisma.emailTemplate.findUnique({
      where: { id },
    });
    if (!existing) throw templateNotFound();

    await this.prisma.emailTemplate.delete({
      where: { id },
    });

    return { success: true };
  }

  async preview(
    templateId: string,
    leadId: string,
    mailboxId?: string,
  ): Promise<PreviewTemplateResponse> {
    const template = await this.get(templateId);
    const lead = await this.leadsService.leadDetail(leadId);

    let sender = { displayName: 'Sales Manager', emailAddress: 'sales@example.com' };
    if (mailboxId) {
      const mailbox = await this.mailboxesService.requireMailbox(mailboxId);
      sender = { displayName: mailbox.displayName, emailAddress: mailbox.emailAddress };
    }

    const context = {
      lead: {
        name: lead.name,
        email: lead.email,
        organisationName: lead.organisationName,
        phone: lead.phone,
        status: lead.status,
      },
      custom: lead.customValues || {},
      sender,
    };

    const subject = resolveTemplate(template.subject, context);
    const htmlBody = resolveTemplate(template.body, context);
    const textBody = htmlToPlainText(htmlBody);

    return { subject, htmlBody, textBody };
  }

  private async validateTags(subject: string, body: string): Promise<void> {
    const fieldsRes = await this.leadFieldsService.listLeadFields();
    const activeCustomKeys = new Set<string>(
      fieldsRes.items.filter((d: any) => !d.archivedAt).map((d: any) => d.key),
    );

    validateTemplateTags(subject, activeCustomKeys);
    validateTemplateTags(body, activeCustomKeys);
  }
}

export function describeTemplate(row: {
  id: string;
  name: string;
  subject: string;
  body: string;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}): EmailTemplateSummary {
  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    body: row.body,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function templateNotFound(): ApiException {
  return new ApiException(
    EMAIL_TEMPLATE_ERROR_CODES.templateNotFound,
    'That email template does not exist.',
    HttpStatus.NOT_FOUND,
  );
}
