import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  SYSTEM_ACTOR_ID,
  type PlanningCoordinationResponse,
  type PlanningCoordinationRow,
  type PlanningHeatmapResponse,
  type PlanningScheduleResponse,
  type PlanningScheduleTask,
  type HeatmapCell,
} from '@erp/shared';
import { InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import { PartyDirectory } from '../parties';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The team-and-time side of Sales Enablement & Planning: the forward scheduling calendar, the
 * backward activity heatmap, and the who-owns-what coordination view. All three rest on the
 * ticket-01 task assignee and the `DashboardService` precedent — Prisma aggregates and a fetch
 * bucketed in memory, never raw SQL (which would bypass tenant scoping). Every read is through the
 * scoped client, so a rep or a task from another company can never appear here.
 *
 * None of these reach into identity: a rep is a plain user id, and the frontend joins names — and
 * folds in team members who own nothing — against `GET /api/identity/users`, the same way every
 * assignment in this module is displayed.
 */
@Injectable()
export class PlanningService {
  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly parties: PartyDirectory,
  ) {}

  /**
   * Upcoming dated tasks across the whole team, oldest due first. Defaults to a two-week look-ahead
   * from the start of today when no window is given — the horizon a rep actually plans against.
   */
  async schedule(fromDate?: string, toDate?: string): Promise<PlanningScheduleResponse> {
    const from = fromDate ? new Date(fromDate) : startOfUtcDay(new Date());
    const to = toDate ? endOfDay(toDate) : new Date(from.getTime() + 14 * DAY_MS);

    const tasks = await this.prisma.activity.findMany({
      where: { type: 'task', dueAt: { gte: from, lte: to } },
      orderBy: { dueAt: 'asc' },
    });

    const items = await this.withParentNames(tasks);
    return { from: from.toISOString(), to: to.toISOString(), items };
  }

  /**
   * Per-rep, per-day authored-activity counts over the trailing window (12 weeks by default).
   *
   * `groupBy` cannot truncate a timestamp to a day portably, so — following the lead-source
   * rollup's own shape — the rows are fetched thin (author and time only) and bucketed in memory.
   * The volume is one company's activity over a bounded window, not the whole history. System rows
   * (`createdByUserId === SYSTEM_ACTOR_ID`) are excluded so automation does not read as a person's
   * work.
   */
  async heatmap(weeks: number): Promise<PlanningHeatmapResponse> {
    const span = clampWeeks(weeks);
    const days = span * 7;
    const to = endOfUtcDay(new Date());
    const from = startOfUtcDay(new Date(to.getTime() - (days - 1) * DAY_MS));

    const rows = await this.prisma.activity.findMany({
      where: {
        occurredAt: { gte: from, lte: to },
        createdByUserId: { not: SYSTEM_ACTOR_ID },
      },
      select: { createdByUserId: true, occurredAt: true },
    });

    // key: `${userId}|${YYYY-MM-DD}` → count
    const tally = new Map<string, number>();
    for (const row of rows) {
      const key = `${row.createdByUserId}|${dateKey(row.occurredAt)}`;
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }

    const cells: HeatmapCell[] = [...tally.entries()].map(([key, count]) => {
      const [userId, date] = key.split('|') as [string, string];
      return { userId, date, count };
    });

    return { from: dateKey(from), to: dateKey(to), cells };
  }

  /**
   * Each rep's current workload — owned leads, open deals, open tasks, and the overdue subset —
   * the numbers a manager reads to see where load has piled up. Every count is a scoped aggregate
   * keyed by user id; the frontend joins names and adds idle members as zeroes.
   */
  async coordination(): Promise<PlanningCoordinationResponse> {
    const now = new Date();

    const closedStages = await this.prisma.stage.findMany({
      where: { outcome: { in: ['won', 'lost'] } },
      select: { id: true },
    });
    const closedStageIds = closedStages.map((stage) => stage.id);

    const [leadGroups, openDealGroups, openTaskGroups, overdueGroups] = await Promise.all([
      this.prisma.leadAssignee.groupBy({ by: ['userId'], _count: { _all: true } }),
      this.prisma.deal.groupBy({
        by: ['assignedToUserId'],
        _count: { _all: true },
        where: { assignedToUserId: { not: null }, stageId: { notIn: closedStageIds } },
      }),
      this.prisma.activity.groupBy({
        by: ['assignedToUserId'],
        _count: { _all: true },
        where: { type: 'task', completedAt: null, assignedToUserId: { not: null } },
      }),
      this.prisma.activity.groupBy({
        by: ['assignedToUserId'],
        _count: { _all: true },
        where: {
          type: 'task',
          completedAt: null,
          dueAt: { lt: now },
          assignedToUserId: { not: null },
        },
      }),
    ]);

    const rows = new Map<string, PlanningCoordinationRow>();
    const rowFor = (userId: string): PlanningCoordinationRow => {
      let row = rows.get(userId);
      if (!row) {
        row = { userId, leadCount: 0, openDealCount: 0, openTaskCount: 0, overdueTaskCount: 0 };
        rows.set(userId, row);
      }
      return row;
    };

    for (const group of leadGroups) rowFor(group.userId).leadCount = group._count._all;
    for (const group of openDealGroups) {
      if (group.assignedToUserId) rowFor(group.assignedToUserId).openDealCount = group._count._all;
    }
    for (const group of openTaskGroups) {
      if (group.assignedToUserId) rowFor(group.assignedToUserId).openTaskCount = group._count._all;
    }
    for (const group of overdueGroups) {
      if (group.assignedToUserId) rowFor(group.assignedToUserId).overdueTaskCount = group._count._all;
    }

    return { items: [...rows.values()] };
  }

  /**
   * Resolves each task's parent to a name in three bulk reads — one per parent kind — rather than a
   * lookup per row, the same N+1-avoiding shape the company feed uses. A parent that has since been
   * removed lends a `null` name, which is the honest thing to show over a dangling id.
   */
  private async withParentNames(
    tasks: Prisma.ActivityGetPayload<Record<string, never>>[],
  ): Promise<PlanningScheduleTask[]> {
    const unique = (pick: (row: (typeof tasks)[number]) => string | null): string[] => [
      ...new Set(tasks.map(pick).filter((id): id is string => id !== null)),
    ];

    const leadIds = unique((row) => row.leadId);
    const dealIds = unique((row) => row.dealId);
    const partyIds = unique((row) => row.partyId);

    const [leads, deals, parties] = await Promise.all([
      leadIds.length
        ? this.prisma.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
      dealIds.length
        ? this.prisma.deal.findMany({ where: { id: { in: dealIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
      partyIds.length ? this.parties.parties(partyIds) : Promise.resolve([]),
    ]);

    const leadNames = new Map(leads.map((lead) => [lead.id, lead.name]));
    const dealNames = new Map(deals.map((deal) => [deal.id, deal.name]));
    const partyNames = new Map(parties.map((party) => [party.id, party.name]));

    return tasks.map((task) => {
      const base = {
        id: task.id,
        notes: task.notes,
        dueAt: task.dueAt!.toISOString(),
        completedAt: task.completedAt ? task.completedAt.toISOString() : null,
        assignedToUserId: task.assignedToUserId,
      };
      if (task.leadId) {
        return { ...base, parentKind: 'lead', parentId: task.leadId, parentName: leadNames.get(task.leadId) ?? null };
      }
      if (task.dealId) {
        return { ...base, parentKind: 'deal', parentId: task.dealId, parentName: dealNames.get(task.dealId) ?? null };
      }
      if (task.partyId) {
        return { ...base, parentKind: 'party', parentId: task.partyId, parentName: partyNames.get(task.partyId) ?? null };
      }
      return { ...base, parentKind: null, parentId: null, parentName: null };
    });
  }
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function endOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

/** A `from`/`to` a caller passed. A bare `YYYY-MM-DD` end means "through the end of that day". */
function endOfDay(value: string): Date {
  const date = new Date(value);
  if (value.length === 10) date.setUTCHours(23, 59, 59, 999);
  return date;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The heatmap window, kept between one and twenty-six weeks so a stray query cannot ask for years. */
function clampWeeks(weeks: number): number {
  if (!Number.isFinite(weeks)) return 12;
  return Math.min(26, Math.max(1, Math.floor(weeks)));
}
