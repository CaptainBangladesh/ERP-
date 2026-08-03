/**
 * The product master's public surface.
 *
 * One abstract class, and it is the only thing about products another module may name.
 * Inventory, Sales, Purchase and Manufacturing all read products through this; none of them
 * knows that a product's unit is a row in another table, that a cost is a nullable numeric
 * column, or that converting between units is a division by two ratios.
 *
 * `ProductsService` is not here, and `ProductsModule` does not export it. That is what makes
 * this a surface rather than a suggestion — there is no way to reach the implementation, so
 * the contract cannot be widened by accident on the far side of a `dependsOn` somebody added
 * for a different reason.
 */
export { ProductCatalogue } from './product-catalogue';
