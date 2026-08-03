import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  Money,
  PRODUCT_ERROR_CODES,
  type CatalogueStatus,
  type ProductListResponse,
  type ProductResponse,
  type ProductSummary,
  type ProductSupplierResponse,
  type Quantity,
} from '@erp/shared';
import { PartyDirectory } from '../parties';
import { listQuery } from '../../platform/list';
import { companyApplied, InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import type { Valid } from '../../platform/validation';
import { defined, exactly } from '../../prisma/columns';
import { ProductCatalogue } from './product-catalogue';
import {
  notAParty,
  productCodeTaken,
  productNotFound,
  refuseDuplicate,
  supplierNotFound,
  unitNotInUse,
} from './refusals';
import {
  AddProductSupplierBody,
  CreateProductBody,
  PRODUCT_LIST,
  UpdateProductBody,
} from './schemas';
import { UnitsService } from './units.service';

/**
 * The product master.
 *
 * Four rules are the reason this is a module of its own rather than a table inside inventory:
 *
 * - **A code is unique within a company and means nothing across companies.** Two businesses
 *   both calling something `WIDGET-1` is not a collision; a global constraint would make one
 *   of them rename their catalogue because of somebody they have never met.
 * - **Nothing is deleted.** A product nobody buys any more appears in three years of
 *   movements, orders and valuations, and a delete would leave every one of them naming an
 *   identifier that resolves to nothing.
 * - **A product may be unstockable.** A delivery charge and an hour of consultancy are
 *   products with prices and no shelf; a catalogue that could not hold them would push every
 *   module that needs one into inventing its own.
 * - **A supplier is a party.** Not a supplier table of this module's own — that is the whole
 *   argument for one address book, taken up by the first module in a position to take it up.
 *   Nothing here reads a parties table; `PartyDirectory` answers, and if it does not know an
 *   identifier then neither does this company.
 *
 * There is no company filter in this file, as in every module: the platform scopes every query
 * below, so another company's catalogue is not reachable from here even by trying.
 */
@Injectable()
export class ProductsService implements ProductCatalogue {
  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly units: UnitsService,
    private readonly parties: PartyDirectory,
  ) {}

  async createProduct(input: Valid<typeof CreateProductBody>): Promise<ProductResponse> {
    await this.requireUsableUnit(input.unitId);

    const product = await this.prisma.product
      .create({
        data: companyApplied<Prisma.ProductUncheckedCreateInput>({
          code: input.code,
          name: input.name,
          unitId: input.unitId,
          cost: input.cost ? input.cost.toValue().amount : null,
          stockable: input.stockable ?? true,
        }),
      })
      .catch(duplicateCode(input.code));

    return this.productDetail(product.id);
  }

  async listProducts(query: Record<string, unknown>): Promise<ProductListResponse> {
    const slice = listQuery(query, PRODUCT_LIST);

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        ...slice.findMany<Prisma.ProductFindManyArgs>(),
        include: WITH_UNIT,
      }),
      this.prisma.product.count(slice.count<Prisma.ProductCountArgs>()),
    ]);

    return slice.respond(products.map(summarise), total);
  }

  /**
   * One product, with its suppliers resolved through the address book.
   *
   * The join table holds identifiers and nothing else — no name, no email — so a supplier
   * whose details are corrected in Parties is corrected here by the same act. Copying the name
   * across when the link was made would have produced a catalogue slowly disagreeing with the
   * address book about who anybody is.
   */
  async productDetail(id: string): Promise<ProductResponse> {
    const product = await this.prisma.product.findFirst({
      where: { id },
      include: { ...WITH_UNIT, suppliers: { orderBy: { createdAt: 'asc' } } },
    });
    if (!product) throw productNotFound();

    const parties = await this.parties.parties(product.suppliers.map((row) => row.partyId));
    const byId = new Map(parties.map((party) => [party.id, party]));

    return {
      ...summarise(product),
      suppliers: product.suppliers.flatMap((row): ProductSupplierResponse[] => {
        const party = byId.get(row.partyId);
        // A supplier the address book no longer resolves is left out rather than shown as a
        // blank row. An unnamed line in a supplier list is not information.
        return party ? [{ partyId: row.partyId, name: party.name, email: party.email }] : [];
      }),
    };
  }

  /**
   * Changes a product, or deactivates it.
   *
   * Deactivation is a status rather than an endpoint of its own, because it is the same act as
   * any other correction from the caller's point of view and the same write from the
   * database's. What it is emphatically not is a delete.
   */
  async changeProduct(
    id: string,
    input: Valid<typeof UpdateProductBody>,
  ): Promise<ProductResponse> {
    await this.requireProduct(id);
    if (input.unitId) await this.requireUsableUnit(input.unitId);

    await this.prisma.product
      .update({
        where: { id },
        data: {
          ...defined('code', input.code),
          ...defined('name', input.name),
          ...defined('unitId', input.unitId),
          ...defined('stockable', input.stockable),
          ...defined('status', input.status),
          ...defined('cost', input.cost ? input.cost.toValue().amount : undefined),
        },
      })
      .catch(duplicateCode(input.code ?? ''));

    return this.productDetail(id);
  }

  /**
   * Records that somebody supplies this product.
   *
   * The party is checked through the Parties contract and stored as an identifier. What is
   * deliberately *not* done here is give them the `supplier` role: a role is what a party is
   * to the business, the address book owns that, and a module reaching across to write one
   * would be the first crack in "a module may use another's public surface and nothing else".
   * `PartyDirectory` offers reads for exactly that reason.
   */
  async addSupplier(
    id: string,
    input: Valid<typeof AddProductSupplierBody>,
  ): Promise<ProductResponse> {
    await this.requireProduct(id);

    const party = await this.parties.party(input.partyId);
    if (!party) throw notAParty();

    await this.prisma.productSupplier.createMany({
      // `party.id` rather than what was asked for, because `PartyDirectory` follows merges:
      // linking a duplicate links the record that survived, so the catalogue never
      // accumulates references the address book has already superseded.
      data: [
        companyApplied<Prisma.ProductSupplierUncheckedCreateInput>({
          productId: id,
          partyId: party.id,
        }),
      ],
      // Supplying something twice is not a different fact from supplying it once.
      skipDuplicates: true,
    });

    return this.productDetail(id);
  }

  async removeSupplier(id: string, partyId: string): Promise<ProductResponse> {
    await this.requireProduct(id);

    const removed = await this.prisma.productSupplier.deleteMany({
      where: { productId: id, partyId },
    });
    if (removed.count === 0) throw supplierNotFound();

    return this.productDetail(id);
  }

  // ─── ProductCatalogue: what other modules may ask ─────────────────────────────────

  async product(id: string): Promise<ProductSummary | undefined> {
    const [found] = await this.resolve([id]);
    return found;
  }

  async products(ids: readonly string[]): Promise<ProductSummary[]> {
    return this.resolve(ids);
  }

  async byCode(code: string): Promise<ProductSummary | undefined> {
    const product = await this.prisma.product.findFirst({
      // Upper-cased here rather than at every call site, so a consumer need not know that the
      // code is stored normalised — which is the sort of thing a public surface exists to
      // absorb.
      where: { code: code.trim().toUpperCase() },
      include: WITH_UNIT,
    });

    return product ? summarise(product) : undefined;
  }

  async convert(amount: Quantity, fromUnitId: string, toUnitId: string): Promise<Quantity> {
    return this.units.convert(amount, fromUnitId, toUnitId);
  }

  /**
   * Products by identifier, in the order asked for.
   *
   * The order is the caller's, which is nearly always the order of the rows they are about to
   * render, and never the order the database found them in. Identifiers this company does not
   * know are left out rather than answered as gaps.
   */
  private async resolve(ids: readonly string[]): Promise<ProductSummary[]> {
    if (ids.length === 0) return [];

    const found = await this.prisma.product.findMany({
      where: { id: { in: [...ids] } },
      include: WITH_UNIT,
    });

    const byId = new Map(found.map((product) => [product.id, product]));
    return ids.flatMap((id) => {
      const product = byId.get(id);
      return product ? [summarise(product)] : [];
    });
  }

  // ─── internals ────────────────────────────────────────────────────────────────────

  private async requireProduct(id: string) {
    const product = await this.prisma.product.findFirst({ where: { id } });
    if (!product) throw productNotFound();
    return product;
  }

  /**
   * The unit exists, and is one this company still uses.
   *
   * A deactivated unit is refused rather than accepted quietly: deactivating one is how
   * somebody says "we do not measure things this way any more", and a product created in one
   * afterwards would be measured in something the unit screen reports as out of use.
   */
  private async requireUsableUnit(unitId: string): Promise<void> {
    const unit = await this.units.requireUnit(unitId);
    if (unit.status !== 'active') throw unitNotInUse(unit.code);
  }
}

