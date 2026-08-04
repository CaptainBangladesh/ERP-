import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  Decimal,
  INVENTORY_EVENTS,
  Money,
  Quantity,
  type MovementClassification,
  type MovementKind,
  type MovementListResponse,
  type MovementResponse,
  type MovementSummary,
  type StockMovementRecorded,
} from '@erp/shared';
import { DomainEvents } from '../../platform/events';
import { listQuery } from '../../platform/list';
import { companyApplied, InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import type { Valid } from '../../platform/validation';
import { exactly } from '../../prisma/columns';
import { ProductCatalogue } from '../products';
import { InventoryReferences, type Resolved } from './references';
import {
  alreadyReversed,
  locationNotFound,
  locationNotInUse,
  movementNotFound,
  movementProductNotFound,
  negativeStockRefused,
  productNotStockable,
  transferSameLocation,
} from './refusals';
import { MOVEMENT_LIST, RecordAdjustmentBody, RecordMovementBody, RecordTransferBody } from './schemas';

/**
 * The ledger: what moved, where, how much, who did it and when.
 *
 * Four decisions hold this module up, and each is a decision rather than a default:
 *
 * - **Nothing is ever edited or deleted.** `StockMovement` is declared immutable in
 *   `platform/tenancy/company-owned.ts`, so `update` and `delete` are refused by the platform
 *   before they reach the database — there is no route that offers them and no code path that
 *   could. A mistake is corrected by recording another movement, which is ticket 11's reversal.
 * - **The stock level is written in the same transaction as the movement that changes it.**
 *   The level is a running total and the ledger is the record; two writes that could land apart
 *   would be two numbers that disagree, and the disagreement would be invisible until somebody
 *   counted a shelf.
 * - **Value and classification are frozen onto every row.** This is the accounting seam. No
 *   accounting module exists and this one depends on none — but every movement already carries
 *   what a journal entry needs, so adding Accounting later is a read of history rather than a
 *   reopening of it.
 * - **The event is emitted after the transaction commits, never inside it.** A listener inside
 *   the write would see a movement that could still roll back, and a slow one would hold a row
 *   lock open while it worked.
 *
 * As in every module, there is no company filter in this file: the platform scopes every query
 * below, so another company's stock is not reachable from here even by trying.
 */
/**
 * The one thing the negative-stock check needs from the transaction it runs inside.
 *
 * Named as a capability rather than typed as the whole client, because the type
 * `$transaction` hands a callback on an *extended* Prisma client is Prisma's business and
 * awkward to name from here — and because what this check actually does is one read. A
 * parameter that says so is narrower than the client, cannot be used to widen the check
 * later without saying so here first, and does not need `any` to compile.
 */
interface ReadsStockLevels {
  stockLevel: {
    findFirst(args: {
      where: { productId: string; locationId: string };
      select: { quantity: true };
    }): Promise<{ quantity: Prisma.Decimal } | null>;
  };
}

@Injectable()
export class MovementsService {
  private readonly locks = new ResourceLockManager();

  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly products: ProductCatalogue,
    private readonly references: InventoryReferences,
    private readonly events: DomainEvents,
  ) {}

  private async assertNegativeStockPolicy(
    tx: ReadsStockLevels,
    productId: string,
    locationId: string,
    deltaQuantity: Decimal,
    locationName: string,
    productCode: string,
  ): Promise<void> {
    if (deltaQuantity.compare(Decimal.ZERO) >= 0) return;

    const setting = await this.prisma.inventorySetting.findFirst();

    const allowNegative = setting?.allowNegativeStock ?? false;
    if (allowNegative) return;

    const currentLevel = await tx.stockLevel.findFirst({
      where: { productId, locationId },
      select: { quantity: true },
    });

    const currentQty = currentLevel
      ? Decimal.parse(exactly(currentLevel.quantity))
      : Decimal.ZERO;
    const newQty = currentQty.plus(deltaQuantity);

    if (newQty.compare(Decimal.ZERO) < 0) {
      throw negativeStockRefused(
        locationName,
        productCode,
        currentQty.toString(),
        deltaQuantity.negated().toString(),
      );
    }
  }

  /**
   * Goods arriving, and goods leaving — one method, because they are one act with a sign.
   *
   * The two are separate *endpoints* and separate intents, which is what the caller chooses
   * between; by the time it reaches here the only difference is which way the quantity pushes
   * and what a journal entry would call it. Writing that difference twice would be two copies
   * of the transaction that keeps the ledger and the level in step, and one of them would
   * eventually gain a fix the other did not.
   */
  async record(
    kind: RecordedDirectly,
    actor: Actor,
    input: Valid<typeof RecordMovementBody>,
  ): Promise<MovementResponse> {
    const product = await this.products.product(input.productId);
    if (!product) throw movementProductNotFound();
    if (!product.stockable) throw productNotStockable(product.name);

    const location = await this.prisma.location.findFirst({ where: { id: input.locationId } });
    if (!location) throw locationNotFound();
    if (location.status !== 'active') throw locationNotInUse(location.name);

    const { classification, direction } = SHAPE[kind];

    // Signed once, here, and never by a caller. The endpoint chosen is what says which way
    // stock went; a request body that could say `-5` for a receipt would put the one rule that
    // makes every stock figure right into forty callers' hands.
    const quantity = direction === 'up' ? input.quantity : input.quantity.negated();

    // Frozen at the moment of recording rather than read back from the product later: the cost
    // of a widget changes, and last April's receipt was still worth what it was worth then.
    // Null all the way through when no cost has been recorded — see the contract on why that is
    // not zero.
    const unitCost = product.cost;
    const value = unitCost
      ? Money.fromValue(unitCost).times(quantity).round('half-even')
      : undefined;

    const lockKey = `${input.productId}:${input.locationId}`;

    const movement = await this.locks.acquire([lockKey], async () => {
      return this.prisma.$transaction(async (tx) => {
        await this.assertNegativeStockPolicy(
          tx,
          input.productId,
          input.locationId,
          quantity,
          location.name,
          product.code,
        );

        const written = await tx.stockMovement.create({
          data: companyApplied<Prisma.StockMovementUncheckedCreateInput>({
            kind,
            classification,
            productId: input.productId,
            locationId: input.locationId,
            quantity: quantity.toString(),
            unitCode: product.unitCode,
            unitCost: unitCost?.amount,
            value: value?.toValue().amount,
            recordedById: actor.id,
            recordedByName: actor.name,
          }),
        });

        const level = await tx.stockLevel.findFirst({
          where: { productId: input.productId, locationId: input.locationId },
          select: { id: true, quantity: true },
        });

        if (level) {
          await tx.stockLevel.update({
            where: { id: level.id },
            data: { quantity: Decimal.parse(exactly(level.quantity)).plus(quantity).toString() },
          });
        } else {
          await tx.stockLevel.create({
            data: companyApplied<Prisma.StockLevelUncheckedCreateInput>({
              productId: input.productId,
              locationId: input.locationId,
              quantity: quantity.toString(),
            }),
          });
        }

        return written;
      });
    });

    this.events.emit<StockMovementRecorded>(INVENTORY_EVENTS.movementRecorded, {
      movementId: movement.id,
      kind,
      classification,
      productId: movement.productId,
      locationId: movement.locationId,
      quantity: quantity.toString(),
      value: value?.toValue() ?? null,
      recordedById: movement.recordedById,
      recordedAt: movement.recordedAt.toISOString(),
    });

    return describe(movement, await this.references.resolve([movement]));
  }

  async recordAdjustment(
    actor: Actor,
    input: Valid<typeof RecordAdjustmentBody>,
  ): Promise<MovementResponse> {
    const product = await this.products.product(input.productId);
    if (!product) throw movementProductNotFound();
    if (!product.stockable) throw productNotStockable(product.name);

    const location = await this.prisma.location.findFirst({ where: { id: input.locationId } });
    if (!location) throw locationNotFound();
    if (location.status !== 'active') throw locationNotInUse(location.name);

    const quantity = input.quantity;
    const classification: MovementClassification = quantity.compare(Decimal.ZERO) > 0
      ? 'stock-in'
      : 'stock-out';

    const unitCost = product.cost;
    const value = unitCost
      ? Money.fromValue(unitCost).times(quantity).round('half-even')
      : undefined;

    const lockKey = `${input.productId}:${input.locationId}`;

    const movement = await this.locks.acquire([lockKey], async () => {
      return this.prisma.$transaction(async (tx) => {
        await this.assertNegativeStockPolicy(
          tx,
          input.productId,
          input.locationId,
          quantity,
          location.name,
          product.code,
        );

        const written = await tx.stockMovement.create({
          data: companyApplied<Prisma.StockMovementUncheckedCreateInput>({
            kind: 'adjustment',
            classification,
            productId: input.productId,
            locationId: input.locationId,
            quantity: quantity.toString(),
            unitCode: product.unitCode,
            unitCost: unitCost?.amount,
            value: value?.toValue().amount,
            reason: input.reason,
            recordedById: actor.id,
            recordedByName: actor.name,
          }),
        });

        const level = await tx.stockLevel.findFirst({
          where: { productId: input.productId, locationId: input.locationId },
          select: { id: true, quantity: true },
        });

        if (level) {
          await tx.stockLevel.update({
            where: { id: level.id },
            data: { quantity: Decimal.parse(exactly(level.quantity)).plus(quantity).toString() },
          });
        } else {
          await tx.stockLevel.create({
            data: companyApplied<Prisma.StockLevelUncheckedCreateInput>({
              productId: input.productId,
              locationId: input.locationId,
              quantity: quantity.toString(),
            }),
          });
        }

        return written;
      });
    });

    this.events.emit<StockMovementRecorded>(INVENTORY_EVENTS.movementRecorded, {
      movementId: movement.id,
      kind: 'adjustment',
      classification,
      productId: movement.productId,
      locationId: movement.locationId,
      quantity: quantity.toString(),
      value: value?.toValue() ?? null,
      recordedById: movement.recordedById,
      recordedAt: movement.recordedAt.toISOString(),
      reason: input.reason,
    });

    return describe(movement, await this.references.resolve([movement]));
  }

  async recordTransfer(
    actor: Actor,
    input: Valid<typeof RecordTransferBody>,
  ): Promise<{ from: MovementResponse; to: MovementResponse }> {
    if (input.fromLocationId === input.toLocationId) {
      throw transferSameLocation();
    }

    const product = await this.products.product(input.productId);
    if (!product) throw movementProductNotFound();
    if (!product.stockable) throw productNotStockable(product.name);

    const fromLocation = await this.prisma.location.findFirst({
      where: { id: input.fromLocationId },
    });
    if (!fromLocation) throw locationNotFound();
    if (fromLocation.status !== 'active') throw locationNotInUse(fromLocation.name);

    const toLocation = await this.prisma.location.findFirst({
      where: { id: input.toLocationId },
    });
    if (!toLocation) throw locationNotFound();
    if (toLocation.status !== 'active') throw locationNotInUse(toLocation.name);

    const transferId = randomUUID();
    const outQuantity = input.quantity.negated();
    const inQuantity = input.quantity;

    const unitCost = product.cost;
    const outValue = unitCost
      ? Money.fromValue(unitCost).times(outQuantity).round('half-even')
      : undefined;
    const inValue = unitCost
      ? Money.fromValue(unitCost).times(inQuantity).round('half-even')
      : undefined;

    const lockKeys = [
      `${input.productId}:${input.fromLocationId}`,
      `${input.productId}:${input.toLocationId}`,
    ];

    const [outMovement, inMovement] = await this.locks.acquire(lockKeys, async () => {
      return this.prisma.$transaction(async (tx) => {
        await this.assertNegativeStockPolicy(
          tx,
          input.productId,
          input.fromLocationId,
          outQuantity,
          fromLocation.name,
          product.code,
        );

        const outWritten = await tx.stockMovement.create({
          data: companyApplied<Prisma.StockMovementUncheckedCreateInput>({
            kind: 'transfer',
            classification: 'transfer',
            productId: input.productId,
            locationId: input.fromLocationId,
            quantity: outQuantity.toString(),
            unitCode: product.unitCode,
            unitCost: unitCost?.amount,
            value: outValue?.toValue().amount,
            transferId,
            recordedById: actor.id,
            recordedByName: actor.name,
          }),
        });

        const fromLevel = await tx.stockLevel.findFirst({
          where: { productId: input.productId, locationId: input.fromLocationId },
          select: { id: true, quantity: true },
        });

        if (fromLevel) {
          await tx.stockLevel.update({
            where: { id: fromLevel.id },
            data: {
              quantity: Decimal.parse(exactly(fromLevel.quantity)).plus(outQuantity).toString(),
            },
          });
        } else {
          await tx.stockLevel.create({
            data: companyApplied<Prisma.StockLevelUncheckedCreateInput>({
              productId: input.productId,
              locationId: input.fromLocationId,
              quantity: outQuantity.toString(),
            }),
          });
        }

        const inWritten = await tx.stockMovement.create({
          data: companyApplied<Prisma.StockMovementUncheckedCreateInput>({
            kind: 'transfer',
            classification: 'transfer',
            productId: input.productId,
            locationId: input.toLocationId,
            quantity: inQuantity.toString(),
            unitCode: product.unitCode,
            unitCost: unitCost?.amount,
            value: inValue?.toValue().amount,
            transferId,
            recordedById: actor.id,
            recordedByName: actor.name,
          }),
        });

        const toLevel = await tx.stockLevel.findFirst({
          where: { productId: input.productId, locationId: input.toLocationId },
          select: { id: true, quantity: true },
        });

        if (toLevel) {
          await tx.stockLevel.update({
            where: { id: toLevel.id },
            data: {
              quantity: Decimal.parse(exactly(toLevel.quantity)).plus(inQuantity).toString(),
            },
          });
        } else {
          await tx.stockLevel.create({
            data: companyApplied<Prisma.StockLevelUncheckedCreateInput>({
              productId: input.productId,
              locationId: input.toLocationId,
              quantity: inQuantity.toString(),
            }),
          });
        }

        return [outWritten, inWritten];
      });
    });

    this.events.emit<StockMovementRecorded>(INVENTORY_EVENTS.movementRecorded, {
      movementId: outMovement.id,
      kind: 'transfer',
      classification: 'transfer',
      productId: outMovement.productId,
      locationId: outMovement.locationId,
      quantity: outQuantity.toString(),
      value: outValue?.toValue() ?? null,
      recordedById: outMovement.recordedById,
      recordedAt: outMovement.recordedAt.toISOString(),
      transferId,
    });

    this.events.emit<StockMovementRecorded>(INVENTORY_EVENTS.movementRecorded, {
      movementId: inMovement.id,
      kind: 'transfer',
      classification: 'transfer',
      productId: inMovement.productId,
      locationId: inMovement.locationId,
      quantity: inQuantity.toString(),
      value: inValue?.toValue() ?? null,
      recordedById: inMovement.recordedById,
      recordedAt: inMovement.recordedAt.toISOString(),
      transferId,
    });

    const resolved = await this.references.resolve([outMovement, inMovement]);
    return {
      from: describe(outMovement, resolved),
      to: describe(inMovement, resolved),
    };
  }

  async reverse(actor: Actor, movementId: string): Promise<MovementResponse> {
    const original = await this.prisma.stockMovement.findFirst({ where: { id: movementId } });
    if (!original) throw movementNotFound();

    const existingReversal = await this.prisma.stockMovement.findFirst({
      where: { reversedMovementId: movementId },
    });
    if (existingReversal) throw alreadyReversed();

    if (original.transferId) {
      const twinMovements = await this.prisma.stockMovement.findMany({
        where: { transferId: original.transferId },
      });

      for (const m of twinMovements) {
        const rev = await this.prisma.stockMovement.findFirst({
          where: { reversedMovementId: m.id },
        });
        if (rev) throw alreadyReversed();
      }

      const newTransferId = randomUUID();
      const product = await this.products.product(original.productId);

      const lockKeys = twinMovements.map((m) => `${m.productId}:${m.locationId}`);

      const [rev1, rev2] = await this.locks.acquire(lockKeys, async () => {
        return this.prisma.$transaction(async (tx) => {
          const reversals = [];
          for (const m of twinMovements) {
            const origQty = Decimal.parse(exactly(m.quantity));
            const revQty = origQty.negated();
            const origVal = m.value ? Decimal.parse(exactly(m.value)) : null;
            const revVal = origVal ? origVal.negated() : null;

            const loc = await tx.location.findFirst({ where: { id: m.locationId } });
            const locName = loc ? loc.name : 'Unknown';
            const prodCode = product ? product.code : 'UNKNOWN';

            await this.assertNegativeStockPolicy(
              tx,
              m.productId,
              m.locationId,
              revQty,
              locName,
              prodCode,
            );

            const written = await tx.stockMovement.create({
              data: companyApplied<Prisma.StockMovementUncheckedCreateInput>({
                kind: 'reversal',
                classification: 'transfer',
                productId: m.productId,
                locationId: m.locationId,
                quantity: revQty.toString(),
                unitCode: m.unitCode,
                // `exactly`, never `toString()`: these two are `Prisma.Decimal` read back off
                // the original row, and Prisma prints a large one in exponential notation that
                // `Decimal.parse` refuses. `revQty` and `revVal` above are this codebase's own
                // `Decimal`, whose `toString` is the canonical form. See src/prisma/columns.ts.
                unitCost: exactly(m.unitCost),
                value: revVal?.toString(),
                transferId: newTransferId,
                reversedMovementId: m.id,
                recordedById: actor.id,
                recordedByName: actor.name,
              }),
            });

            const level = await tx.stockLevel.findFirst({
              where: { productId: m.productId, locationId: m.locationId },
              select: { id: true, quantity: true },
            });

            if (level) {
              await tx.stockLevel.update({
                where: { id: level.id },
                data: { quantity: Decimal.parse(exactly(level.quantity)).plus(revQty).toString() },
              });
            } else {
              await tx.stockLevel.create({
                data: companyApplied<Prisma.StockLevelUncheckedCreateInput>({
                  productId: m.productId,
                  locationId: m.locationId,
                  quantity: revQty.toString(),
                }),
              });
            }

            reversals.push(written);
          }
          return reversals;
        });
      });

      for (const rev of [rev1, rev2]) {
        if (!rev) continue;
        this.events.emit<StockMovementRecorded>(INVENTORY_EVENTS.movementRecorded, {
          movementId: rev.id,
          kind: 'reversal',
          classification: 'transfer',
          productId: rev.productId,
          locationId: rev.locationId,
          // Off the written row, so `Prisma.Decimal` and therefore `exactly`.
          quantity: exactly(rev.quantity),
          value: rev.value ? Money.wire(exactly(rev.value)) : null,
          recordedById: rev.recordedById,
          recordedAt: rev.recordedAt.toISOString(),
          transferId: newTransferId,
          reversedMovementId: rev.reversedMovementId,
        });
      }

      const targetRev = [rev1, rev2].find((r) => r && r.reversedMovementId === movementId);
      if (!targetRev) throw movementNotFound();
      return describe(targetRev, await this.references.resolve([targetRev]));
    }

    const product = await this.products.product(original.productId);
    const location = await this.prisma.location.findFirst({ where: { id: original.locationId } });
    const locName = location ? location.name : 'Unknown';
    const prodCode = product ? product.code : 'UNKNOWN';

    const origQty = Decimal.parse(exactly(original.quantity));
    const revQty = origQty.negated();
    const origVal = original.value ? Decimal.parse(exactly(original.value)) : null;
    const revVal = origVal ? origVal.negated() : null;

    let classification: MovementClassification;
    if (original.classification === 'stock-in') {
      classification = 'stock-out';
    } else if (original.classification === 'stock-out') {
      classification = 'stock-in';
    } else {
      classification = 'transfer';
    }

    const lockKey = `${original.productId}:${original.locationId}`;

    const reversal = await this.locks.acquire([lockKey], async () => {
      return this.prisma.$transaction(async (tx) => {
        await this.assertNegativeStockPolicy(
          tx,
          original.productId,
          original.locationId,
          revQty,
          locName,
          prodCode,
        );

        const written = await tx.stockMovement.create({
          data: companyApplied<Prisma.StockMovementUncheckedCreateInput>({
            kind: 'reversal',
            classification,
            productId: original.productId,
            locationId: original.locationId,
            quantity: revQty.toString(),
            unitCode: original.unitCode,
            // `exactly` rather than `toString()`, for the reason the twin reversal above gives.
            unitCost: exactly(original.unitCost),
            value: revVal?.toString(),
            reversedMovementId: original.id,
            recordedById: actor.id,
            recordedByName: actor.name,
          }),
        });

        const level = await tx.stockLevel.findFirst({
          where: { productId: original.productId, locationId: original.locationId },
          select: { id: true, quantity: true },
        });

        if (level) {
          await tx.stockLevel.update({
            where: { id: level.id },
            data: { quantity: Decimal.parse(exactly(level.quantity)).plus(revQty).toString() },
          });
        } else {
          await tx.stockLevel.create({
            data: companyApplied<Prisma.StockLevelUncheckedCreateInput>({
              productId: original.productId,
              locationId: original.locationId,
              quantity: revQty.toString(),
            }),
          });
        }

        return written;
      });
    });

    this.events.emit<StockMovementRecorded>(INVENTORY_EVENTS.movementRecorded, {
      movementId: reversal.id,
      kind: 'reversal',
      classification,
      productId: reversal.productId,
      locationId: reversal.locationId,
      quantity: revQty.toString(),
      value: reversal.value ? Money.wire(exactly(reversal.value)) : null,
      recordedById: reversal.recordedById,
      recordedAt: reversal.recordedAt.toISOString(),
      reversedMovementId: reversal.reversedMovementId,
    });

    return describe(reversal, await this.references.resolve([reversal]));
  }

  async listMovements(query: Record<string, unknown>): Promise<MovementListResponse> {
    const slice = listQuery(query, MOVEMENT_LIST);

    const [rows, total] = await Promise.all([
      this.prisma.stockMovement.findMany(slice.findMany<Prisma.StockMovementFindManyArgs>()),
      this.prisma.stockMovement.count(slice.count<Prisma.StockMovementCountArgs>()),
    ]);

    const resolved = await this.references.resolve(rows);
    return slice.respond(
      rows.map((row) => describe(row, resolved)),
      total,
    );
  }

  async movementDetail(id: string): Promise<MovementResponse> {
    const movement = await this.prisma.stockMovement.findFirst({ where: { id } });
    if (!movement) throw movementNotFound();

    return describe(movement, await this.references.resolve([movement]));
  }
}

