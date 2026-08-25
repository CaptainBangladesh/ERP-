import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CRM_EVENTS,
  DEAL_ROLLUP_MAX_PARTIES,
  DEFAULT_CURRENCY,
  Money,
  type DealListResponse,
  type DealResponse,
  type DealSummary,
  type PartyDealRollup,
  type PartyDealRollupResponse,
  type StageOutcome,
} from '@erp/shared';
import { defined, exactly } from '../../prisma/columns';
import { DomainEvents } from '../../platform/events';
import { listQuery } from '../../platform/list';
import { companyApplied, InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import type { Valid } from '../../platform/validation';
import { PartyDirectory } from '../parties';
import {
  dealNotFound,
  dealPartyNotFound,
  dealStageNotFound,
  tooManyRollupParties,
} from './refusals';
import { CreateDealBody, DEAL_LIST, UpdateDealBody } from './schemas';
import { WorkflowRulesService } from './workflow-rules.service';

/** A Deal, plus the one field of its Stage every response needs. */
const WITH_STAGE_OUTCOME = { stage: { select: { outcome: true } } } as const;

/**
 * A sale in progress against a real Party, moving through this company's own pipeline.
 *
 * Landing on a Stage whose `outcome` is `'won'` or `'lost'` is the whole of how a Deal closes —
 * `changeDeal` is an ordinary field write when `stageId` is among the fields sent, and
 * `describe` below is what reads the outcome off the Stage a Deal is in rather than storing it
 * redundantly on the Deal itself, so the two can never drift apart.
 *
 * As in every module, there is no company filter in this file: the platform scopes every query
 * below, so another company's Deals, Stages and Parties are not reachable from here even by
 * trying — `stageId` and `partyId` are both checked against this company specifically, the
 * first through the platform's own scoping and the second through `PartyDirectory`.
 */
@Injectable()
export class DealsService {
  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly parties: PartyDirectory,
    private readonly workflowRulesService: WorkflowRulesService,
    private readonly events: DomainEvents,
  ) {}

  async createDeal(
    input: Valid<typeof CreateDealBody>,
    actor?: { userId: string; name: string },
  ): Promise<DealResponse> {
    const party = await this.parties.party(input.partyId);
    if (!party) throw dealPartyNotFound();

    const stage = await this.requireStage(input.stageId);

    const deal = await this.prisma.deal.create({
      data: companyApplied<Prisma.DealUncheckedCreateInput>({
        name: input.name,
        partyId: input.partyId,
        stageId: input.stageId,
        amount: input.amount.toValue().amount,
        expectedCloseDate: input.expectedCloseDate ?? null,
        assignedToUserId: input.assignedToUserId ?? null,
        originLeadId: input.originLeadId ?? null,
      }),
    });

    await this.workflowRulesService.evaluateRules({
      triggerType: 'deal.stage_changed',
      dealId: deal.id,
      toStageId: deal.stageId,
      actor: actor ?? { userId: '00000000-0000-0000-0000-000000000000', name: 'System' },
    });

    const summary = describe({ ...deal, stage });

    this.events.emit(CRM_EVENTS.dealCreated, {
      dealId: summary.id,
      partyId: summary.partyId,
      stageId: summary.stageId,
      amount: summary.amount,
      name: summary.name,
    });

    if (summary.stageOutcome === 'won') {
      this.events.emit(CRM_EVENTS.dealWon, {
        dealId: summary.id,
        partyId: summary.partyId,
        stageId: summary.stageId,
        amount: summary.amount,
      });
    } else if (summary.stageOutcome === 'lost') {
      this.events.emit(CRM_EVENTS.dealLost, {
        dealId: summary.id,
        partyId: summary.partyId,
        stageId: summary.stageId,
        amount: summary.amount,
      });
    }

    return summary;
  }

  async listDeals(query: Record<string, unknown>): Promise<DealListResponse> {
    const slice = listQuery(query, DEAL_LIST);

    const [rows, total] = await Promise.all([
      this.prisma.deal.findMany({
        ...slice.findMany<Prisma.DealFindManyArgs>(),
        include: WITH_STAGE_OUTCOME,
      }),
      this.prisma.deal.count(slice.count<Prisma.DealCountArgs>()),
    ]);

    return slice.respond(rows.map(describe), total);
  }

  async dealDetail(id: string): Promise<DealResponse> {
    return describe(await this.requireDeal(id));
  }

  /**
   * Every ordinary edit, including the move that closes a Deal: sending `stageId` is all
   * moving between Stages is, and landing on a Stage whose `outcome` is set is all closing is.
   * There is no separate move or close endpoint.
   */
  async changeDeal(
    id: string,
    input: Valid<typeof UpdateDealBody>,
    actor?: { userId: string; name: string },
  ): Promise<DealResponse> {
    const existing = await this.requireDeal(id);

    if (input.partyId) {
      const party = await this.parties.party(input.partyId);
      if (!party) throw dealPartyNotFound();
    }

    if (input.stageId) await this.requireStage(input.stageId);

    const deal = await this.prisma.deal.update({
      where: { id },
      data: {
        ...defined('name', input.name),
        ...defined('partyId', input.partyId),
        ...defined('stageId', input.stageId),
        ...defined('amount', input.amount?.toValue().amount),
        ...defined('expectedCloseDate', input.expectedCloseDate),
        ...defined('assignedToUserId', input.assignedToUserId),
        ...defined('originLeadId', input.originLeadId),
      },
      include: WITH_STAGE_OUTCOME,
    });

    if (input.stageId !== undefined) {
      await this.workflowRulesService.evaluateRules({
        triggerType: 'deal.stage_changed',
        dealId: deal.id,
        toStageId: deal.stageId,
        actor: actor ?? { userId: '00000000-0000-0000-0000-000000000000', name: 'System' },
      });
    }

    const summary = describe(deal);

    if (input.stageId !== undefined && existing.stageId !== deal.stageId) {
      this.events.emit(CRM_EVENTS.dealStageChanged, {
        dealId: summary.id,
        fromStageId: existing.stageId,
        toStageId: summary.stageId,
        outcome: summary.stageOutcome,
      });

      if (summary.stageOutcome === 'won') {
        this.events.emit(CRM_EVENTS.dealWon, {
          dealId: summary.id,
          partyId: summary.partyId,
          stageId: summary.stageId,
          amount: summary.amount,
        });
      } else if (summary.stageOutcome === 'lost') {
        this.events.emit(CRM_EVENTS.dealLost, {
          dealId: summary.id,
          partyId: summary.partyId,
          stageId: summary.stageId,
          amount: summary.amount,
        });
      }
    }

    return summary;
  }

  /**
   * What each of these parties has in flight, in one query.
   *
   * The Contacts board draws a Deals column for a page of contacts at a time. Reading it a
   * contact at a time would be a request per row, so this takes the whole page's ids and
   * answers for all of them — the mirror of `PartyDirectory.parties`, and there for the same
   * reason.
   *
   * Aggregated here rather than in the database because the thing being grouped by is the
   * *Stage's* outcome and not a column on `Deal`: a `groupBy` would have to group by stage and
   * then be re-grouped in memory anyway, and this way the rule that an outcome is read fresh
   * off the Stage stays the one `describe` already states.
   *
   * Scoping is the platform's, as everywhere here — an id belonging to another company matches
   * nothing, so naming one outright is answered with silence rather than a refusal.
   */
  async dealsByParty(partyIds: readonly string[]): Promise<PartyDealRollupResponse> {
    // Deduplicated before the cap is applied, so a caller is never refused for repetition.
    const asked = [...new Set(partyIds)];

    if (asked.length > DEAL_ROLLUP_MAX_PARTIES) {
      throw tooManyRollupParties(DEAL_ROLLUP_MAX_PARTIES, asked.length);
    }

    if (asked.length === 0) return { items: [] };

    const deals = await this.prisma.deal.findMany({
      where: { partyId: { in: asked } },
      select: { partyId: true, amount: true, stage: { select: { outcome: true } } },
    });

    // Insertion-ordered, so the answer follows the order asked in for the parties that have
    // deals — a board rendering rows in its own order does not depend on this, but a caller
    // reading the response by eye should not have to sort it first.
    const rollups = new Map<string, PartyDealRollup>();

    for (const partyId of asked) {
      if (!rollups.has(partyId)) rollups.set(partyId, blankRollup(partyId));
    }

    for (const deal of deals) {
      const rollup = rollups.get(deal.partyId);
      if (!rollup) continue;

      const amount = Money.parse(exactly(deal.amount), DEFAULT_CURRENCY);

      if (deal.stage.outcome === 'won') {
        rollup.wonCount += 1;
        rollup.wonValue = Money.fromValue(rollup.wonValue).plus(amount).toValue();
      } else if (deal.stage.outcome === 'lost') {
        rollup.lostCount += 1;
      } else {
        rollup.openCount += 1;
        rollup.openValue = Money.fromValue(rollup.openValue).plus(amount).toValue();
      }
    }

    // A party with no deals is dropped rather than sent as zeroes: most of a page of contacts
    // has none, so zero-filling would make the empty case most of the response.
    return {
      items: [...rollups.values()].filter(
        (rollup) => rollup.openCount + rollup.wonCount + rollup.lostCount > 0,
      ),
    };
  }

  async deleteDeal(id: string): Promise<void> {
    await this.requireDeal(id);
    await this.prisma.deal.delete({ where: { id } });
  }

  private async requireDeal(id: string) {
    const deal = await this.prisma.deal.findFirst({ where: { id }, include: WITH_STAGE_OUTCOME });
    if (!deal) throw dealNotFound();
    return deal;
  }

  /** Scoped like everything else here — another company's Stage id resolves to nothing. */
  private async requireStage(id: string) {
    const stage = await this.prisma.stage.findFirst({ where: { id }, select: { outcome: true } });
    if (!stage) throw dealStageNotFound();
    return stage;
  }
}

