import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  LEAD_STATUSES,
  LEAD_STATUS_LABEL_DEFAULTS,
  SETTABLE_LEAD_STATUSES,
  isBuiltInLeadStatus,
  type LeadStatusKey,
  type LeadStatusLabelListResponse,
  type LeadStatusLabelSummary,
} from '@erp/shared';
import { companyApplied, InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import type { Valid } from '../../platform/validation';
import {
  leadStatusDuplicate,
  leadStatusHasLeads,
  leadStatusNotCustom,
  leadStatusNotFound,
} from './refusals';
import { CreateLeadStatusLabelBody, UpdateLeadStatusLabelBody } from './schemas';

/**
 * The statuses on a company's Leads board: what it calls each one, the colour it shows it in,
 * and — for the stages it added itself — the fact that it exists at all.
 *
 * Two kinds of row live in one table, and the split is the whole design.
 *
 * The four `LEAD_STATUSES` are the lifecycle. `qualify`, `disqualify` and `reopen` act on them
 * by value, `WorkflowRule.triggerConfig` names them by value, and the dashboards count them by
 * value. A row here for one of those four is a *caption*: relabelling `'new'` as "Fresh" changes
 * a word on a screen and nothing else. They cannot be created and cannot be deleted, because
 * they are not this table's to create or delete.
 *
 * A custom status is a stage of the company's own, and is the only kind this service adds or
 * removes. It is deliberately the weakest possible kind of status: settable by an ordinary edit
 * exactly like `new` and `contacted`, and never terminal. `qualified` and `disqualified` stay
 * the only two states a Party link is attached to, so no amount of custom stages can produce a
 * lead that is "won" without a Party behind it, and no automation has to recognise a status it
 * has never heard of.
 *
 * A company that has customised nothing has no rows at all. Reads fill in the contract's
 * defaults, so every caller sees at least four statuses and none of them has to know that "not
 * customised" is a thing.
 */
@Injectable()
export class LeadStatusLabelsService {
  constructor(@InjectPrisma() private readonly prisma: ScopedPrisma) {}

  async listLabels(): Promise<LeadStatusLabelListResponse> {
    const stored = await this.prisma.leadStatusLabel.findMany({ orderBy: { order: 'asc' } });
    const byStatus = new Map(stored.map((row) => [row.status, row]));

    return {
      items: [
        ...LEAD_STATUSES.map((status, index) => describe(status, byStatus.get(status), index)),
        ...stored.filter((row) => row.isCustom).map((row) => describe(row.status, row, row.order)),
      ],
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
    status: LeadStatusKey,
    input: Valid<typeof UpdateLeadStatusLabelBody>,
  ): Promise<LeadStatusLabelSummary> {
    const existing = await this.prisma.leadStatusLabel.findFirst({ where: { status } });

    // A custom status only exists as a row. Renaming one that is not there is a 404, where the
    // same request against a built-in is the ordinary "not customised yet" case below.
    if (!existing && !isBuiltInLeadStatus(status)) throw leadStatusNotFound();

    if (existing) {
      await this.prisma.leadStatusLabel.updateMany({
        where: { status },
        data: {
          ...(input.label !== undefined ? { label: input.label } : {}),
          ...(input.color !== undefined ? { color: input.color } : {}),
        },
      });
    } else {
      const fallback = LEAD_STATUS_LABEL_DEFAULTS[status as keyof typeof LEAD_STATUS_LABEL_DEFAULTS];
      await this.prisma.leadStatusLabel.create({
        data: companyApplied<Prisma.LeadStatusLabelUncheckedCreateInput>({
          status,
          label: input.label ?? fallback.label,
          color: input.color ?? fallback.color,
          isCustom: false,
          order: LEAD_STATUSES.indexOf(status as (typeof LEAD_STATUSES)[number]),
        }),
      });
    }

    const stored = await this.prisma.leadStatusLabel.findFirst({ where: { status } });
    return describe(status, stored ?? undefined, stored?.order ?? 0);
  }

  /**
   * Adds a stage of this company's own.
   *
   * The caller names it; the key it is stored under is derived here rather than asked for. A
   * screen that had to invent the wire value would be inventing something two screens could
   * disagree about, and the person adding "In negotiation" has no reason to be thinking about
   * what `Lead.status` will contain.
   */
  async createLabel(
    input: Valid<typeof CreateLeadStatusLabelBody>,
  ): Promise<LeadStatusLabelSummary> {
    const status = statusKeyFor(input.label);

    // Colliding with a built-in matters as much as colliding with another custom one: a second
    // row for `'new'` would shadow the lifecycle status rather than sit beside it.
    const taken =
      isBuiltInLeadStatus(status) ||
      (await this.prisma.leadStatusLabel.findFirst({ where: { status } })) !== null;
    if (taken) throw leadStatusDuplicate(input.label);

    const last = await this.prisma.leadStatusLabel.findFirst({ orderBy: { order: 'desc' } });

    const created = await this.prisma.leadStatusLabel.create({
      data: companyApplied<Prisma.LeadStatusLabelUncheckedCreateInput>({
        status,
        label: input.label,
        color: input.color,
        isCustom: true,
        // After the four built-ins at minimum, so a first custom status lands at 4 rather than
        // in the middle of the lifecycle.
        order: Math.max(last?.order ?? 0, LEAD_STATUSES.length - 1) + 1,
      }),
    });

    return describe(created.status, created, created.order);
  }

  /**
   * Removes a custom status.
   *
   * Refused while leads are still in it, rather than moving them somewhere and reporting
   * success. A status is a claim about where a lead is in a sales process; rewriting that claim
   * for seven leads because somebody tidied up a picker is a change nobody asked for and nobody
   * would see. The refusal says how many are in the way, which is the number needed to decide
   * what to do next.
   */
  async deleteLabel(status: LeadStatusKey): Promise<void> {
    const existing = await this.prisma.leadStatusLabel.findFirst({ where: { status } });
    if (!existing) throw leadStatusNotFound();
    if (!existing.isCustom) throw leadStatusNotCustom();

    const inUse = await this.prisma.lead.count({ where: { status } });
    if (inUse > 0) throw leadStatusHasLeads(existing.label, inUse);

    await this.prisma.leadStatusLabel.deleteMany({ where: { status } });
  }

  /**
   * The statuses an ordinary edit may move a lead into: the two settable built-ins, plus every
   * custom status this company has.
   *
   * Lives here rather than in the request validator because it is a question about rows. The
   * validator can only check the *shape* of a status key; whether `in-negotiation` is a status
   * this company actually has is a read, and `leads.service` asks for it on every write.
   */
  async settableStatuses(): Promise<Set<string>> {
    const custom = await this.prisma.leadStatusLabel.findMany({ where: { isCustom: true } });
    return new Set<string>([...SETTABLE_LEAD_STATUSES, ...custom.map((row) => row.status)]);
  }
}

function describe(
  status: LeadStatusKey,
  stored: { label: string; color: string; isCustom?: boolean; order?: number } | undefined,
  order: number,
): LeadStatusLabelSummary {
  const fallback = LEAD_STATUS_LABEL_DEFAULTS[status as keyof typeof LEAD_STATUS_LABEL_DEFAULTS];
  const isCustom = stored?.isCustom ?? false;

  return {
    status,
    label: stored?.label ?? fallback?.label ?? status,
    color: stored?.color ?? fallback?.color ?? '#94a3b8',
    isCustom,
    // A built-in's position is its place in the lifecycle, not a stored number. Rows written
    // before custom statuses existed all carry `order = 0` from the migration's default, and
    // trusting that would collapse the four of them into one position in the picker.
    order: isCustom ? stored?.order ?? order : order,
    // A custom status is always settable; among the built-ins only `new` and `contacted` are.
    // `qualified` and `disqualified` are reached by qualifying and disqualifying, so that the
    // Party link is created in the same act that claims the lead is qualified.
    isSettable: isCustom || (SETTABLE_LEAD_STATUSES as readonly string[]).includes(status),
  };
}

/**
 * The wire value a custom status is stored under, derived from what it is called.
 *
 * Readable on purpose — `Lead.status` shows up in exports, in workflow-rule configuration and
 * in the database, and `in-negotiation` is answerable where a uuid would need looking up. The
 * label can be renamed afterwards without touching this: the key is derived once, at creation,
 * and is the stable identity from then on.
 */
function statusKeyFor(label: string): string {
  const slug = label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  // A label of nothing but punctuation slugs to an empty string, which would be a status with
  // no key. The validator has already refused an empty label, so this is the residue case.
  return slug.length > 0 ? slug : `status-${Date.now().toString(36)}`;
}
