import type { ScopedPrisma } from '../../platform/tenancy';

/**
 * Moving one row to a position on a company-ordered list, and renumbering the rest around it.
 *
 * Three tables in this module carry an `order` a person drags: `LeadGroup`, `LeadSource` and
 * `LeadFieldDefinition`. All three want exactly what `StagesService.reorder` already worked out —
 * write consecutive integers across the whole company inside one transaction, rather than
 * writing the requested number as-is and hoping nothing collides. Doing that three more times by
 * hand is three more chances to get the off-by-one wrong, so it is here once instead.
 *
 * `Stage` itself is deliberately left alone: it also enforces a one-`won`-one-`lost` rule inside
 * the same call, and untangling that to share this would be a rewrite of working code for no
 * gain the spec asked for.
 *
 * Why a transaction and not a `@@unique([companyId, order])`: a move is a swap between rows, and
 * an immediate unique index refuses the first of the two writes before the second can land. The
 * renumbering is what actually keeps the column unique, so it has to be atomic — a reader mid-way
 * through must never see a board with a gap or a repeat.
 */

/** The slice of a Prisma model delegate this needs. Structural, so all three tables satisfy it. */
interface OrderedDelegate<Row extends { id: string; order: number }> {
  findMany(args: { orderBy: { order: 'asc' } }): Promise<Row[]>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<Row>;
}

export async function reposition<Row extends { id: string; order: number }>(
  prisma: ScopedPrisma,
  /**
   * Picks the delegate off whichever client is in play. Called with the transaction client, so
   * every write below is inside the transaction — passing the delegate itself would silently
   * leave the reads and writes outside it.
   */
  delegate: (client: ScopedPrisma) => OrderedDelegate<Row>,
  id: string,
  currentOrder: number,
  /** 1 and up, clamped to the row count — "move here", never the column's new value. */
  position: number,
  /** Any other change to the moved row, applied in the same write. */
  fields: Record<string, unknown>,
): Promise<Row> {
  return prisma.$transaction(async (tx) => {
    const table = delegate(tx as unknown as ScopedPrisma);
    const ordered = await table.findMany({ orderBy: { order: 'asc' } });

    // Only `id` and `order` matter to the renumbering, so the target — still holding its old
    // order from just before this transaction — can stand in for its own entry without a cast.
    const rest = ordered
      .filter((row) => row.id !== id)
      .map((row) => ({ id: row.id, order: row.order }));

    const clamped = Math.min(Math.max(position, 1), ordered.length);
    rest.splice(clamped - 1, 0, { id, order: currentOrder });

    let moved: Row | undefined;
    for (const [index, row] of rest.entries()) {
      const order = index + 1;
      const isTarget = row.id === id;
      if (!isTarget && order === row.order) continue;

      const written = await table.update({
        where: { id: row.id },
        data: isTarget ? { ...fields, order } : { order },
      });
      if (isTarget) moved = written;
    }

    // Always set: `id` is a member of `rest` by construction, so its iteration is never skipped
    // even when its position happens not to change.
    return moved!;
  });
}
