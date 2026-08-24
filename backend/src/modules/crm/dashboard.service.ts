import { Injectable } from '@nestjs/common';
import {
  DEFAULT_CURRENCY,
  Money,
  type ActivityCountByType,
  type ActivityCountByUser,
  type ActivityCountsResponse,
  type ActivityType,
  type PipelineValueResponse,
  type PipelineValueStageSummary,
  type StageOutcome,
  type WinLossRateResponse,
} from '@erp/shared';
import { exactly } from '../../prisma/columns';
import { InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';

@Injectable()
export class DashboardService {
  constructor(@InjectPrisma() private readonly prisma: ScopedPrisma) {}

  async getPipelineValue(): Promise<PipelineValueResponse> {
    const stages = await this.prisma.stage.findMany({
      orderBy: { order: 'asc' },
    });

    const groups = await this.prisma.deal.groupBy({
      by: ['stageId'],
      _sum: { amount: true },
      _count: { _all: true },
    });

    const groupMap = new Map(groups.map((g) => [g.stageId, g]));

    let totalInFlightAmount = Money.zero(DEFAULT_CURRENCY);
    let totalInFlightDeals = 0;
    let totalWonAmount = Money.zero(DEFAULT_CURRENCY);
    let totalWonDeals = 0;
    let totalLostAmount = Money.zero(DEFAULT_CURRENCY);
    let totalLostDeals = 0;

    const stageSummaries: PipelineValueStageSummary[] = stages.map((stage) => {
      const g = groupMap.get(stage.id);
      const dealCount = g?._count._all ?? 0;
      const sumDecimal = g?._sum.amount ? exactly(g._sum.amount) : '0';
      const totalValue = Money.wire(sumDecimal, DEFAULT_CURRENCY)!;
      const moneyObj = Money.fromValue(totalValue);

      if (stage.outcome === null) {
        totalInFlightAmount = totalInFlightAmount.plus(moneyObj);
        totalInFlightDeals += dealCount;
      } else if (stage.outcome === 'won') {
        totalWonAmount = totalWonAmount.plus(moneyObj);
        totalWonDeals += dealCount;
      } else if (stage.outcome === 'lost') {
        totalLostAmount = totalLostAmount.plus(moneyObj);
        totalLostDeals += dealCount;
      }

      return {
        stageId: stage.id,
        stageName: stage.name,
        order: stage.order,
        outcome: stage.outcome as StageOutcome,
        dealCount,
        totalValue,
      };
    });

    return {
      stages: stageSummaries,
      totalInFlightValue: totalInFlightAmount.toValue(),
      totalInFlightDeals,
      totalWonValue: totalWonAmount.toValue(),
      totalWonDeals,
      totalLostValue: totalLostAmount.toValue(),
      totalLostDeals,
    };
  }

  async getWinLossRate(fromDate?: string, toDate?: string): Promise<WinLossRateResponse> {
    const closedStages = await this.prisma.stage.findMany({
      where: { outcome: { in: ['won', 'lost'] } },
      select: { id: true, outcome: true },
    });

    if (closedStages.length === 0) {
      return { wonCount: 0, lostCount: 0, totalClosed: 0, winRate: 0 };
    }

    const stageOutcomeMap = new Map(closedStages.map((s) => [s.id, s.outcome]));
    const stageIds = closedStages.map((s) => s.id);

    const dateWhere: { gte?: Date; lte?: Date } = {};
    if (fromDate) dateWhere.gte = new Date(fromDate);
    if (toDate) {
      const end = new Date(toDate);
      if (toDate.length === 10) {
        end.setHours(23, 59, 59, 999);
      }
      dateWhere.lte = end;
    }

    const deals = await this.prisma.deal.findMany({
      where: {
        stageId: { in: stageIds },
        ...(Object.keys(dateWhere).length > 0 ? { updatedAt: dateWhere } : {}),
      },
      select: { stageId: true },
    });

    let wonCount = 0;
    let lostCount = 0;

    for (const d of deals) {
      const outcome = stageOutcomeMap.get(d.stageId);
      if (outcome === 'won') wonCount++;
      else if (outcome === 'lost') lostCount++;
    }

    const totalClosed = wonCount + lostCount;
    const winRate = totalClosed > 0 ? Number((wonCount / totalClosed).toFixed(4)) : 0;

    return {
      wonCount,
      lostCount,
      totalClosed,
      winRate,
    };
  }

  async getActivityCounts(fromDate?: string, toDate?: string): Promise<ActivityCountsResponse> {
    const dateWhere: { gte?: Date; lte?: Date } = {};
    if (fromDate) dateWhere.gte = new Date(fromDate);
    if (toDate) {
      const end = new Date(toDate);
      if (toDate.length === 10) {
        end.setHours(23, 59, 59, 999);
      }
      dateWhere.lte = end;
    }

    const where = Object.keys(dateWhere).length > 0 ? { occurredAt: dateWhere } : {};

    const [byTypeGroup, byUserGroup, totalCount] = await Promise.all([
      this.prisma.activity.groupBy({
        by: ['type'],
        _count: { _all: true },
        where,
      }),
      this.prisma.activity.groupBy({
        by: ['createdByUserId', 'createdByName'],
        _count: { _all: true },
        where,
      }),
      this.prisma.activity.count({ where }),
    ]);

    const byType: ActivityCountByType[] = byTypeGroup.map((g) => ({
      type: g.type as ActivityType,
      count: g._count._all,
    }));

    const byUser: ActivityCountByUser[] = byUserGroup.map((g) => ({
      userId: g.createdByUserId,
      userName: g.createdByName,
      count: g._count._all,
    }));

    return {
      byType,
      byUser,
      totalCount,
    };
  }
}
