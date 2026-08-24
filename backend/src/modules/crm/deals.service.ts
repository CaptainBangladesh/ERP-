import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CRM_EVENTS,
  DEFAULT_CURRENCY,
  Money,
  type DealListResponse,
  type DealResponse,
  type DealSummary,
  type StageOutcome,
} from '@erp/shared';
import { defined, exactly } from '../../prisma/columns';
import { DomainEvents } from '../../platform/events';
import { listQuery } from '../../platform/list';
import { companyApplied, InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import type { Valid } from '../../platform/validation';
import { PartyDirectory } from '../parties';
import { dealNotFound, dealPartyNotFound, dealStageNotFound } from './refusals';
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