/**
 * The unit a product is measured in, fetched with it.
 *
 * A nested `select` naming the three columns rather than the whole row, which is the form the
 * tenancy extension permits through a relation. Every consumer that shows a quantity shows the
 * unit beside it, so fetching it here is what stops a product list being an N+1.
 */
const WITH_UNIT = {
  unit: { select: { id: true, code: true, name: true } },
} satisfies Prisma.ProductInclude;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof WITH_UNIT }>;

function summarise(product: ProductRow): ProductSummary {
  return {
    id: product.id,
    code: product.code,
    name: product.name,
    // The column is text rather than a Postgres enum — see schema.prisma — so the wire type is
    // asserted here, at the one boundary where the two representations meet.
    status: product.status as CatalogueStatus,
    stockable: product.stockable,
    unitId: product.unit.id,
    unitCode: product.unit.code,
    unitName: product.unit.name,
    // Through `Money.wire`, which is also what handles the case the generated row type denies:
    // a restricted column arrives absent rather than null. Nothing here is restricted today,
    // and writing it this way means that stays true if something ever is.
    cost: Money.wire(exactly(product.cost)),
  };
}

/**
 * The unique constraint on code, as a message beside the input that caused it.
 *
 * The shape is shared with units — see `refusals.ts` — because a duplicate is the same event
 * whichever table raised it, and two copies of the handling would be two answers to it.
 */
function duplicateCode(code: string) {
  return refuseDuplicate(
    PRODUCT_ERROR_CODES.duplicateProductCode,
    'code',
    productCodeTaken(code),
    productNotFound,
  );
}
