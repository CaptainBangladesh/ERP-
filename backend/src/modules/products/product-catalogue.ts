import type { ProductSummary } from '@erp/shared';
import type { Quantity } from '@erp/shared';

/**
 * What every other module may ask of the product master.
 *
 * Inventory needs to know what a movement is *of*, and in what unit; Sales needs a name and a
 * price beside a line; Purchase needs to know who supplies something. All three are reads of
 * a product, and none of them is a reason to know that a product's unit is a row in another
 * table, that a cost is a nullable numeric column, or that suppliers are a join table naming
 * parties.
 *
 * An abstract class rather than an interface, as `PartyDirectory` is and for the same reason:
 * it is the injection token and the contract at once, so a consumer names this and never
 * `ProductsService`. The service is not exported by `ProductsModule` and not re-exported by
 * `index.ts`, which is what makes "and nothing else" true rather than encouraged.
 */
export abstract class ProductCatalogue {
  /** One product, or `undefined` if this company has no such record. */
  abstract product(id: string): Promise<ProductSummary | undefined>;

  /**
   * Several at once, in the order given, with anything unknown to this company left out.
   *
   * Present because the alternative is a module calling `product` in a loop over the rows of
   * a movement list, which is the N+1 every "just read it one at a time" contract produces by
   * the third consumer.
   */
  abstract products(ids: readonly string[]): Promise<ProductSummary[]>;

  /**
   * By SKU, which is how a person names a product and therefore how an import, a barcode or a
   * purchase order line will name one. Upper-cased before it is looked up, so a caller need
   * not know that the code is stored normalised.
   */
  abstract byCode(code: string): Promise<ProductSummary | undefined>;

  /**
   * The same amount, measured in a different unit.
   *
   * Here rather than in `Quantity` because this is where the knowledge lives: a quantity in
   * `@erp/shared` is a number with no unit attached, deliberately, and the thing that knows
   * a kilogram is a thousand grams is the module with the table in it.
   *
   * Refuses units that do not measure the same thing. That refusal is the reason groups
   * exist: adding kilograms to hours has no answer, and a contract that returned one would be
   * a contract that produced a stock figure nobody could explain.
   */
  abstract convert(amount: Quantity, fromUnitId: string, toUnitId: string): Promise<Quantity>;
}
