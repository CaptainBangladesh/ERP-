/**
 * The product master's public surface.
 *
 * `ProductCatalogue` is the contract, and it is the only thing about products another module
 * may name. Inventory, Sales, Purchase, Manufacturing and the warranties add-on all read
 * products through this; none of them knows that a product's unit is a row in another table,
 * that a cost is a nullable numeric column, or that converting between units is a division by
 * two ratios.
 *
 * `ProductsModule` is here because Nest's container requires it: a module that injects
 * `ProductCatalogue` has to import the module that provides it, so a surface offering only the
 * abstract class would be one nobody could use — the same reasoning `parties/index.ts` already
 * follows. It grants nothing extra: `ProductsModule` exports `ProductCatalogue` alone, and
 * deliberately not `ProductsService`, so there is still no way to reach the implementation even
 * with the dependency declared.
 */
export { ProductCatalogue } from './product-catalogue';
export { ProductsModule } from './products.module';
