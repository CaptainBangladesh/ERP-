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
import { FieldException } from '../../http/validation-exception';
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

function refusedFields(fields: Record<string, string>): FieldException {
  return new FieldException(
    'invalid_form_submission',
    'Some of the details in this submission need attention.',
    HttpStatus.BAD_REQUEST,
    fields,
  );
}

/**
 * How many submissions one form takes in a day.
 *
 * A ceiling rather than a throttle: the per-minute limit on the endpoint stops a burst, and
 * this stops a slow drip that would otherwise fill a sales pipeline over a weekend. Enforced
 * inside the same transaction as the counter, so two simultaneous submissions cannot both read
 * a count one below the cap and both write.
 */
const DAILY_SUBMISSION_CAP = 500;

/** Fields a public page may send that are not part of the form's declared schema. */
const ATTRIBUTION_KEYS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
]);

/**
 * The honeypot: present in the rendered form, invisible, and empty for every human.
 *
 * Anything in it means the submission came from something filling in every input it found.
 */
const HONEYPOT_KEY = '_hp';

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The declared schema, enforced.
 *
 * `schemaFields` used to be decorative — the service read `fields.email as string`, which is a
 * cast rather than a check, so an object reached a Prisma string column and returned 500 from a
 * public endpoint. An unauthenticated caller could pick the status code.
 *
 * Unknown keys are *dropped* rather than refused, because forms get edited and a page that has
 * been open in a tab since yesterday still posts yesterday's shape. Missing required fields and
 * type mismatches are refused, per field, so an embedder can say which box is wrong.
 */
function readAgainstSchema(
  declared: LeadCaptureFormField[],
  submitted: Record<string, unknown>,
): Record<string, unknown> {
  if (declared.length === 0) return submitted;

  const byName = new Map(declared.map((field) => [field.name, field]));
  const refusals: Record<string, string> = {};
  const accepted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(submitted)) {
    const field = byName.get(key);
    if (!field) {
      if (ATTRIBUTION_KEYS.has(key)) accepted[key] = value;
      continue;
    }
    if (value === undefined || value === null) continue;

    if (field.type === 'number') {
      const asNumber = typeof value === 'number' ? value : Number(value);
      if (typeof value === 'boolean' || Number.isNaN(asNumber)) {
        refusals[key] = `'${field.label}' must be a number.`;
        continue;
      }
      accepted[key] = asNumber;
      continue;
    }

    if (typeof value !== 'string') {
      refusals[key] = `'${field.label}' must be text.`;
      continue;
    }

    const text = value.trim();
    if (field.type === 'email' && text.length > 0 && !EMAIL_SHAPE.test(text)) {
      refusals[key] = `'${field.label}' must be an email address.`;
      continue;
    }
    if (
      field.type === 'select' &&
      Array.isArray(field.options) &&
      field.options.length > 0 &&
      text.length > 0 &&
      !field.options.includes(text)
    ) {
      refusals[key] = `'${field.label}' must be one of: ${field.options.join(', ')}.`;
      continue;
    }

    accepted[key] = text;
  }

  for (const field of declared) {
    if (!field.required) continue;
    const value = accepted[field.name];
    if (value === undefined || (typeof value === 'string' && value.length === 0)) {
      refusals[field.name] ??= `'${field.label}' is required.`;
    }
  }

  if (Object.keys(refusals).length > 0) throw refusedFields(refusals);

  return accepted;
}

