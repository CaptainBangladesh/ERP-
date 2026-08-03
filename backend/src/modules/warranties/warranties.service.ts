import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  WARRANTY_ERROR_CODES,
  type WarrantyListResponse,
  type WarrantyResponse,
  type WarrantyStatus,
  type WarrantySummary,
} from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { listQuery } from '../../platform/list';
import { companyApplied, InjectPrisma, type ScopedPrisma } from '../../platform/tenancy';
import type { Valid } from '../../platform/validation';
import { defined } from '../../prisma/columns';
import { ProductCatalogue } from '../products';
import { CreateWarrantyBody, UpdateWarrantyBody, WARRANTY_LIST } from './schemas';

/**
 * The add-on shape stub, doing the one thing it exists to prove.
 *
 * `productId` is checked and its name resolved through `ProductCatalogue` — `products`' public
 * contract — and nothing here reads a `products` table, knows a product has a `name` column,
 * or imports anything from inside `backend/src/modules/products` but its `index.ts`. That is
 * "depends on and extends another module through its public contract, without editing it",
 * made real rather than asserted.
 *
 * As in every module, there is no company filter anywhere: the platform scopes every query
 * below, so another company's warranties are not reachable from here even by trying.
 */
@Injectable()
export class WarrantiesService {
  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly products: ProductCatalogue,
  ) {}

  async createWarranty(input: Valid<typeof CreateWarrantyBody>): Promise<WarrantyResponse> {
    const product = await this.products.product(input.productId);
    if (!product) throw warrantyProductNotFound();

    const warranty = await this.prisma.warranty.create({
      data: companyApplied<Prisma.WarrantyUncheckedCreateInput>({
        productId: input.productId,
        months: input.months,
        notes: input.notes,
      }),
    });

    return summarise(warranty, product.name);
  }

  async listWarranties(query: Record<string, unknown>): Promise<WarrantyListResponse> {
    const slice = listQuery(query, WARRANTY_LIST);

    const [warranties, total] = await Promise.all([
      this.prisma.warranty.findMany(slice.findMany<Prisma.WarrantyFindManyArgs>()),
      this.prisma.warranty.count(slice.count<Prisma.WarrantyCountArgs>()),
    ]);

    return slice.respond(await this.describeAll(warranties), total);
  }

  async warrantyDetail(id: string): Promise<WarrantyResponse> {
    const warranty = await this.prisma.warranty.findFirst({ where: { id } });
    if (!warranty) throw warrantyNotFound();

    const product = await this.products.product(warranty.productId);
    return summarise(warranty, product?.name);
  }

  /**
   * Changes a record, or deactivates it.
   *
   * Deactivation is a status rather than an endpoint of its own, because it is the same act
   * as any other correction from the caller's point of view and the same write from the
   * database's.
   */
  async changeWarranty(
    id: string,
    input: Valid<typeof UpdateWarrantyBody>,
  ): Promise<WarrantyResponse> {
    await this.warrantyDetail(id);

    const warranty = await this.prisma.warranty.update({
      where: { id },
      data: {
        ...defined('months', input.months),
        ...defined('notes', input.notes),
        ...defined('status', input.status),
      },
    });

    const product = await this.products.product(warranty.productId);
    return summarise(warranty, product?.name);
  }

  /**
   * Every product name resolved in one call rather than one per row — the same N+1
   * `PartyDirectory.parties` and `ProductCatalogue.products` themselves exist to avoid.
   */
  private async describeAll(warranties: readonly WarrantyRow[]): Promise<WarrantySummary[]> {
    const products = await this.products.products(warranties.map((warranty) => warranty.productId));
    const nameById = new Map(products.map((product) => [product.id, product.name]));

    return warranties.map((warranty) => summarise(warranty, nameById.get(warranty.productId)));
  }
}

interface WarrantyRow {
  id: string;
  productId: string;
  months: number;
  notes: string | null;
  status: string;
}

/**
 * A product a warranty named that no longer resolves — deactivated is the closest a product
 * ever comes to disappearing, since `products` never deletes one — is described rather than
 * hidden: the warranty is still a real record even if what it names has gone quiet.
 */
function summarise(warranty: WarrantyRow, productName: string | undefined): WarrantySummary {
  return {
    id: warranty.id,
    productId: warranty.productId,
    productName: productName ?? 'Unknown product',
    months: warranty.months,
    notes: warranty.notes,
    // The column is text rather than a Postgres enum, so the wire type is asserted here, at
    // the one boundary where the two representations meet.
    status: warranty.status as WarrantyStatus,
  };
}

function warrantyNotFound(): ApiException {
  return new ApiException(
    WARRANTY_ERROR_CODES.warrantyNotFound,
    'That warranty does not exist.',
    HttpStatus.NOT_FOUND,
  );
}

function warrantyProductNotFound(): ApiException {
  return new ApiException(
    WARRANTY_ERROR_CODES.warrantyProductNotFound,
    'That product does not exist.',
    HttpStatus.NOT_FOUND,
  );
}
