import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AI_GENERATION_ESTIMATE_CENTS,
  MARKETING_ERROR_CODES,
  aiCostCents,
  aiPeriodKey,
  aiPeriodResetsAt,
  type AiAllowanceResponse,
} from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { companyApplied, InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';

/** What a reservation hands back so the reconciliation can find its own row. */
export interface AiReservation {
  readonly period: string;
  readonly reservedCents: number;
  readonly source: 'platform' | 'tenant';
  readonly model: string;
  readonly brandId: string;
  readonly userId?: string;
  readonly startedAt: number;
}

export interface AiUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/**
 * The allowance, as a ledger rather than a forecast (14d, 14p).
 *
 * Two clicks of *regenerate* arriving together are exactly how a ceiling becomes a
 * suggestion, and this module has already shipped one at-least-once double-spend (11.4b). So
 * the reservation is a single conditional statement — increment the counter only if the
 * result still fits under the cap — and **zero rows affected is the refusal**. Nothing reads
 * a balance and then decides.
 *
 * The order is: reserve, call, reconcile. The reservation is the ceiling price of a
 * generation; the reconciliation writes the difference back from `response.usage`, and gives
 * the whole reservation back when the call failed, timed out or was aborted — a provider
 * outage must not eat a tenant's month.
 *
 * Denominated in cents of model spend, not in request counts, so a longer prompt or a
 * chattier model cannot quietly raise the ceiling (14d). The counter is a column, because the
 * comparison and the increment have to happen in the same statement (12.3e).
 */
@Injectable()
export class AiAllowanceService {
  private readonly logger = new Logger('MarketingAi');

  constructor(@InjectPrisma() private readonly prisma: ScopedPrisma) {}

  /**
   * Cap, spend and reset date for the current period — what the composer shows *before* the
   * user generates rather than after a refusal (14q).
   */
  async read(capCents: number, source: 'platform' | 'tenant', model: string): Promise<AiAllowanceResponse> {
    const period = aiPeriodKey();
    const row = await this.currentPeriod(period, capCents);

    return describe(row, period, source, model);
  }

  /**
   * Charge the ceiling price of one generation, or refuse.
   *
   * Committed before the provider call, which is the whole point: a refusal costs the vendor
   * nothing and reaches the user with the date their allowance comes back (14q).
   */
  async reserve(input: {
    brandId: string;
    userId?: string;
    capCents: number;
    source: 'platform' | 'tenant';
    model: string;
  }): Promise<AiReservation> {
    const period = aiPeriodKey();
    await this.currentPeriod(period, input.capCents);

    const headroom = new Prisma.Decimal(input.capCents).minus(AI_GENERATION_ESTIMATE_CENTS);

    const claimed = await this.prisma.aiGenerationAllowance.updateMany({
      where: { period, spentCents: { lte: headroom } },
      data: { spentCents: { increment: AI_GENERATION_ESTIMATE_CENTS } },
    });

    if (claimed.count === 0) {
      await this.append({
        brandId: input.brandId,
        userId: input.userId,
        period,
        entry: 'reserve',
        amountCents: 0,
        model: input.model,
        outcome: 'refused',
      });

      throw new ApiException(
        MARKETING_ERROR_CODES.aiAllowanceExhausted,
        `This workspace has used its writing allowance for ${period}. It resets on ` +
          `${aiPeriodResetsAt(period).slice(0, 10)}. A workspace API key raises the limit.`,
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    await this.append({
      brandId: input.brandId,
      userId: input.userId,
      period,
      entry: 'reserve',
      amountCents: AI_GENERATION_ESTIMATE_CENTS,
      model: input.model,
      outcome: 'reserved',
    });

    return {
      period,
      reservedCents: AI_GENERATION_ESTIMATE_CENTS,
      source: input.source,
      model: input.model,
      brandId: input.brandId,
      ...(input.userId ? { userId: input.userId } : {}),
      startedAt: Date.now(),
    };
  }

  /**
   * Settle a reservation against what the call actually cost.
   *
   * `usage` absent means the call did not produce one — a failure, a timeout, an abort — and
   * the whole reservation comes back. The audit row this writes is the one an operator reads:
   * company, brand, user, model, token counts, latency and outcome, and **no prompt text, no
   * completion text, no fenced block** (14r).
   */
  async reconcile(reservation: AiReservation, usage: AiUsage | undefined): Promise<void> {
    const actual = usage ? aiCostCents(usage.inputTokens, usage.outputTokens) : 0;
    const delta = round(actual - reservation.reservedCents);
    const latencyMs = Date.now() - reservation.startedAt;

    if (delta !== 0) {
      await this.prisma.aiGenerationAllowance.updateMany({
        where: { period: reservation.period },
        data: { spentCents: { increment: delta } },
      });
    }

    await this.append({
      brandId: reservation.brandId,
      userId: reservation.userId,
      period: reservation.period,
      entry: 'reconcile',
      amountCents: delta,
      model: reservation.model,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      latencyMs,
      outcome: usage ? 'succeeded' : 'failed',
    });

    this.logger.log(
      `Generation ${usage ? 'succeeded' : 'failed'}: brand=${reservation.brandId} ` +
        `user=${reservation.userId ?? 'unknown'} model=${reservation.model} ` +
        `source=${reservation.source} in=${usage?.inputTokens ?? 0} ` +
        `out=${usage?.outputTokens ?? 0} latencyMs=${latencyMs}`,
    );
  }

  /**
   * The row for this period, created at zero if the month is new.
   *
   * The cap is refreshed on every read because a tenant who adds their own key mid-month
   * moves onto the larger allowance immediately (14h) — and one who removes it moves back.
   */
  private async currentPeriod(
    period: string,
    capCents: number,
  ): Promise<{ capCents: Prisma.Decimal; spentCents: Prisma.Decimal }> {
    const existing = await this.prisma.aiGenerationAllowance.findFirst({
      where: { period },
      select: { id: true, capCents: true, spentCents: true },
    });

    if (existing) {
      if (!existing.capCents.equals(capCents)) {
        const updated = await this.prisma.aiGenerationAllowance.update({
          where: { id: existing.id },
          data: { capCents },
          select: { capCents: true, spentCents: true },
        });
        return updated;
      }
      return existing;
    }

    try {
      return await this.prisma.aiGenerationAllowance.create({
        data: companyApplied<Prisma.AiGenerationAllowanceUncheckedCreateInput>({
          period,
          capCents,
        }),
        select: { capCents: true, spentCents: true },
      });
    } catch {
      // Two first requests of the month racing. The unique index decided; re-read its answer.
      const raced = await this.prisma.aiGenerationAllowance.findFirst({
        where: { period },
        select: { capCents: true, spentCents: true },
      });
      if (raced) return raced;
      throw new ApiException(
        MARKETING_ERROR_CODES.aiProviderFailed,
        'The writing allowance could not be read. Nothing was charged.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /** Append-only. A correction is a new row; the table is immutable in `company-owned.ts`. */
  private async append(entry: {
    brandId: string;
    userId?: string;
    period: string;
    entry: 'reserve' | 'reconcile';
    amountCents: number;
    model: string;
    inputTokens?: number;
    outputTokens?: number;
    latencyMs?: number;
    outcome: string;
  }): Promise<void> {
    await this.prisma.aiGenerationLedger.create({
      data: companyApplied<Prisma.AiGenerationLedgerUncheckedCreateInput>({
        brandId: entry.brandId,
        userId: entry.userId,
        period: entry.period,
        entry: entry.entry,
        amountCents: entry.amountCents,
        model: entry.model,
        inputTokens: entry.inputTokens ?? 0,
        outputTokens: entry.outputTokens ?? 0,
        latencyMs: entry.latencyMs ?? 0,
        outcome: entry.outcome,
      }),
    });
  }
}

function describe(
  row: { capCents: Prisma.Decimal; spentCents: Prisma.Decimal },
  period: string,
  source: 'platform' | 'tenant',
  model: string,
): AiAllowanceResponse {
  // `toFixed`, never `toString`: a Prisma decimal stringifies in exponential notation past a
  // certain size, and a cap that reads `5e-2` on screen is a cap nobody believes.
  const capCents = Number(row.capCents.toFixed(4));
  const spentCents = Number(row.spentCents.toFixed(4));
  const remainingCents = round(Math.max(0, capCents - spentCents));

  return {
    period,
    capCents,
    spentCents,
    remainingCents,
    remainingGenerations: Math.floor(remainingCents / AI_GENERATION_ESTIMATE_CENTS),
    resetsAt: aiPeriodResetsAt(period),
    source,
    model,
  };
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
