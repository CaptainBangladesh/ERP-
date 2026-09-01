import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import {
  type CaptureSourceConfig,
  type CaptureSourceKind,
  type CaptureSourceListResponse,
  type CaptureSourceSummary,
  type CaptureSubmitResponse,
  type FormConfig,
  type FormConfigField,
  type FormSubmitBehavior,
  type LeadCustomValues,
  type PublicFormConfigResponse,
  type WebhookConfig,
} from '@erp/shared';
import { companyApplied, InjectPrisma, Tenancy, type ScopedPrisma } from '../../platform/tenancy';
import { listQuery } from '../../platform/list';
import { ApiException } from '../../http/api-exception';
import { FieldException } from '../../http/validation-exception';
import { SYSTEM_ACTOR_ID, SYSTEM_ACTOR_NAME, auditNotes } from './audit-events';
import { LeadFieldsService } from './lead-fields.service';
import { CAPTURE_SOURCE_LIST } from './schemas';
import {
  captureSourceNotFound,
  invalidCaptureToken,
  rateLimitExceeded,
  unconfiguredField,
} from './refusals';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

function generateToken(): string {
  return `cs_${randomBytes(16).toString('hex')}`;
}


@Injectable()
export class CaptureSourcesService {
  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly tenancy: Tenancy,
    private readonly leadFields: LeadFieldsService,
  ) {}

  async create(input: {
    kind?: CaptureSourceKind;
    name: string;
    config?: CaptureSourceConfig;
    defaultSourceId?: string;
    defaultGroupId?: string;
    defaultAssignedToUserId?: string;
  }): Promise<CaptureSourceSummary> {
    const token = generateToken();

    const created = await this.prisma.captureSource.create({
      data: companyApplied<Prisma.CaptureSourceUncheckedCreateInput>({
        kind: input.kind ?? 'webform',
        name: input.name,
        token,
        enabled: true,
        config: (input.config ?? {}) as any,
        defaultSourceId: input.defaultSourceId ?? null,
        defaultGroupId: input.defaultGroupId ?? null,
        defaultAssignedToUserId: input.defaultAssignedToUserId ?? null,
      }),
    });

    return describeCaptureSource(created);
  }

  async update(
    id: string,
    input: {
      name?: string;
      enabled?: boolean;
      config?: CaptureSourceConfig;
      defaultSourceId?: string;
      defaultGroupId?: string;
      defaultAssignedToUserId?: string;
    },
  ): Promise<CaptureSourceSummary> {
    const existing = await this.prisma.captureSource.findFirst({
      where: { id },
    });

    if (!existing) throw captureSourceNotFound();

    const updated = await this.prisma.captureSource.update({
      where: { id: existing.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.config !== undefined ? { config: input.config as any } : {}),
        ...(input.defaultSourceId !== undefined ? { defaultSourceId: input.defaultSourceId || null } : {}),
        ...(input.defaultGroupId !== undefined ? { defaultGroupId: input.defaultGroupId || null } : {}),
        ...(input.defaultAssignedToUserId !== undefined
          ? { defaultAssignedToUserId: input.defaultAssignedToUserId || null }
          : {}),
      },
    });

    return describeCaptureSource(updated);
  }

  async rotateToken(id: string): Promise<CaptureSourceSummary> {
    const existing = await this.prisma.captureSource.findFirst({
      where: { id },
    });

    if (!existing) throw captureSourceNotFound();

    const newToken = generateToken();

    const updated = await this.prisma.captureSource.update({
      where: { id: existing.id },
      data: { token: newToken },
    });

    return describeCaptureSource(updated);
  }

  async getOne(id: string): Promise<CaptureSourceSummary> {
    const existing = await this.prisma.captureSource.findFirst({
      where: { id },
    });

    if (!existing) throw captureSourceNotFound();

    return describeCaptureSource(existing);
  }

  async list(query: Record<string, unknown>): Promise<CaptureSourceListResponse> {
    const slice = listQuery(query, CAPTURE_SOURCE_LIST);

    const [rows, total] = await Promise.all([
      this.prisma.captureSource.findMany(slice.findMany<Prisma.CaptureSourceFindManyArgs>()),
      this.prisma.captureSource.count(slice.count<Prisma.CaptureSourceCountArgs>()),
    ]);

    return slice.respond(rows.map(describeCaptureSource), total);
  }

  /**
   * Public endpoint helper to get form config for web form rendering.
   * Uses withoutCompanyScope to find source by token.
   */
  async getPublicFormConfig(token: string): Promise<PublicFormConfigResponse> {
    const source = await this.tenancy.withoutCompanyScope(
      'crm.capture_source.public_form_lookup',
      () =>
        this.prisma.captureSource.findUnique({
          where: { token },
        }),
    );

    if (!source || !source.enabled) {
      throw invalidCaptureToken();
    }

    const config = (source.config as unknown) as FormConfig;
    const rawFields = config?.fields || [];
    const submitBehavior: FormSubmitBehavior = config?.submitBehavior || {
      kind: 'message',
      text: 'Thank you! Your submission has been received.',
    };

    // Enrich custom fields with definition type & options if available
    const customDefs = await this.tenancy.withoutCompanyScope(
      'crm.capture_source.public_fields_lookup',
      () =>
        this.prisma.leadFieldDefinition.findMany({
          where: { companyId: source.companyId, archivedAt: null },
        }),
    );

    const defMap = new Map(customDefs.map((def) => [def.key, def]));

    const fields: FormConfigField[] = rawFields.map((f) => {
      const def = defMap.get(f.key);
      let fieldType = f.type;
      let fieldOptions = f.options;
      let columnName = f.columnName;

      if (f.key === 'name') {
        fieldType = fieldType || 'text';
        columnName = columnName || 'Name';
      } else if (f.key === 'email') {
        fieldType = fieldType || 'email';
        columnName = columnName || 'Email';
      } else if (f.key === 'phone') {
        fieldType = fieldType || 'tel';
        columnName = columnName || 'Phone';
      } else if (f.key === 'organisationName') {
        fieldType = fieldType || 'text';
        columnName = columnName || 'Organization';
      } else if (def) {
        fieldType = fieldType || def.type;
        columnName = columnName || def.label;
        if (!fieldOptions && Array.isArray(def.options)) {
          fieldOptions = def.options as string[];
        }
      }

      return {
        ...f,
        type: fieldType || 'text',
        ...(fieldOptions ? { options: fieldOptions } : {}),
        ...(columnName ? { columnName } : {}),
      };
    });

    return {
      name: source.name,
      slug: (source as any).slug ?? token,
      config: (source.config ?? {}) as FormConfig,
      fields,
      submitBehavior,
    };
  }

  /**
   * Public endpoint helper to submit form/webhook payload.
   */
  async submitCapture(token: string, rawPayload: Record<string, unknown>): Promise<CaptureSubmitResponse> {
    const source = await this.tenancy.withoutCompanyScope(
      'crm.capture_source.public_submit_lookup',
      () =>
        this.prisma.captureSource.findUnique({
          where: { token },
        }),
    );

    if (!source || !source.enabled) {
      throw invalidCaptureToken();
    }

    // Per-token rate limiting (60 requests per 10 minutes)
    const now = Date.now();
    let limitEntry = rateLimitStore.get(token);
    if (!limitEntry || now > limitEntry.resetAt) {
      limitEntry = { count: 1, resetAt: now + 10 * 60 * 1000 };
      rateLimitStore.set(token, limitEntry);
    } else {
      limitEntry.count += 1;
      if (limitEntry.count > 60) {
        throw rateLimitExceeded();
      }
    }

    if (!rawPayload || typeof rawPayload !== 'object' || Object.keys(rawPayload).length > 50) {
      throw new ApiException(
        'invalid_submission_payload',
        'Submission payload is invalid or exceeds maximum allowed fields (50).',
        HttpStatus.BAD_REQUEST,
      );
    }

    const mappedLeadData: Record<string, unknown> = {};
    /**
     * Which answer fed which Lead field, kept as the mapping is applied.
     *
     * It cannot be recovered afterwards: a webhook source maps `entry_104` onto `budget`, so
     * once `mappedLeadData` is keyed by field the answer it came from is gone. The Survey tab
     * needs exactly this to tell a mapped answer from one nothing maps.
     */
    const mappedFields: Record<string, string> = {};

    if (source.kind === 'form') {
      const config = (source.config as unknown) as FormConfig;
      const configuredFields: FormConfigField[] = config?.fields || [];
      const allowedKeys = new Set(configuredFields.map((f) => f.key));

      // Check unconfigured keys
      for (const key of Object.keys(rawPayload)) {
        if (!allowedKeys.has(key)) {
          throw unconfiguredField(key);
        }
      }

      // Check required fields
      for (const field of configuredFields) {
        if (field.required) {
          const val = rawPayload[field.key];
          if (val === undefined || val === null || val === '') {
            throw new FieldException(
              'validation_failed',
              `${field.label} is required.`,
              HttpStatus.BAD_REQUEST,
              { [field.key]: `${field.label} is required.` },
            );
          }
        }
      }

      // A form source names its own fields, so an answer's key is the field it feeds.
      for (const [k, v] of Object.entries(rawPayload)) {
        if (v !== undefined && v !== null && v !== '') {
          mappedLeadData[k] = v;
          mappedFields[k] = k;
        }
      }
    } else if (source.kind === 'webhook') {
      const config = (source.config as any) ?? {};
      const mapping: Record<string, string> = config?.fieldMapping || {};

      for (const [inboundKey, leadKey] of Object.entries(mapping)) {
        if (rawPayload[inboundKey] !== undefined && rawPayload[inboundKey] !== null) {
          mappedLeadData[leadKey] = rawPayload[inboundKey];
          mappedFields[inboundKey] = leadKey;
        }
      }
    }

    // Execute lead creation inside target company scope
    await this.tenancy.runInCompany({ companyId: source.companyId, grants: 'all' }, async () => {
      const name =
        typeof mappedLeadData.name === 'string' && mappedLeadData.name.trim()
          ? mappedLeadData.name.trim()
          : typeof mappedLeadData.email === 'string' && mappedLeadData.email.trim()
          ? mappedLeadData.email.trim()
          : typeof mappedLeadData.organisationName === 'string' && mappedLeadData.organisationName.trim()
          ? mappedLeadData.organisationName.trim()
          : 'Web Submission';

      const email = typeof mappedLeadData.email === 'string' ? mappedLeadData.email.trim() : undefined;
      const organisationName =
        typeof mappedLeadData.organisationName === 'string'
          ? mappedLeadData.organisationName.trim()
          : undefined;
      const phone = typeof mappedLeadData.phone === 'string' ? mappedLeadData.phone.trim() : undefined;
      const sourceId =
        typeof mappedLeadData.sourceId === 'string'
          ? mappedLeadData.sourceId
          : source.defaultSourceId || undefined;
      const groupId =
        typeof mappedLeadData.groupId === 'string'
          ? mappedLeadData.groupId
          : source.defaultGroupId || undefined;
      const assignedToUserId =
        typeof mappedLeadData.assignedToUserId === 'string'
          ? mappedLeadData.assignedToUserId
          : source.defaultAssignedToUserId || undefined;

      const builtInKeys = new Set([
        'name',
        'email',
        'organisationName',
        'phone',
        'sourceId',
        'groupId',
        'assignedToUserId',
      ]);
      const submittedCustomValues: Record<string, unknown> = {};

      for (const [k, v] of Object.entries(mappedLeadData)) {
        if (!builtInKeys.has(k)) {
          submittedCustomValues[k] = v;
        }
      }

      // The same gate every other write path uses — a public submitter naming a field this
      // company never defined, or an archived one, is refused rather than stored verbatim.
      // Cast is safe: `validate` reads each value at runtime through the same `readValue`
      // switch that every typed caller goes through, regardless of what TS believes going in.
      const customValues = await this.leadFields.validate(
        submittedCustomValues as LeadCustomValues,
      );

      const conditions: Prisma.LeadWhereInput[] = [];
      if (email?.trim()) conditions.push({ email: { equals: email.trim(), mode: 'insensitive' } });
      if (phone?.trim()) conditions.push({ phone: { equals: phone.trim() } });
      if (name?.trim()) conditions.push({ name: { equals: name.trim(), mode: 'insensitive' } });

      let existingLead: { id: string } | null = null;
      if (conditions.length > 0) {
        existingLead = await this.prisma.lead.findFirst({
          where: { OR: conditions },
          select: { id: true },
        });
      }

      /**
       * A response from somebody already on the board used to be thrown away, so the second
       * thing a lead told us was lost and only the first survived. It now appends: the
       * submission attaches to the lead that matched, and the lead's *empty* fields — and only
       * its empty ones — are filled in from it.
       *
       * Never overwriting is not caution for its own sake. This endpoint is public and
       * unauthenticated, so anyone who knows a customer's email address can post as them; a
       * submission that could overwrite would be a way to blank out a known lead's phone
       * number from the outside. Filling a gap cannot destroy anything, so that is all it does.
       */
      const lead = existingLead
        ? await this.fillEmptyFields(existingLead.id, {
            email,
            organisationName,
            phone,
            sourceId,
            groupId,
            assignedToUserId,
            customValues,
          })
        : await this.prisma.lead.create({
            data: companyApplied<Prisma.LeadUncheckedCreateInput>({
              name,
              ...(email ? { email } : {}),
              ...(organisationName ? { organisationName } : {}),
              ...(phone ? { phone } : {}),
              ...(sourceId ? { sourceId } : {}),
              ...(groupId ? { groupId } : {}),
              ...(assignedToUserId ? { assignedToUserId } : {}),
              ...(Object.keys(customValues).length > 0 ? { customValues: customValues as any } : {}),
            }),
          });

      // The raw payload in full, mapped or not: an answer no field maps is still something the
      // lead told us, and the Survey tab is where it stays readable until somebody promotes it.
      await this.prisma.leadSubmission.create({
        data: companyApplied<Prisma.LeadSubmissionUncheckedCreateInput>({
          leadId: lead.id,
          captureSourceId: source.id,
          formName: source.name,
          rawPayload: rawPayload as Prisma.InputJsonValue,
          mappedFields: mappedFields as Prisma.InputJsonValue,
        }),
      });

      await this.prisma.activity.create({
        data: companyApplied<Prisma.ActivityUncheckedCreateInput>({
          type: 'note',
          notes: auditNotes.surveyReceived(source.name),
          leadId: lead.id,
          createdByUserId: SYSTEM_ACTOR_ID,
          createdByName: SYSTEM_ACTOR_NAME,
        }),
      });

      await this.prisma.captureSource.update({
        where: { id: source.id },
        data: {
          submissionCount: { increment: 1 },
          lastSubmissionAt: new Date(),
        },
      });
    });

    const formConfig = (source.config as unknown) as FormConfig;
    return {
      success: true,
      submitBehavior: formConfig?.submitBehavior || {
        kind: 'message',
        text: 'Thank you for your submission!',
      },
    };
  }

  /**
   * Writes only what the lead does not already have.
   *
   * "Empty" is the same question for a built-in column and a custom value: null, absent, an
   * empty string, or an empty list. Anything else is a value somebody already has a reason to
   * trust, and a public submission does not get to replace it — see the note at the call site.
   */
  private async fillEmptyFields(
    leadId: string,
    incoming: {
      email?: string;
      organisationName?: string;
      phone?: string;
      sourceId?: string;
      groupId?: string;
      assignedToUserId?: string;
      customValues: LeadCustomValues;
    },
  ) {
    const lead = await this.prisma.lead.findFirstOrThrow({ where: { id: leadId } });

    const fills: Prisma.LeadUncheckedUpdateInput = {};
    for (const column of ['email', 'organisationName', 'phone', 'sourceId', 'groupId', 'assignedToUserId'] as const) {
      const value = incoming[column];
      if (value && isEmptyValue(lead[column])) fills[column] = value;
    }

    const existingCustom = (lead.customValues as LeadCustomValues) || {};
    const mergedCustom: Record<string, unknown> = { ...existingCustom };
    let customChanged = false;
    for (const [key, value] of Object.entries(incoming.customValues)) {
      if (isEmptyValue(value)) continue;
      if (!isEmptyValue(existingCustom[key])) continue;
      mergedCustom[key] = value;
      customChanged = true;
    }
    if (customChanged) fills.customValues = mergedCustom as Prisma.InputJsonValue;

    if (Object.keys(fills).length === 0) return lead;

    return this.prisma.lead.update({ where: { id: lead.id }, data: fills });
  }
}

/** Nothing worth keeping: never answered, cleared, or an empty list. */
function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  return Array.isArray(value) && value.length === 0;
}

function describeCaptureSource(raw: any): CaptureSourceSummary {
  return {
    id: raw.id,
    type: 'webform',
    kind: raw.kind as CaptureSourceKind,
    name: raw.name,
    slug: raw.slug || raw.token,
    token: raw.token,
    enabled: raw.enabled,
    config: raw.config as CaptureSourceConfig,
    defaultSourceId: raw.defaultSourceId ?? null,
    defaultGroupId: raw.defaultGroupId ?? null,
    defaultAssignedToUserId: raw.defaultAssignedToUserId ?? null,
    submissionCount: raw.submissionCount,
    lastSubmissionAt: raw.lastSubmissionAt ? raw.lastSubmissionAt.toISOString() : null,
    createdAt: raw.createdAt.toISOString(),
    updatedAt: raw.updatedAt ? raw.updatedAt.toISOString() : undefined,
  };
}