/** Who recorded it, from the session the platform resolved. Never taken from a request body. */
export interface Actor {
  readonly id: string;
  readonly name: string;
}

/**
 * What a receipt and an issue mean: which way each pushes stock, and what a journal entry
 * posted from it would be.
 *
 * A table rather than a pair of `if`s — and, as written at ticket 09, a table tickets 10 and 11
 * were expected to add rows to. **They did not, and this now says so.** An adjustment carries a
 * direction the caller chooses, a transfer is two rows with opposite signs, and a reversal takes
 * its classification from the movement it undoes; none of the three is a constant, so each
 * derives its own inside its own method and none of them reads this.
 *
 * It is narrowed to the two kinds `record` actually serves rather than left covering all five,
 * because a row nobody reads is a row nobody checks: the `reversal` entry that used to sit here
 * said `stock-in`, which is right for reversing an issue and wrong for reversing a receipt, and
 * nothing caught it because nothing looked at it. A wrong constant that reads as authoritative
 * is worse than no constant.
 */
const SHAPE = {
  receipt: { classification: 'stock-in', direction: 'up' },
  issue: { classification: 'stock-out', direction: 'down' },
} as const satisfies Record<
  RecordedDirectly,
  { classification: MovementClassification; direction: 'up' | 'down' }
>;

