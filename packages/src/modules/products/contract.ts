import type { ListResponse } from '../../http/list.js';
import type { MoneyValue } from '../../numeric/money.js';

/**
 * Products and units of measure — the wire contract.
 *
 * A product is a thing the business deals in, and it sits *beneath* inventory rather than
 * inside it. That is the whole reason this is a module of its own: Sales, Purchase,
 * Manufacturing and E-commerce all need to name the same product, and none of them should
 * have to depend on stock movements and locations to do it.
 *
 * Units of measure live here rather than in the shared package for the reason the shared
 * package rule exists: a unit has rules, a table and a screen, so it is a domain concept and
 * belongs to the module that owns it. `Quantity` in `@erp/shared` deliberately carries no
 * unit — it is a number, and what it counts is this module's business.
 *
 * Wire shapes only. What a product *is* lives in `backend/src/modules/products`, and what
 * other modules may ask of it is `ProductCatalogue`, its public surface.
 */

export const PRODUCTS_MODULE = 'products';

/** No leading slash — Nest composes controller prefixes. */
export const PRODUCTS_ROUTE = 'api/products';

/**
 * Units are a route of their own rather than `api/products/units`.
 *
 * They are not a detail of a product: a unit exists before any product uses it, is created on
 * its own screen, and is what a stock movement in a later module will be measured in. Nesting
 * the path would say the opposite of the model.
 */
export const UNITS_ROUTE = 'api/units';

export const PRODUCT_PATHS = {
  products: `/${PRODUCTS_ROUTE}`,
  product: (id: string) => `/${PRODUCTS_ROUTE}/${id}`,
  suppliers: (id: string) => `/${PRODUCTS_ROUTE}/${id}/suppliers`,
  supplier: (id: string, partyId: string) => `/${PRODUCTS_ROUTE}/${id}/suppliers/${partyId}`,
} as const;

export const UNIT_PATHS = {
  units: `/${UNITS_ROUTE}`,
  unit: (id: string) => `/${UNITS_ROUTE}/${id}`,
  /**
   * Declared before `:id` on the controller, and it has to be: Nest matches routes in
   * registration order, so a parameterised path written first would swallow `groups`.
   */
  groups: `/${UNITS_ROUTE}/groups`,
} as const;

/**
 * Active, or kept for the sake of history.
 *
 * There is no third state and no delete. A product that is no longer bought or sold still
 * appears in three years of movements, orders and valuations, and a deleted row would leave
 * every one of them naming an identifier that resolves to nothing.
 */
export const CATALOGUE_STATUSES = ['active', 'inactive'] as const;

export type CatalogueStatus = (typeof CATALOGUE_STATUSES)[number];

/**
 * A product code, as this system stores it: upper case.
 *
 * Normalised on the way in rather than compared case-insensitively, because a catalogue is
 * large and two spellings of one SKU is a duplicate nobody notices until stock has been split
 * across both. Unit codes are deliberately *not* normalised — see `UNIT_CODE_PATTERN`.
 */
export const PRODUCT_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._/-]*$/;

/**
 * A unit code, kept exactly as it was typed.
 *
 * `kg` is the SI symbol and `KG` is not; `kWh` means something and `KWH` and `kwh` are both
 * wrong. There is no normalisation that is right for all three, so the case is the user's.
 * The duplicate that costs a catalogue dearly costs a unit list nothing: units are a handful
 * of rows on one screen, so two spellings of one unit are visible immediately rather than
 * hidden among ten thousand products.
 */
export const UNIT_CODE_PATTERN = /^[A-Za-z%][A-Za-z0-9%./-]*$/;

/**
 * The fields a caller may sort, filter or search the product list by.
 *
 * Named here rather than as string literals on either side: the backend's list declaration
 * and the frontend's table columns have to agree, so a rename should be a type error in both
 * workspaces rather than a list that quietly stops sorting.
 */
export const PRODUCT_FIELDS = {
  code: 'code',
  name: 'name',
  status: 'status',
  stockable: 'stockable',
  unitId: 'unitId',
  createdAt: 'createdAt',
} as const;

export const UNIT_FIELDS = {
  code: 'code',
  name: 'name',
  status: 'status',
  groupId: 'groupId',
} as const;

