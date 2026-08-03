import type { ListResponse } from '../../http/list.js';

/**
 * Warranties' wire contract — the add-on shape stub's paths, bodies, responses and refusals.
 *
 * A warranty names a product by id and carries `productName` on its response, resolved by the
 * backend through `products`' public contract rather than stored here — the wire shape mirrors
 * the module boundary: this file has no idea `products` has a `name` *column*, only that a
 * warranty's response carries the product's name.
 *
 * Both workspaces bind to this file, so an API change breaks the build rather than the user's
 * screen.
 */

export const WARRANTIES_MODULE = 'warranties';

/** No leading slash — Nest composes controller prefixes. */
export const WARRANTIES_ROUTE = 'api/warranties';

export const WARRANTY_PATHS = {
  warranties: `/${WARRANTIES_ROUTE}`,
  warranty: (id: string) => `/${WARRANTIES_ROUTE}/${id}`,
} as const;

/**
 * Active, or voided. 'inactive' is what deactivation produces — something nobody honours any
 * more, whose past still has to make sense. Nothing here is ever deleted.
 */
export const WARRANTY_STATUSES = ['active', 'inactive'] as const;

export type WarrantyStatus = (typeof WARRANTY_STATUSES)[number];

/**
 * The fields a caller may sort, filter or search the list by — every one a real column.
 * `productName` is not offered: it is resolved at read time through `ProductCatalogue` rather
 * than stored, so there is no column for the database to sort or filter by.
 */
export const WARRANTY_FIELDS = {
  months: 'months',
  status: 'status',
  createdAt: 'createdAt',
} as const;

export interface CreateWarrantyRequest {
  productId: string;
  months: number;
  notes?: string;
}

/** A change. Every field optional, at least one required — absent means "do not touch it". */
export interface UpdateWarrantyRequest {
  months?: number;
  notes?: string;
  status?: WarrantyStatus;
}

export interface WarrantySummary {
  id: string;
  productId: string;
  /** Resolved through `products`' public contract at read time, never stored here. */
  productName: string;
  months: number;
  notes: string | null;
  status: WarrantyStatus;
}

export type WarrantyResponse = WarrantySummary;

export type WarrantyListResponse = ListResponse<WarrantySummary>;

export const WARRANTY_ERROR_CODES = {
  warrantyNotFound: 'warranty_not_found',
  /** The `productId` a warranty was asked to name does not resolve for this company. */
  warrantyProductNotFound: 'warranty_product_not_found',
} as const;