/** A contact detail, or nothing. Never a cast: the value reaching Prisma is a string or absent. */
function contactText(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate.trim();
  }
  return undefined;
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

    // The honeypot ships with the embed, or it protects nothing.
    const embedCode =
      `<form id="mkt-form-${form.id}" action="/api/marketing/forms/${form.id}/submit" ` +
      `method="POST" data-brand="${input.brandId}">` +
      `<input type="text" name="${HONEYPOT_KEY}" tabindex="-1" autocomplete="off" ` +
      `aria-hidden="true" style="position:absolute;left:-9999px" />` +
      `</form>`;
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

    const submitted = (body.fields ?? {}) as Record<string, unknown>;

    // The honeypot, before anything else — nothing a bot sent is worth validating.
    const honeypot = submitted[HONEYPOT_KEY] ?? body.honeypot;
    if (typeof honeypot === 'string' ? honeypot.trim().length > 0 : honeypot != null) {
      throw badRequest('This submission could not be accepted.');
    }

    const declared = (Array.isArray(form.schemaFields)
      ? form.schemaFields
      : []) as unknown as LeadCaptureFormField[];
    const fields = readAgainstSchema(declared, submitted);

    const utm = (body.utm ?? {}) as Record<string, string | undefined>;

    // Contact details are read, never cast. A non-string 'email' is a 400, not a 500 from
    // Prisma with a stack trace attached to a public endpoint.
    const email = contactText(fields.email, fields.emailAddress);
    const name =
      contactText(fields.name, fields.fullName) ??
      contactText(
        [contactText(fields.firstName), contactText(fields.lastName)]
          .filter(Boolean)
          .join(' '),
      );
    const phone = contactText(fields.phone, fields.phoneNumber, fields.mobile);
    const company = contactText(fields.company, fields.organisationName, fields.organization);

    if (!email && !phone && !name) {
      throw badRequest('Please provide at least a name, email address, or phone number.');
    }

    const attribution = {
      source: utm.source || contactText(fields.utm_source) || 'web_form',
      medium: utm.medium || contactText(fields.utm_medium) || 'inbound',
      campaign: utm.campaign || contactText(fields.utm_campaign) || form.name,
      term: utm.term || contactText(fields.utm_term),
      content: utm.content || contactText(fields.utm_content),
    };

    // 2. Execute inside tenant scope, and as one transaction.
    //
    // The counter, the CRM lead and the submission row used to be three separate writes, so a
    // failure after the lead was created left an orphaned lead in the pipeline with nothing to
    // explain where it came from. All three commit, or none do.
    return this.tenancy.runInCompany({ companyId: form.companyId, grants: 'all' }, async () => {
      const { response, emitCaptured } = await this.prisma.$transaction(async (tx) => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todaysSubmissions = await tx.leadCaptureSubmission.count({
          where: { formId: form.id, submittedAt: { gte: today } },
        });
        if (todaysSubmissions >= DAILY_SUBMISSION_CAP) {
          throw new ApiException(
            'form_daily_cap_reached',
            'This form has reached its submission limit for today.',
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }

        await tx.leadCaptureForm.update({
          where: { id: form.id },
          data: { submitCount: { increment: 1 } },
        });

        const handoff = await this.crmBridge.handoffLead(
          {
            name,
            email,
            phone,
            organisationName: company,
            customFields: fields,
            utm: attribution,
            sourceName: `Web Form: ${form.name}`,
            brandId: form.brandId,
            rawPayload: fields,
          },
          { client: tx, deferEmit: true },
        );

        const submission = await tx.leadCaptureSubmission.create({
          data: companyApplied<Prisma.LeadCaptureSubmissionUncheckedCreateInput>({
            formId: form.id,
            rawPayload: fields as Prisma.InputJsonValue,
            mappedFields: {
              name: name ?? null,
              email: email ?? null,
              phone: phone ?? null,
              company: company ?? null,
            } as Prisma.InputJsonValue,
            utmSource: attribution.source,
            utmMedium: attribution.medium,
            utmCampaign: attribution.campaign,
            utmTerm: attribution.term || null,
            utmContent: attribution.content || null,
            crmLeadId: handoff.leadId,
          }),
        });

        return {
          emitCaptured: handoff.emitCaptured,
          response: {
            success: true,
            submissionId: submission.id,
            leadId: handoff.leadId,
            isNewLead: handoff.isNew,
            message: 'Submission received and lead handed off to CRM successfully.',
          } satisfies PublicFormSubmitResponse,
        };
      });

      // Only now, and still inside the company scope an event has to be emitted from — a
      // rollback must not be able to publish a lead nobody can find.
      emitCaptured?.();

      return response;
    });
  }
}