/** The kinds `record` is called with. The other three each have an endpoint of their own. */
type RecordedDirectly = Extract<MovementKind, 'receipt' | 'issue'>;

interface MovementRow {
  id: string;
  kind: string;
  classification: string;
  productId: string;
  locationId: string;
  quantity: Prisma.Decimal;
  unitCode: string;
  unitCost: Prisma.Decimal | null;
  value: Prisma.Decimal | null;
  reason: string | null;
  transferId: string | null;
  reversedMovementId: string | null;
  recordedById: string;
  recordedByName: string;
  recordedAt: Date;
}

/**
 * One ledger row on its way out.
 *
 * Three sources meet here and the split is deliberate. The quantity, the unit, the value and
 * who did it are read from the row, because they are facts about the event and have to still
 * read correctly in three years. The product's and the location's names are resolved live,
 * because those label rows that still exist and are still maintained, and a reader wants to
 * recognise them by what they are called now. `unitCost` and `value` go through `Money.wire`,
 * as every monetary value in this system does, so a column that is absent becomes the `null`
 * the contract promises rather than an `undefined` on the wire.
 */
function describe(row: MovementRow, resolved: Resolved): MovementSummary {
  const product = resolved.product(row.productId);
  const location = resolved.location(row.locationId);

  return {
    id: row.id,
    // The columns are text rather than Postgres enums — see schema.prisma — so the wire types
    // are asserted here, at the one boundary where the two representations meet.
    kind: row.kind as MovementKind,
    classification: row.classification as MovementClassification,

    productId: row.productId,
    productCode: product.code,
    productName: product.name,
    unitCode: row.unitCode,

    locationId: row.locationId,
    locationCode: location.code,
    locationName: location.name,

    // Trimmed, as every stored quantity in this system is on the way out. The column is
    // `numeric(24, 6)`, so Postgres answers a receipt of three boxes with `3.000000` — six
    // digits of precision nobody has, on a number somebody is about to read.
    quantity: Quantity.parse(exactly(row.quantity)).trimmed().toValue(),

    unitCost: Money.wire(exactly(row.unitCost)),
    value: Money.wire(exactly(row.value)),

    reason: row.reason ?? null,
    transferId: row.transferId ?? null,
    reversedMovementId: row.reversedMovementId ?? null,

    recordedById: row.recordedById,
    recordedByName: row.recordedByName,
    recordedAt: row.recordedAt.toISOString(),
  };
}

