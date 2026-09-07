import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  LeadCaptureFormField,
  LeadCaptureFormListResponse,
  LeadCaptureFormResponse,
  LeadCaptureFormSummary,
  LeadCaptureSubmissionListResponse,
  LeadCaptureSubmissionResponse,
  LeadCaptureSubmissionSummary,
  PublicFormSubmitResponse,
} from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { listQuery } from '../../platform/list';
import { companyApplied, InjectPrisma, type ScopedPrisma, Tenancy } from '../../platform/tenancy';
import type { Valid } from '../../platform/validation';
import { CrmBridgeService } from './crm-bridge.service';
import {
  CreateLeadCaptureFormBody,
  LEAD_FORM_LIST,
  LEAD_SUBMISSION_LIST,
  SubmitPublicFormBody,
  UpdateLeadCaptureFormBody,
} from './schemas';

function notFound(message = 'Form not found.'): ApiException {
  return new ApiException('form_not_found', message, HttpStatus.NOT_FOUND);
}

function badRequest(message: string): ApiException {
  return new ApiException('invalid_form_submission', message, HttpStatus.BAD_REQUEST);
}

function describeForm(row: {
  id: string;
  brandId: string;
  name: string;
  description: string | null;
  schemaFields: Prisma.JsonValue;
  embedCode: string | null;
  submitCount: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): LeadCaptureFormSummary {
  return {
    id: row.id,
    brandId: row.brandId,
    name: row.name,
    description: row.description,
    schemaFields: (Array.isArray(row.schemaFields)
      ? row.schemaFields
      : []) as unknown as LeadCaptureFormField[],
    embedCode: row.embedCode,
    submitCount: row.submitCount,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function describeSubmission(row: {
  id: string;
  formId: string;
  rawPayload: Prisma.JsonValue;
  mappedFields: Prisma.JsonValue | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  crmLeadId: string | null;
  submittedAt: Date;
}): LeadCaptureSubmissionSummary {
  return {
    id: row.id,
    formId: row.formId,
    rawPayload: (row.rawPayload && typeof row.rawPayload === 'object'
      ? row.rawPayload
      : {}) as Record<string, unknown>,
    mappedFields: (row.mappedFields && typeof row.mappedFields === 'object'
      ? row.mappedFields
      : null) as Record<string, unknown> | null,
    utmSource: row.utmSource,
    utmMedium: row.utmMedium,
    utmCampaign: row.utmCampaign,
    utmTerm: row.utmTerm,
    utmContent: row.utmContent,
    crmLeadId: row.crmLeadId,
    submittedAt: row.submittedAt.toISOString(),
  };
}

@Injectable()
export class FormsService {
  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly tenancy: Tenancy,
    private readonly crmBridge: CrmBridgeService,
  ) {}

  async createForm(input: Valid<typeof CreateLeadCaptureFormBody>): Promise<LeadCaptureFormResponse> {
    const brand = await this.prisma.marketingBrand.findUnique({
      where: { id: input.brandId },
    });
    if (!brand) {
      throw new ApiException('brand_not_found', 'Brand not found.', HttpStatus.BAD_REQUEST);
    }

    const defaultFields: LeadCaptureFormField[] = [
      { name: 'name', label: 'Full Name', type: 'text', required: true, placeholder: 'John Doe' },
      { name: 'email', label: 'Work Email', type: 'email', required: true, placeholder: 'john@example.com' },
      { name: 'phone', label: 'Phone Number', type: 'phone', required: false, placeholder: '+1 555-0199' },
      { name: 'company', label: 'Company Name', type: 'text', required: false, placeholder: 'Acme Corp' },
    ];

    const fields = Array.isArray(input.schemaFields) && input.schemaFields.length > 0
      ? input.schemaFields
      : defaultFields;

    const form = await this.prisma.leadCaptureForm.create({
      data: companyApplied<Prisma.LeadCaptureFormUncheckedCreateInput>({
        brandId: input.brandId,
        name: input.name,
        description: input.description ?? null,
        schemaFields: fields as unknown as Prisma.InputJsonValue,
        isActive: true,
      }),
    });

    const embedCode = `<form id="mkt-form-${form.id}" action="/api/marketing/forms/${form.id}/submit" method="POST" data-brand="${input.brandId}"></form>`;
    const updated = await this.prisma.leadCaptureForm.update({
      where: { id: form.id },
      data: { embedCode },
    });

    return describeForm(updated);
  }

  async listForms(query: Record<string, unknown>): Promise<LeadCaptureFormListResponse> {
    const slice = listQuery(query, LEAD_FORM_LIST);
    const [rows, total] = await Promise.all([
      this.prisma.leadCaptureForm.findMany({
        ...slice.findMany<Prisma.LeadCaptureFormFindManyArgs>(),
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.leadCaptureForm.count(slice.count<Prisma.LeadCaptureFormCountArgs>()),
    ]);
    return slice.respond(rows.map(describeForm), total);
  }

  async getForm(id: string): Promise<LeadCaptureFormResponse> {
    const form = await this.prisma.leadCaptureForm.findUnique({
      where: { id },
    });
    if (!form) throw notFound();
    return describeForm(form);
  }

  async updateForm(id: string, input: Valid<typeof UpdateLeadCaptureFormBody>): Promise<LeadCaptureFormResponse> {
    const existing = await this.prisma.leadCaptureForm.findUnique({ where: { id } });
    if (!existing) throw notFound();

    const updated = await this.prisma.leadCaptureForm.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.schemaFields ? { schemaFields: input.schemaFields as unknown as Prisma.InputJsonValue } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });

    return describeForm(updated);
  }

  async deleteForm(id: string): Promise<{ deleted: boolean }> {
    const existing = await this.prisma.leadCaptureForm.findUnique({ where: { id } });
    if (!existing) throw notFound();

    await this.prisma.leadCaptureForm.delete({ where: { id } });
    return { deleted: true };
  }

  async listSubmissions(formId: string, query: Record<string, unknown>): Promise<LeadCaptureSubmissionListResponse> {
    const existing = await this.prisma.leadCaptureForm.findUnique({ where: { id: formId } });
    if (!existing) throw notFound();

    const slice = listQuery(query, LEAD_SUBMISSION_LIST);
    const [rows, total] = await Promise.all([
      this.prisma.leadCaptureSubmission.findMany({
        where: { formId },
        ...slice.findMany<Prisma.LeadCaptureSubmissionFindManyArgs>(),
        orderBy: { submittedAt: 'desc' },
      }),
      this.prisma.leadCaptureSubmission.count({
        where: { formId },
      }),
    ]);

    return slice.respond(rows.map(describeSubmission), total);
  }

  /**
   * Public submission endpoint handler called from public controller.
   */
  async submitPublicForm(
    formId: string,
    body: Valid<typeof SubmitPublicFormBody>,
  ): Promise<PublicFormSubmitResponse> {
    // 1. Look up form without company scope
    const form = await this.tenancy.withoutCompanyScope(
      'marketing.forms.public_submit_lookup',
      () => this.prisma.leadCaptureForm.findUnique({ where: { id: formId } }),
    );

    if (!form || !form.isActive) {
      throw notFound('Form is inactive or does not exist.');
    }

    const fields = (body.fields ?? {}) as Record<string, unknown>;
    const utm = (body.utm ?? {}) as Record<string, string | undefined>;

    // Extract standard contact fields
    const email = (fields.email as string) || (fields.emailAddress as string);
    const name = (fields.name as string) || (fields.fullName as string) || `${fields.firstName ?? ''} ${fields.lastName ?? ''}`.trim() || undefined;
    const phone = (fields.phone as string) || (fields.phoneNumber as string) || (fields.mobile as string);
    const company = (fields.company as string) || (fields.organisationName as string) || (fields.organization as string);

    if (!email && !phone && !name) {
      throw badRequest('Please provide at least a name, email address, or phone number.');
    }

    // 2. Execute inside tenant scope
    return this.tenancy.runInCompany({ companyId: form.companyId, grants: 'all' }, async () => {
      // Increment submission counter
      await this.prisma.leadCaptureForm.update({
        where: { id: form.id },
        data: { submitCount: { increment: 1 } },
      });

      // Handoff to CRM Bridge
      const handoff = await this.crmBridge.handoffLead({
        name,
        email,
        phone,
        organisationName: company,
        customFields: fields,
        utm: {
          source: utm.source || (fields.utm_source as string) || 'web_form',
          medium: utm.medium || (fields.utm_medium as string) || 'inbound',
          campaign: utm.campaign || (fields.utm_campaign as string) || form.name,
          term: utm.term || (fields.utm_term as string),
          content: utm.content || (fields.utm_content as string),
        },
        sourceName: `Web Form: ${form.name}`,
        brandId: form.brandId,
        rawPayload: fields,
      });

      // Save LeadCaptureSubmission
      const submission = await this.prisma.leadCaptureSubmission.create({
        data: companyApplied<Prisma.LeadCaptureSubmissionUncheckedCreateInput>({
          formId: form.id,
          rawPayload: fields as Prisma.InputJsonValue,
          mappedFields: {
            name,
            email,
            phone,
            company,
          } as Prisma.InputJsonValue,
          utmSource: utm.source || (fields.utm_source as string) || 'web_form',
          utmMedium: utm.medium || (fields.utm_medium as string) || 'inbound',
          utmCampaign: utm.campaign || (fields.utm_campaign as string) || form.name,
          utmTerm: utm.term || (fields.utm_term as string) || null,
          utmContent: utm.content || (fields.utm_content as string) || null,
          crmLeadId: handoff.leadId,
        }),
      });

      return {
        success: true,
        submissionId: submission.id,
        leadId: handoff.leadId,
        isNewLead: handoff.isNew,
        message: 'Submission received and lead handed off to CRM successfully.',
      };
    });
  }
}