// ─── units of measure ───────────────────────────────────────────────────────────────

export interface CreateUnitGroupRequest {
  /** What these units measure: 'Weight', 'Volume', 'Time'. The user's own word. */
  name: string;
}

export interface CreateUnitRequest {
  code: string;
  name: string;
  /** The group it belongs to, if it converts to anything. */
  groupId?: string;
  /**
   * How many of the group's base unit one of these is — `1000` for a kilogram in a group
   * whose base is the gram. Decimal text, never a JSON number.
   *
   * Omitted means `1`, which is what a group's base unit is and the only sensible value for a
   * unit that belongs to no group.
   */
  ratio?: string;
}

export interface UpdateUnitRequest {
  name?: string;
  ratio?: string;
  groupId?: string;
  status?: CatalogueStatus;
}

export interface UnitSummary {
  id: string;
  code: string;
  name: string;
  status: CatalogueStatus;
  groupId: string | null;
  groupName: string | null;
  /** Decimal text. `1` for a unit in no group, and for the base unit of the group it is in. */
  ratio: string;
}

export type UnitListResponse = ListResponse<UnitSummary>;

export interface UnitGroupSummary {
  id: string;
  name: string;
  /** Ascending by ratio, so a group reads from its smallest unit to its largest. */
  units: UnitSummary[];
}

export interface UnitGroupsResponse {
  groups: UnitGroupSummary[];
}

// ─── products ───────────────────────────────────────────────────────────────────────

export interface CreateProductRequest {
  /** The SKU. Unique within this company, and stored upper case. */
  code: string;
  name: string;
  unitId: string;
  /** What one of these costs, for stock to be valued at. Decimal text or a money value. */
  cost?: string | MoneyValue;
  /**
   * Whether stock of it is counted. Omitted means it is.
   *
   * A delivery charge and an hour of consultancy are products with prices and no shelf, and a
   * catalogue that could not hold them would push every module that needs one into inventing
   * its own.
   */
  stockable?: boolean;
}

export interface UpdateProductRequest {
  code?: string;
  name?: string;
  unitId?: string;
  cost?: string | MoneyValue;
  stockable?: boolean;
  status?: CatalogueStatus;
}

export interface AddProductSupplierRequest {
  /**
   * A party in the address book — anybody in it, not only one already marked as a supplier.
   *
   * Products deliberately does not give them the `supplier` role. A role is what a party is to
   * the business, the address book owns that, and a module reaching across to write one would
   * be the first crack in "a module may use another's public surface and nothing else".
   */
  partyId: string;
}

/** A supplier of a product, as the Parties module reports them. */
export interface ProductSupplierResponse {
  partyId: string;
  name: string;
  email: string | null;
}

/**
 * A product as another screen or module sees it.
 *
 * The unit's code and name travel with it because every consumer that shows a quantity shows
 * the unit beside it, and a second request per row to find out what `unitId` means is an N+1
 * this contract can simply decline to create.
 */
export interface ProductSummary {
  id: string;
  code: string;
  name: string;
  status: CatalogueStatus;
  stockable: boolean;
  unitId: string;
  unitCode: string;
  unitName: string;
  /** `null` when no cost has been recorded. Never a JSON number. */
  cost: MoneyValue | null;
}

export interface ProductResponse extends ProductSummary {
  suppliers: ProductSupplierResponse[];
}

export type ProductListResponse = ListResponse<ProductSummary>;

export const PRODUCT_ERROR_CODES = {
  productNotFound: 'product_not_found',
  /** Two products with one code, which within a company is two names for one thing. */
  duplicateProductCode: 'duplicate_product_code',
  unitNotFound: 'unit_not_found',
  duplicateUnitCode: 'duplicate_unit_code',
  unitGroupNotFound: 'unit_group_not_found',
  duplicateUnitGroup: 'duplicate_unit_group',
  /** Deactivating a unit products are measured in, which would leave them measured in nothing. */
  unitInUse: 'unit_in_use',
  /** Converting between units that do not measure the same thing — kilograms and hours. */
  unitsDoNotConvert: 'units_do_not_convert',
  supplierNotFound: 'supplier_not_found',
  /** A supplier that is not a party this company knows. */
  notAParty: 'not_a_party',
} as const;
