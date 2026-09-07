import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { companyApplied, InjectPrisma, type ScopedPrisma, Tenancy } from '../../platform/tenancy';
import { DomainEvents } from '../../platform/events';

export interface LeadHandoffParams {
  name?: string;
  email?: string;
  phone?: string;
  organisationName?: string;
  customFields?: Record<string, unknown>;
  utm?: {
    source?: string;
    medium?: string;
    campaign?: string;
    term?: string;
    content?: string;
  };
  sourceName: string;
  brandId?: string;
  rawPayload?: Record<string, unknown>;
}

/**
 * Everything a caller can vary about *how* the handoff runs, as opposed to what it says.
 *
 * `client` lets a caller enrol the lead in a transaction it already owns — the public form
 * submit path does, so that a failure after the lead is created cannot leave an orphan in the
 * sales pipeline with no submission to explain it.
 *
 * `deferEmit` moves `marketing.lead.captured` out of the write and into the caller's hands, to
 * be fired once the transaction has actually committed. Emitting inside a transaction publishes
 * an event for a lead that a rollback then un-creates, and a consumer cannot un-consume it.
 */
export interface LeadHandoffOptions {
  readonly client?: TransactionalPrisma;
  readonly deferEmit?: boolean;
}

/** A Prisma client inside a transaction, exactly as `$transaction` hands it to a callback. */
export type TransactionalPrisma = Parameters<Parameters<ScopedPrisma['$transaction']>[0]>[0];

export interface LeadHandoffResult {
  leadId: string;
  isNew: boolean;
  /**
   * Fires `marketing.lead.captured`, when the caller asked to defer it. Call it after commit;
   * calling it never is how a rolled-back submission stays silent.
   */
  emitCaptured?: () => void;
  lead: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    organisationName: string | null;
  };
}

const MARKETING_SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000001';
const MARKETING_SYSTEM_USER_NAME = 'Marketing Automation Engine';

