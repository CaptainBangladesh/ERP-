import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Quantity, type StockListResponse, type StockLevelSummary } from '@erp/shared';
import { listQuery } from '../../platform/list';
import { InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import { exactly } from '../../prisma/columns';
import { InventoryReferences, type Resolved } from './references';
import { STOCK_LIST } from './schemas';

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
export class StockService {
  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly references: InventoryReferences,
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