/**
 * Per-resource in-memory locking manager (Ticket 12: Concurrency Hardening).
 *
 * Why this approach:
 * - Default Postgres READ COMMITTED transactions suffer from lost updates when two concurrent
 *   requests read-then-update `StockLevel` for the same product and location.
 * - `check-tenancy.mjs` strictly prohibits `$queryRaw` / `$executeRaw` (`SELECT ... FOR UPDATE`)
 *   in `src/` to prevent raw SQL tenant isolation leaks.
 * - `ResourceLockManager` serializes operations targeting the same product & location key
 *   (`${productId}:${locationId}`), guaranteeing exact sequential stock level calculations.
 * - Multi-resource operations (transfers and twin reversals) sort keys lexicographically before
 *   acquiring locks to guarantee deadlock-free execution.
 * - Concurrent operations on different products run in parallel with zero blocking.
 */
class ResourceLockManager {
  private locks = new Map<string, Promise<void>>();

  async acquire<T>(keys: string[], fn: () => Promise<T>): Promise<T> {
    const sortedKeys = Array.from(new Set(keys)).sort();
    return this.acquireNext(sortedKeys, 0, fn);
  }

  private async acquireNext<T>(keys: string[], index: number, fn: () => Promise<T>): Promise<T> {
    if (index >= keys.length) {
      return fn();
    }
    const key = keys[index]!;
    const currentLock = this.locks.get(key) ?? Promise.resolve();

    let resolveAcquired!: () => void;
    const newLock = new Promise<void>((resolve) => {
      resolveAcquired = resolve;
    });

    this.locks.set(key, currentLock.then(() => newLock));

    try {
      await currentLock;
      return await this.acquireNext(keys, index + 1, fn);
    } finally {
      resolveAcquired();
      if (this.locks.get(key) === newLock) {
        this.locks.delete(key);
      }
    }
  }
}
