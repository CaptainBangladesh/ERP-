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

export interface LeadHandoffResult {
  leadId: string;
  isNew: boolean;
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
  async handoffLead(params: LeadHandoffParams): Promise<LeadHandoffResult> {
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
      existingLead = await this.prisma.lead.findFirst({
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
        const updated = await this.prisma.lead.update({
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
      const created = await this.prisma.lead.create({
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
      await this.prisma.leadSubmission.create({
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
      await this.prisma.activity.create({
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

    // 6. Emit decoupled domain event
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

    // 7. Check for Nurture Sequences triggered by lead capture
    if (params.brandId) {
      await this.checkNurtureTriggers(params.brandId, finalLead, params.sourceName);
    }

    return {
      leadId,
      isNew,
      lead: finalLead,
    };
  }

  private async checkNurtureTriggers(
    brandId: string,
    lead: { id: string; email: string | null; name: string },
    triggerSource: string,
  ): Promise<void> {
    try {
      const sequences = await this.prisma.nurtureSequence.findMany({
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
