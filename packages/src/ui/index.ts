/**
 * `@erp/shared/ui` — the components every module's screens are built from.
 *
 * A **separate entry point** from the package root, and that is the whole reason this file
 * exists. The Nest backend imports `@erp/shared` for the wire contracts and the exact-number
 * types; it must not acquire React by doing so. Keeping the components behind `/ui` means the
 * root export stays free of them and the backend's bundle never learns what a component is.
 *
 * What earns a place here is the same rule as the rest of the shared package: a primitive
 * with no business meaning. A table, a field, an amount of money rendered. Anything that
 * knows what a product or an employee *is* belongs to the module that owns it.
 *
 * Everything is hand-written markup and Tailwind. The one dependency, TanStack Table, ships
 * no DOM and no CSS, which is what the frontend dependency rule actually says — the rule is
 * "renders nothing", not "these packages are excused".
 */
export { DataTable, type DataTableProps } from './DataTable.js';
export { Field } from './Field.js';
export { FormError } from './FormError.js';
export { Select } from './Select.js';
export {
  MoneyInput,
  MoneyText,
  QuantityInput,
  QuantityText,
} from './numeric-fields.js';
export {
  currencySymbol,
  formatDecimal,
  formatMoney,
  formatQuantity,
  isPartialDecimal,
} from './format.js';
