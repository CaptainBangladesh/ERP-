import { Injectable, Logger } from '@nestjs/common';
import { InjectPrisma, type ScopedPrisma, Tenancy } from '../../platform/tenancy';
import { DomainEvents } from '../../platform/events';
import { CrmLeadIntake } from '../crm';

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

/**
 * Who the CRM records as the author of everything this module writes to a lead's timeline.
 *
 * It lives here rather than inside `crm` on purpose: the CRM has no business knowing that a
 * "Marketing Automation Engine" exists, only who claimed to be speaking.
 */
export const MARKETING_SYSTEM_ACTOR = {
  userId: '00000000-0000-0000-0000-000000000001',
  name: 'Marketing Automation Engine',
} as const;

/**
 * Marketing's side of the CRM seam.
 *
 * A translator and nothing else, now. It used to write `Lead`, `LeadSubmission` and `Activity`
 * with marketing's own Prisma client while also emitting `marketing.lead.captured`, so the
 * module both announced the decoupling and skipped it. The writes go through `CrmLeadIntake`;
 * what stays here is the shape of an inbound marketing lead, the UTM prose, the event, and the
 * nurture-sequence check — all of which are marketing's own and none of which the CRM wants.
 */
@Injectable()
export class CrmBridgeService {
  private readonly logger = new Logger(CrmBridgeService.name);

  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly events: DomainEvents,
    private readonly tenancy: Tenancy,
    private readonly crm: CrmLeadIntake,
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

    // 1-3. Match or create the lead. The search, the non-destructive fill and the create are
    // all the CRM's now — including the ADR 0012 invariant, which used to be a rule this
    // module was trusted to honour in code the CRM never saw.
    const { leadId, isNew, lead: finalLead } = await this.crm.resolveInboundLead(
      {
        name: params.name,
        email: params.email,
        phone: params.phone,
        organisationName: params.organisationName,
        customFields: params.customFields,
      },
      MARKETING_SYSTEM_ACTOR,
      options.client,
    );

    // 4. Record the submission against the lead.
    try {
      await this.crm.recordInboundSubmission(
        {
          leadId,
          formName: params.sourceName,
          rawPayload: params.rawPayload ?? {},
          mappedFields: {
            name: finalLead.name,
            email: finalLead.email,
            phone: finalLead.phone,
            organisationName: finalLead.organisationName,
            utm: params.utm ?? {},
          },
        },
        options.client,
      );
    } catch (err) {
      this.logger.warn(`Could not record the CRM lead submission: ${(err as Error).message}`);
    }

    // 5. Append a timeline note with full UTM attribution. The prose is marketing's; the
    // timeline is the CRM's.
    const utmDesc = `source=${params.utm?.source ?? 'direct'}, medium=${
      params.utm?.medium ?? 'none'
    }, campaign=${params.utm?.campaign ?? 'none'}${
      params.utm?.term ? `, term=${params.utm.term}` : ''
    }${params.utm?.content ? `, content=${params.utm.content}` : ''}`;

    try {
      await this.crm.appendInboundActivity(
        {
          leadId,
          notes: `Inbound marketing lead captured via ${params.sourceName}. UTM: ${utmDesc}`,
        },
        MARKETING_SYSTEM_ACTOR,
        options.client,
      );
    } catch (err) {
      this.logger.warn(`Could not append the CRM timeline entry: ${(err as Error).message}`);
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
