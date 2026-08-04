import { Injectable } from '@nestjs/common';
import { InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import { ProductCatalogue } from '../products';

/**
 * What a movement and a stock level point at, resolved for a whole page at once.
 *
 * Every read in this module answers with rows carrying two foreign references — what moved, and
 * where — and both have to become something a person can read. Doing that per row is the N+1
 * `ProductCatalogue.products` exists to prevent, and doing it twice, once in each service, is
 * two places for the same "what if it no longer resolves?" question to be answered differently.
 *
 * The product goes through `ProductCatalogue`, which is products' public contract: nothing here
 * reads a products table, knows that a product's unit is a row in another one, or could tell
 * you what columns a product has. The location is inventory's own, so it is read directly.
 *
 * As everywhere else, there is no company filter below. The platform scopes both queries, which
 * is also what makes the "unknown" case honest: another company's product does not resolve here
 * for exactly the same reason a deleted one would not.
 */
@Injectable()
export class InventoryReferences {
  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly products: ProductCatalogue,
  ) {}

  /** Everything the given rows name, in two queries however many rows there are. */
  async resolve(rows: readonly StockRow[]): Promise<Resolved> {
    const [products, locations] = await Promise.all([
      this.products.products(unique(rows.map((row) => row.productId))),
      this.prisma.location.findMany({
        where: { id: { in: unique(rows.map((row) => row.locationId)) } },
        select: { id: true, code: true, name: true },
      }),
    ]);

    const productById = new Map(products.map((product) => [product.id, product]));
    const locationById = new Map(locations.map((location) => [location.id, location]));

    return {
      product: (id) => {
        const found = productById.get(id);
        return {
          code: found?.code ?? UNRESOLVED.code,
          name: found?.name ?? UNRESOLVED.product,
          unitCode: found?.unitCode ?? UNRESOLVED.code,
        };
      },
      location: (id) => {
        const found = locationById.get(id);
        return { code: found?.code ?? UNRESOLVED.code, name: found?.name ?? UNRESOLVED.location };
      },
    };
  }
}

export interface StockRow {
  readonly productId: string;
  readonly locationId: string;
}

export interface Resolved {
  product(id: string): { code: string; name: string; unitCode: string };
  location(id: string): { code: string; name: string };
}

/**
 * What a reference that no longer resolves is called.
 *
 * Described rather than hidden, and rather than crashing. Neither products nor locations ever
 * deletes a row, so this is close to unreachable today — but a ledger line is permanent and the
 * things it names are only *almost* permanent, and the row is a real record of something that
 * really happened either way. A history screen that dropped the line, or a 500 where a line
 * should be, would both be worse answers than saying which part could not be looked up.
 */
const UNRESOLVED = {
  code: '—',
  product: 'Unknown product',
  location: 'Unknown location',
} as const;

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