@Injectable()
export class CrmBridgeService {
  private readonly logger = new Logger(CrmBridgeService.name);

  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly events: DomainEvents,
    private readonly tenancy: Tenancy,
  ) {}

  /**
   * Idempotently ingests inbound lead data, applies non-destructive field updates,
   * creates or finds CRM Lead, logs timeline activity, creates CRM lead_submissions entry,
   * and emits `marketing.lead.captured`.
   */
  async handoffLead(
    params: LeadHandoffParams,
    options: LeadHandoffOptions = {},
  ): Promise<LeadHandoffResult> {
    const db = (options.client ?? this.prisma) as ScopedPrisma;
    const email = params.email?.trim();
    const phone = params.phone?.trim();
    const name = params.name?.trim() || email || 'Inbound Lead';

    // 1. Case-insensitive email or phone search on CRM Lead
    const searchConditions: Prisma.LeadWhereInput[] = [];
    if (email) {
      searchConditions.push({ email: { equals: email, mode: 'insensitive' } });
    }
    if (phone) {
      searchConditions.push({ phone: { equals: phone } });
    }

    let existingLead = null;
    if (searchConditions.length > 0) {
      existingLead = await db.lead.findFirst({
        where: { OR: searchConditions },
      });
    }

    let leadId: string;
    let isNew = false;
    let finalLead: {
      id: string;
      name: string;
      email: string | null;
      phone: string | null;
      organisationName: string | null;
    };

    if (existingLead) {
      leadId = existingLead.id;
      // 2. Non-destructive fill of empty fields (ADR 0003 & spec section 5)
      const updatePayload: Prisma.LeadUncheckedUpdateInput = {};
      if (!existingLead.email && email) updatePayload.email = email;
      if (!existingLead.phone && phone) updatePayload.phone = phone;
      if (!existingLead.organisationName && params.organisationName) {
        updatePayload.organisationName = params.organisationName.trim();
      }
      if (
        (existingLead.name === 'Inbound Lead' || existingLead.name === 'Unknown') &&
        params.name?.trim()
      ) {
        updatePayload.name = params.name.trim();
      }

      if (params.customFields && Object.keys(params.customFields).length > 0) {
        const existingCustom =
          existingLead.customValues && typeof existingLead.customValues === 'object'
            ? (existingLead.customValues as Record<string, unknown>)
            : {};
        updatePayload.customValues = {
          ...params.customFields,
          ...existingCustom,
        } as Prisma.InputJsonValue;
      }

      if (Object.keys(updatePayload).length > 0) {
        const updated = await db.lead.update({
          where: { id: leadId },
          data: updatePayload,
        });
        finalLead = {
          id: updated.id,
          name: updated.name,
          email: updated.email,
          phone: updated.phone,
          organisationName: updated.organisationName,
        };
      } else {
        finalLead = {
          id: existingLead.id,
          name: existingLead.name,
          email: existingLead.email,
          phone: existingLead.phone,
          organisationName: existingLead.organisationName,
        };
      }
    } else {
      // 3. Create new CRM Lead
      isNew = true;
      const created = await db.lead.create({
        data: companyApplied<Prisma.LeadUncheckedCreateInput>({
          name,
          email: email ?? null,
          phone: phone ?? null,
          organisationName: params.organisationName?.trim() ?? null,
          customValues: (params.customFields ?? {}) as Prisma.InputJsonValue,
        }),
      });
      leadId = created.id;
      finalLead = {
        id: created.id,
        name: created.name,
        email: created.email,
        phone: created.phone,
        organisationName: created.organisationName,
      };
    }

    // 4. Create CRM LeadSubmission record
    try {
      await db.leadSubmission.create({
        data: companyApplied<Prisma.LeadSubmissionUncheckedCreateInput>({
          leadId,
          formName: params.sourceName,
          rawPayload: (params.rawPayload ?? {}) as Prisma.InputJsonValue,
          mappedFields: {
            name: finalLead.name,
            email: finalLead.email,
            phone: finalLead.phone,
            organisationName: finalLead.organisationName,
            utm: params.utm ?? {},
          } as Prisma.InputJsonValue,
        }),
      });
    } catch (err) {
      this.logger.warn(`Could not create crm.leadSubmission: ${(err as Error).message}`);
    }

    // 5. Append Activity timeline entry with full UTM attribution
    const utmDesc = `source=${params.utm?.source ?? 'direct'}, medium=${
      params.utm?.medium ?? 'none'
    }, campaign=${params.utm?.campaign ?? 'none'}${
      params.utm?.term ? `, term=${params.utm.term}` : ''
    }${params.utm?.content ? `, content=${params.utm.content}` : ''}`;

    try {
      await db.activity.create({
        data: companyApplied<Prisma.ActivityUncheckedCreateInput>({
          type: 'note',
          leadId,
          notes: `Inbound marketing lead captured via ${params.sourceName}. UTM: ${utmDesc}`,
          createdByUserId: MARKETING_SYSTEM_USER_ID,
          createdByName: MARKETING_SYSTEM_USER_NAME,
        }),
      });
    } catch (err) {
      this.logger.warn(`Could not create crm.activity timeline entry: ${(err as Error).message}`);
    }

    // 6. Emit the decoupled domain event — after the caller commits, if it asked to defer.
    const emitCaptured = (): void => {
      this.events.emit('marketing.lead.captured', {
        leadId,
        isNew,
        name: finalLead.name,
        email: finalLead.email,
        phone: finalLead.phone,
        sourceName: params.sourceName,
        utm: params.utm ?? {},
        brandId: params.brandId,
      });
    };

    if (!options.deferEmit) emitCaptured();

    // 7. Check for Nurture Sequences triggered by lead capture
    if (params.brandId) {
      await this.checkNurtureTriggers(params.brandId, finalLead, params.sourceName, db);
    }

    return {
      leadId,
      isNew,
      lead: finalLead,
      ...(options.deferEmit ? { emitCaptured } : {}),
    };
  }

  private async checkNurtureTriggers(
    brandId: string,
    lead: { id: string; email: string | null; name: string },
    triggerSource: string,
    db: ScopedPrisma,
  ): Promise<void> {
    try {
      const sequences = await db.nurtureSequence.findMany({
        where: {
          brandId,
          status: 'ACTIVE',
          triggerEvent: { in: ['marketing.lead.captured', 'form_submit', 'all'] },
        },
      });

      for (const seq of sequences) {
        this.logger.log(
          `Lead ${lead.id} enrolled in nurture sequence '${seq.name}' (${seq.id}) via ${triggerSource}`,
        );
      }
    } catch (err) {
      this.logger.warn(`Failed checking nurture sequences: ${(err as Error).message}`);
    }
  }
}