function describe(row: {
  id: string;
  partyId: string;
  stageId: string;
  stage: { outcome: string | null };
  name: string;
  amount: Prisma.Decimal;
  expectedCloseDate: Date | null;
  assignedToUserId: string | null;
  originLeadId: string | null;
}): DealSummary {
  return {
    id: row.id,
    partyId: row.partyId,
    stageId: row.stageId,
    // The Stage's own outcome, read fresh rather than copied onto the Deal — see the class doc.
    stageOutcome: row.stage.outcome as StageOutcome,
    name: row.name,
    // Fixed to DEFAULT_CURRENCY, matching Product.cost: there is no currency column to read
    // back, because a Deal never chose one to begin with.
    amount: Money.wire(exactly(row.amount), DEFAULT_CURRENCY)!,
    expectedCloseDate: row.expectedCloseDate ? row.expectedCloseDate.toISOString().slice(0, 10) : null,
    assignedToUserId: row.assignedToUserId,
    originLeadId: row.originLeadId,
  };
}

/** A party asked about but not yet counted. Dropped before responding if it stays this way. */
function blankRollup(partyId: string): PartyDealRollup {
  return {
    partyId,
    openCount: 0,
    wonCount: 0,
    lostCount: 0,
    openValue: Money.zero(DEFAULT_CURRENCY).toValue(),
    wonValue: Money.zero(DEFAULT_CURRENCY).toValue(),
  };
}
