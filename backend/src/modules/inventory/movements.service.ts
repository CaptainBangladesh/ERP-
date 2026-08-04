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
  locationNotFound,
  locationNotInUse,
  movementNotFound,
  movementProductNotFound,
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
@Injectable()
export class MovementsService {
  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly products: ProductCatalogue,
    private readonly references: InventoryReferences,
    private readonly events: DomainEvents,
  ) {}

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
    kind: MovementKind,
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

    const movement = await this.prisma.$transaction(async (tx) => {
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

      /**
       * The running total, read and then written.
       *
       * Deliberately not an `upsert`: the compound key includes the company, so naming it would
       * mean writing the one column this module is not allowed to write — scoping is the
       * platform's, and a module that wrote the filter would be a module that could forget it.
       * Read-then-write through the scoped client keeps every query scoped without this file
       * ever mentioning a company.
       *
       * **This read-then-write is a lost update under concurrency, and ticket 12 owns it.**
       *
       * Two requests moving the same product at the same place can both read one quantity and
       * both write their own answer, and the second silently overwrites the first. The unique
       * constraint on `(company, product, location)` covers only the `create` branch below —
       * two concurrent *first* movements collide loudly there — so it must not be mistaken for
       * protection: once a level row exists, which is the ordinary case, nothing here trips.
       *
       * The ledger is what makes that survivable rather than merely unfortunate. Both movements
       * are recorded whatever happens to the level, so the correct quantity is always
       * recoverable by summing the rows — which is precisely the reconciliation check ticket 12
       * builds, and the reason this projection is a cache rather than the record.
       */
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

    /**
     * Told to whoever is listening, which today is nobody — and that is the seam working rather
     * than the seam missing. The payload is inventory's own contract, so an Accounting module
     * written next year binds to a declared shape instead of to this file.
     *
     * After the commit, and outside the transaction, for the reason in the class note above.
     */
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

    const movement = await this.prisma.$transaction(async (tx) => {
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

    const [outMovement, inMovement] = await this.prisma.$transaction(async (tx) => {
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
 * What each kind of movement means: which way it pushes stock, and what a journal entry posted
 * from it would be.
 *
 * A table rather than a pair of `if`s, because tickets 10 and 11 add rows to it — an adjustment
 * that can go either way, a transfer that posts nothing, a reversal that undoes whichever
 * direction it is reversing. Every one of those is a line here and a case nowhere else, which
 * is the property worth having: adding a movement type should not mean finding every place that
 * asked whether something was a receipt.
 */
const SHAPE = {
  receipt: { classification: 'stock-in', direction: 'up' },
  issue: { classification: 'stock-out', direction: 'down' },
  adjustment: { classification: 'stock-in', direction: 'up' },
  transfer: { classification: 'transfer', direction: 'up' },
} as const satisfies Record<
  MovementKind,
  { classification: MovementClassification; direction: 'up' | 'down' }
>;

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

    recordedById: row.recordedById,
    recordedByName: row.recordedByName,
    recordedAt: row.recordedAt.toISOString(),
  };
}
