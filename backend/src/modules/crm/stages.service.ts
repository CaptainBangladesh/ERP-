import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  type SettableStageOutcome,
  type StageListResponse,
  type StageOutcome,
  type StageResponse,
  type StageSummary,
} from '@erp/shared';
import { defined } from '../../prisma/columns';
import { listQuery } from '../../platform/list';
import { companyApplied, InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import type { Valid } from '../../platform/validation';
import { duplicateStageOutcome, stageHasDeals, stageNotFound } from './refusals';
import { CreateStageBody, STAGE_LIST, UpdateStageBody } from './schemas';

/**
 * A company's own pipeline — the columns on the deals board.
 *
 * No seed data: a fresh company has zero Stages, and `DealsService.createDeal` cannot succeed
 * until one exists — the board's empty state is "create your first stage", per the spec.
 *
 * Two invariants live here rather than in the schema, because both are cross-row:
 *
 * - **`order` is unique per company.** Not a `@@unique` — see `schema.prisma` — because a
 *   reorder is a swap between rows, and an immediate unique index would refuse the first of two
 *   writes before the second could land. `reorder` below renumbers every Stage in the company
 *   to consecutive integers instead, in one transaction, which is what actually keeps it true.
 * - **At most one Stage per company means `'won'`, and at most one means `'lost'`.**
 *   `assertOutcomeAvailable` checks it before every write that could break it.
 *
 * As in every module, there is no company filter in this file: the platform scopes every query
 * below, so another company's Stages are not reachable from here even by trying.
 */
@Injectable()
export class StagesService {
  constructor(@InjectPrisma() private readonly prisma: ScopedPrisma) {}

  /**
   * Always appended after every existing Stage — see `CreateStageBody`. A client that wants it
   * anywhere else moves it with a second, ordinary `changeStage` call.
   */
  async createStage(input: Valid<typeof CreateStageBody>): Promise<StageResponse> {
    if (input.outcome) await this.assertOutcomeAvailable(input.outcome);

    const highest = await this.prisma.stage.findFirst({
      orderBy: { order: 'desc' },
      select: { order: true },
    });

    const stage = await this.prisma.stage.create({
      data: companyApplied<Prisma.StageUncheckedCreateInput>({
        name: input.name,
        order: (highest?.order ?? 0) + 1,
        outcome: input.outcome ?? null,
      }),
    });

    return describe(stage);
  }

  async listStages(query: Record<string, unknown>): Promise<StageListResponse> {
    const slice = listQuery(query, STAGE_LIST);

    const [rows, total] = await Promise.all([
      this.prisma.stage.findMany(slice.findMany<Prisma.StageFindManyArgs>()),
      this.prisma.stage.count(slice.count<Prisma.StageCountArgs>()),
    ]);

    return slice.respond(rows.map(describe), total);
  }

  async stageDetail(id: string): Promise<StageResponse> {
    return describe(await this.requireStage(id));
  }

  /**
   * Renames, sets an outcome, or moves a Stage — any combination in one request.
   *
   * A move (`order` present) is the one branch that touches more than its own row: it goes
   * through `reorder`, which renumbers the whole company's Stages inside a transaction so the
   * column stays contiguous and unique throughout, never merely at the end.
   */
  async changeStage(id: string, input: Valid<typeof UpdateStageBody>): Promise<StageResponse> {
    const existing = await this.requireStage(id);

    if (input.outcome && input.outcome !== existing.outcome) {
      await this.assertOutcomeAvailable(input.outcome, id);
    }

    const fields = {
      ...defined('name', input.name),
      ...defined('outcome', input.outcome),
    };

    if (input.order === undefined) {
      const stage = await this.prisma.stage.update({ where: { id }, data: fields });
      return describe(stage);
    }

    return describe(await this.reorder(id, existing, input.order, fields));
  }

  /**
   * Moves one Stage to `position` (1 and up, clamped to the company's Stage count) and
   * renumbers every Stage in the company to consecutive integers around it — inside one
   * transaction, so no reader ever sees a board with a gap or a repeat.
   */
  private async reorder(
    id: string,
    existing: { order: number },
    position: number,
    fields: Record<string, unknown>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const ordered = await tx.stage.findMany({ orderBy: { order: 'asc' } });
      // Only `id` and `order` matter to the renumbering below — a plain `{ id, order }` list
      // rather than the full rows, so the target (still holding its *old* order from just
      // before this transaction) can stand in for its own entry without a wider cast.
      const rest = ordered.filter((stage) => stage.id !== id).map((stage) => ({ id: stage.id, order: stage.order }));
      const clamped = Math.min(Math.max(position, 1), ordered.length);
      rest.splice(clamped - 1, 0, { id, order: existing.order });

      let moved: Awaited<ReturnType<typeof tx.stage.update>> | undefined;
      for (const [index, stage] of rest.entries()) {
        const order = index + 1;
        const isTarget = stage.id === id;
        if (!isTarget && order === stage.order) continue;

        const row = await tx.stage.update({
          where: { id: stage.id },
          data: isTarget ? { ...fields, order } : { order },
        });
        if (isTarget) moved = row;
      }

      // `moved` is always set: `id` is a member of `rest` by construction, so its iteration is
      // never skipped even when its position happens not to change.
      return moved!;
    });
  }

  /**
   * Refuses while any Deal still sits in this Stage — a company must move or close those Deals
   * first, so a Deal never ends up pointing at a Stage that no longer exists.
   */
  async deleteStage(id: string): Promise<void> {
    await this.requireStage(id);

    const occupied = await this.prisma.deal.count({ where: { stageId: id } });
    if (occupied > 0) throw stageHasDeals(occupied);

    await this.prisma.stage.delete({ where: { id } });
  }

  private async requireStage(id: string) {
    const stage = await this.prisma.stage.findFirst({ where: { id } });
    if (!stage) throw stageNotFound();
    return stage;
  }

  private async assertOutcomeAvailable(
    outcome: SettableStageOutcome,
    excludeId?: string,
  ): Promise<void> {
    const clash = await this.prisma.stage.findFirst({
      where: { outcome, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    });
    if (clash) throw duplicateStageOutcome(outcome);
  }
}

function describe(row: { id: string; name: string; order: number; outcome: string | null }): StageSummary {
  return {
    id: row.id,
    name: row.name,
    order: row.order,
    // The column is text rather than a Postgres enum — see schema.prisma — so the wire type is
    // asserted here, at the one boundary where the two representations meet.
    outcome: row.outcome as StageOutcome,
  };
}
