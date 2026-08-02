import type { ListResponse, PageInfo } from '@erp/shared';

/**
 * One page of a list, as arguments a Prisma delegate accepts and as the envelope that goes
 * back out.
 *
 * It holds the translated query rather than the raw one: by the time a slice exists every
 * field name has been checked against what the endpoint offers and every value has been read
 * as its declared type, so a module never sees a string a caller typed.
 */
export class ListSlice {
  constructor(
    /** 1-based. */
    readonly page: number,
    readonly pageSize: number,
    private readonly where: Record<string, unknown>,
    private readonly orderBy: ReadonlyArray<Record<string, 'asc' | 'desc'>>,
  ) {}

  /**
   * The arguments for the read.
   *
   * The type parameter is a statement rather than a check, in the same spirit as
   * `companyApplied`: a query assembled from a query string is dynamic by construction, and
   * Prisma's generated argument types describe a query somebody wrote by hand. Naming the
   * delegate's own argument type at the call site is what keeps the *call* checked — the
   * model, the operation and the result type are all still inferred from it.
   */
  findMany<A>(): A {
    return {
      where: this.where,
      orderBy: this.orderBy,
      skip: (this.page - 1) * this.pageSize,
      take: this.pageSize,
    } as A;
  }

  /**
   * The arguments for the total — the same filters, without the paging. Counting with the
   * page applied would answer "how many are on this page", which is a number the caller can
   * already see.
   */
  count<A>(): A {
    return { where: this.where } as A;
  }

  /**
   * The rows and the total, as the one envelope every list endpoint returns.
   *
   * The page number reported is the one that was asked for, even when it is past the end.
   * A caller who asked for page nine of a three-page list gets no items and is told there are
   * three pages, which is enough to work out what happened; renumbering the answer to 1 would
   * hide the mistake and show them a page they did not request.
   */
  respond<T>(items: T[], total: number): ListResponse<T> {
    const page: PageInfo = {
      number: this.page,
      size: this.pageSize,
      total,
      pages: Math.ceil(total / this.pageSize),
    };
    return { items, page };
  }
}
