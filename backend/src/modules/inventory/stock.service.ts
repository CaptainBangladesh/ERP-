import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  Decimal,
  Money,
  Quantity,
  type LocationValuationItem,
  type LocationValuationSummary,
  type MoneyValue,
  type ProductValuationSummary,
  type ReconciliationResult,
  type StockDivergence,
  type StockLevelSummary,
  type StockListResponse,
  type StockValuationSummary,
} from '@erp/shared';
import { listQuery } from '../../platform/list';
import { InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import { exactly } from '../../prisma/columns';
import { ProductCatalogue } from '../products';
import { InventoryReferences, type Resolved } from './references';
import { STOCK_LIST } from './schemas';
import { StockValuation } from './stock-valuation';

/**
 * What there is now, as against what happened — the running total of the ledger.
 *
 * A read-only service, deliberately. Nothing here writes a stock level: every change to one is
 * made by `MovementsService`, inside the same transaction as the movement that caused it, and a
 * second writer would be a second answer to "why is this number what it is". The rule this file
 * keeps is that a stock figure is only ever a consequence.
 *
 * The two questions ticket 09 asks for — everywhere one product is, and everything one location
 * holds — are the same list with one filter set, which is why there is one endpoint rather than
 * two. `?filter.productId=…` and `?filter.locationId=…` are the platform's own convention, so
 * neither needed a line of code here.
 *
 * As in every module, there is no company filter below.
 */
@Injectable()
export class StockService implements StockValuation {
  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly references: InventoryReferences,
    private readonly products: ProductCatalogue,
  ) {}

  async listStock(query: Record<string, unknown>): Promise<StockListResponse> {
    const slice = listQuery(query, STOCK_LIST);

    const [rows, total] = await Promise.all([
      this.prisma.stockLevel.findMany(slice.findMany<Prisma.StockLevelFindManyArgs>()),
      this.prisma.stockLevel.count(slice.count<Prisma.StockLevelCountArgs>()),
    ]);

    const resolved = await this.references.resolve(rows);
    return slice.respond(
      rows.map((row) => describe(row, resolved)),
      total,
    );
  }

  /**
   * How many distinct products are still held at one location.
   *
   * The count ticket 08 wrote the refusal for and could not implement, because until this ticket
   * nothing could put stock into a location. `LocationsService` asks this before letting
   * somewhere be deactivated, and the rule it guards — stock left somewhere the system says is
   * not in use is stock stranded by the very act meant to tidy the list — is live from here.
   *
   * Rows at exactly zero do not count, and that is the whole of what makes deactivation
   * possible. A level row is created by the first movement and never removed, so somewhere that
   * has been emptied properly still has a row per product that ever passed through it. Counting
   * those would mean a location could be used once and then never closed again.
   *
   * Negative counts as held, which is not an oversight: a location showing -3 of something has
   * a discrepancy somebody has to resolve, and closing it would be filing that discrepancy
   * somewhere nobody looks. Ticket 11 is where a company decides whether a negative level may
   * arise at all.
   */
  async productsHeldAt(locationId: string): Promise<number> {
    return this.prisma.stockLevel.count({
      // Decimal *text*, not the number `0`. Prisma reads a string into a `numeric` column
      // exactly, and a JavaScript number is an IEEE 754 double — the one thing a quantity must
      // never become at any layer, including in a comparison. See docs/api-conventions.md.
      where: { locationId, quantity: { not: ZERO } },
    });
  }

  /**
   * On-demand reconciliation check (Ticket 12).
   *
   * Recomputes expected stock quantities directly from the append-only ledger (`StockMovement`)
   * and compares them against current running totals in `StockLevel`.
   *
   * Reports any divergence clearly, or confirms 100% agreement when everything reconciles.
   */
  async reconcile(): Promise<ReconciliationResult> {
    const [storedLevels, movements] = await Promise.all([
      this.prisma.stockLevel.findMany(),
      this.prisma.stockMovement.findMany(),
    ]);

    const computedMap = new Map<string, Decimal>();
    for (const m of movements) {
      const key = `${m.productId}:${m.locationId}`;
      const qty = Decimal.parse(exactly(m.quantity));
      const prev = computedMap.get(key) ?? Decimal.ZERO;
      computedMap.set(key, prev.plus(qty));
    }

    const storedMap = new Map<string, Decimal>();
    for (const s of storedLevels) {
      const key = `${s.productId}:${s.locationId}`;
      storedMap.set(key, Decimal.parse(exactly(s.quantity)));
    }

    const allKeys = new Set([...computedMap.keys(), ...storedMap.keys()]);
    const divergences: StockDivergence[] = [];

    for (const key of allKeys) {
      const [productId, locationId] = key.split(':');
      const computed = computedMap.get(key) ?? Decimal.ZERO;
      const stored = storedMap.get(key) ?? Decimal.ZERO;

      if (!computed.equals(stored)) {
        divergences.push({
          productId: productId!,
          locationId: locationId!,
          storedQuantity: Quantity.parse(stored.toString()).trimmed().toValue(),
          computedQuantity: Quantity.parse(computed.toString()).trimmed().toValue(),
        });
      }
    }

    return {
      reconciled: divergences.length === 0,
      divergenceCount: divergences.length,
      divergences,
    };
  }

  /**
   * Calculates stock valuation across the company (Ticket 13).
   *
   * Computes total inventory value, breakdowns by product and location, handling of uncosted products,
   * and verifies that value derived from stock equals the sum of movement accounting values.
   */
  async getValuation(): Promise<StockValuationSummary> {
    const [levels, movements] = await Promise.all([
      this.prisma.stockLevel.findMany(),
      this.prisma.stockMovement.findMany(),
    ]);

    const productIds = [...new Set(levels.map((l) => l.productId))];
    const locationIds = [...new Set(levels.map((l) => l.locationId))];

    const [products, locations] = await Promise.all([
      this.products.products(productIds),
      this.prisma.location.findMany({
        where: { id: { in: locationIds } },
        select: { id: true, code: true, name: true },
      }),
    ]);

    const productMap = new Map(products.map((p) => [p.id, p]));
    const locationMap = new Map(locations.map((l) => [l.id, l]));

    // Aggregate quantities by product across all locations
    const productQtyMap = new Map<string, Decimal>();
    for (const level of levels) {
      const qty = Decimal.parse(exactly(level.quantity));
      const prev = productQtyMap.get(level.productId) ?? Decimal.ZERO;
      productQtyMap.set(level.productId, prev.plus(qty));
    }

    // Build Product Breakdown
    const byProduct: ProductValuationSummary[] = [];
    let companyTotalDecimal = Decimal.ZERO;
    let costedProductCount = 0;
    let uncostedProductCount = 0;

    for (const [productId, totalQtyDecimal] of productQtyMap.entries()) {
      const product = productMap.get(productId);
      const productCode = product?.code ?? '—';
      const productName = product?.name ?? 'Unknown product';
      const unitCode = product?.unitCode ?? '—';
      const costMoneyValue = product?.cost ?? null;

      let itemValue: MoneyValue | null = null;
      let isCosted = false;

      if (costMoneyValue !== null) {
        isCosted = true;
        costedProductCount++;
        const costDecimal = Decimal.parse(costMoneyValue.amount);
        const valDecimal = costDecimal.times(totalQtyDecimal);
        companyTotalDecimal = companyTotalDecimal.plus(valDecimal);
        itemValue = Money.of(valDecimal, costMoneyValue.currency).round('half-even').toValue();
      } else {
        uncostedProductCount++;
      }

      byProduct.push({
        productId,
        productCode,
        productName,
        unitCode,
        unitCost: costMoneyValue,
        totalQuantity: Quantity.parse(totalQtyDecimal.toString()).trimmed().toValue(),
        totalValue: itemValue,
        isCosted,
      });
    }

    byProduct.sort((a, b) => a.productCode.localeCompare(b.productCode));

    // Group stock levels by location
    const locLevelMap = new Map<string, Array<{ productId: string; qty: Decimal }>>();
    for (const level of levels) {
      const qty = Decimal.parse(exactly(level.quantity));
      const arr = locLevelMap.get(level.locationId) ?? [];
      arr.push({ productId: level.productId, qty });
      locLevelMap.set(level.locationId, arr);
    }

    const byLocation: LocationValuationSummary[] = [];

    for (const [locationId, itemsList] of locLevelMap.entries()) {
      const location = locationMap.get(locationId);
      const locationCode = location?.code ?? '—';
      const locationName = location?.name ?? 'Unknown location';

      let locTotalDecimal = Decimal.ZERO;
      let locCostedCount = 0;
      let locUncostedCount = 0;
      let hasAnyCosted = false;

      const items: LocationValuationItem[] = [];

      for (const item of itemsList) {
        const product = productMap.get(item.productId);
        const productCode = product?.code ?? '—';
        const productName = product?.name ?? 'Unknown product';
        const unitCode = product?.unitCode ?? '—';
        const costMoneyValue = product?.cost ?? null;

        let val: MoneyValue | null = null;
        let isCosted = false;

        if (costMoneyValue !== null) {
          isCosted = true;
          hasAnyCosted = true;
          locCostedCount++;
          const costDecimal = Decimal.parse(costMoneyValue.amount);
          const itemValDecimal = costDecimal.times(item.qty);
          locTotalDecimal = locTotalDecimal.plus(itemValDecimal);
          val = Money.of(itemValDecimal, costMoneyValue.currency).round('half-even').toValue();
        } else {
          locUncostedCount++;
        }

        items.push({
          productId: item.productId,
          productCode,
          productName,
          unitCode,
          unitCost: costMoneyValue,
          quantity: Quantity.parse(item.qty.toString()).trimmed().toValue(),
          value: val,
          isCosted,
        });
      }

      items.sort((a, b) => a.productCode.localeCompare(b.productCode));

      byLocation.push({
        locationId,
        locationCode,
        locationName,
        totalValue: hasAnyCosted
          ? Money.of(locTotalDecimal).round('half-even').toValue()
          : null,
        costedProductCount: locCostedCount,
        uncostedProductCount: locUncostedCount,
        items,
      });
    }

    byLocation.sort((a, b) => a.locationCode.localeCompare(b.locationCode));

    // Movement Accounting Reconciliation
    let stockInDecimal = Decimal.ZERO;
    let stockOutDecimal = Decimal.ZERO;
    let netMovementDecimal = Decimal.ZERO;

    for (const m of movements) {
      if (m.value !== null && m.value !== undefined) {
        const mVal = Decimal.parse(exactly(m.value));
        netMovementDecimal = netMovementDecimal.plus(mVal);
        if (m.classification === 'stock-in') {
          stockInDecimal = stockInDecimal.plus(mVal);
        } else if (m.classification === 'stock-out') {
          stockOutDecimal = stockOutDecimal.plus(mVal.absolute());
        }
      }
    }

    const stockInValue = Money.of(stockInDecimal).round('half-even').toValue();
    const stockOutValue = Money.of(stockOutDecimal).round('half-even').toValue();
    const netMovementValue = Money.of(netMovementDecimal).round('half-even').toValue();

    const totalValue =
      costedProductCount > 0
        ? Money.of(companyTotalDecimal).round('half-even').toValue()
        : null;

    const reconciled =
      totalValue !== null
        ? Decimal.parse(totalValue.amount).equals(Decimal.parse(netMovementValue.amount))
        : netMovementDecimal.isZero();

    return {
      totalValue,
      costedProductCount,
      uncostedProductCount,
      totalProducts: productQtyMap.size,
      byProduct,
      byLocation,
      movementAccounting: {
        stockInValue,
        stockOutValue,
        netMovementValue,
        reconciled,
      },
    };
  }
}

/** Nothing held, as the column stores it. Text, for the reason `productsHeldAt` gives. */
const ZERO = Quantity.ZERO.toValue();

interface StockLevelRow {
  productId: string;
  locationId: string;
  quantity: Prisma.Decimal;
}

function describe(row: StockLevelRow, resolved: Resolved): StockLevelSummary {
  const product = resolved.product(row.productId);
  const location = resolved.location(row.locationId);

  return {
    productId: row.productId,
    productCode: product.code,
    productName: product.name,
    // The product's *current* unit, unlike a movement's, which is frozen. A level is a figure
    // about now, and the unit it is quoted in should be the one the catalogue says today.
    unitCode: product.unitCode,

    locationId: row.locationId,
    locationCode: location.code,
    locationName: location.name,

    // Trimmed, so three boxes read as `3` rather than as `3.000000` — see the column's scale.
    quantity: Quantity.parse(exactly(row.quantity)).trimmed().toValue(),
  };
}
