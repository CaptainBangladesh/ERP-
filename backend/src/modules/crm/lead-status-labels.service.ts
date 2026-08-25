import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  LEAD_STATUSES,
  LEAD_STATUS_LABEL_DEFAULTS,
  type LeadStatus,
  type LeadStatusLabelListResponse,
  type LeadStatusLabelSummary,
} from '@erp/shared';
import { companyApplied, InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import type { Valid } from '../../platform/validation';
import { UpdateLeadStatusLabelBody } from './schemas';

/**
 * What a company calls each of the four fixed Lead statuses, and the colour it shows them in.
 *
 * The point of this table is what it deliberately is *not*: a fifth status. `Lead.status` stays
 * the shipped `new → contacted → qualified/disqualified` lifecycle that `qualify`, `disqualify`
 * and `reopen` act on and that `WorkflowRule.triggerConfig` names by value. Relabelling `'new'`
 * as "Fresh" changes a caption on a screen and nothing else — which is the only way to give a
 * company its own words without automation quietly failing to recognise a state it has never
 * heard of.
 *
 * A company that has customised nothing has no rows here. Reads fill in the contract's defaults
 * for anything not stored, so every caller sees exactly four labels and none of them has to know
 * that "not customised" is a thing.
 */
@Injectable()
export class LeadStatusLabelsService {
  constructor(@InjectPrisma() private readonly prisma: ScopedPrisma) {}

  async listLabels(): Promise<LeadStatusLabelListResponse> {
    const stored = await this.prisma.leadStatusLabel.findMany();
    const byStatus = new Map(stored.map((row) => [row.status, row]));

    return {
      items: LEAD_STATUSES.map((status) => describe(status, byStatus.get(status))),
    };
  }

  /**
   * Sets one status's label and/or colour, whether or not this company has customised it before.
   *
   * `updateMany` then `create` rather than `upsert`: an upsert would have to name the
   * `(companyId, status)` unique key, and `companyId` is the one column no module writes — the
   * tenancy extension scopes by ANDing it into `where`, which cannot reach inside a compound
   * key. Both statements here go through the extension normally, so this stays a query about
   * "this status" and the company stays the platform's business.
   *
   * Absent fields fall back to the default rather than to nothing, so setting only a colour on a
   * never-customised status still stores a label that reads correctly.
   */
  async updateLabel(
    status: LeadStatus,
    input: Valid<typeof UpdateLeadStatusLabelBody>,
  ): Promise<LeadStatusLabelSummary> {
    const fallback = LEAD_STATUS_LABEL_DEFAULTS[status];

    const changed = await this.prisma.leadStatusLabel.updateMany({
      where: { status },
      data: {
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
      },
    });

    if (changed.count === 0) {
      await this.prisma.leadStatusLabel.create({
        data: companyApplied<Prisma.LeadStatusLabelUncheckedCreateInput>({
          status,
          label: input.label ?? fallback.label,
          color: input.color ?? fallback.color,
        }),
      });
    }

    const stored = await this.prisma.leadStatusLabel.findFirst({ where: { status } });
    return describe(status, stored ?? undefined);
  }
}

function describe(
  status: LeadStatus,
  stored: { label: string; color: string } | undefined,
): LeadStatusLabelSummary {
  const fallback = LEAD_STATUS_LABEL_DEFAULTS[status];
  return {
    status,
    label: stored?.label ?? fallback.label,
    color: stored?.color ?? fallback.color,
  };
}
