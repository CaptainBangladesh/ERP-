import type { ListResponse } from '../../http/list.js';

/**
 * Inventory's wire contract — its paths, bodies, responses and refusals.
 *
 * Locations first, because stock has to be somewhere before it can move. A location is a place
 * this company keeps things: a warehouse, a van, a bay, a bonded store. What it deliberately is
 * *not* is a hierarchy — a bin inside an aisle inside a warehouse — because every level of
 * nesting is a level every stock figure would have to be summed across, and nobody has asked
 * for one. A flat list is the smaller thing, and the one that can grow into a tree later
 * without any of today's rows being wrong.
 *
 * Wire shapes only, as with every contract here. What a location *is* lives in
 * `backend/src/modules/inventory`, and nothing outside that module reads its tables.
 *
 * Both workspaces bind to this file, so an API change breaks the build rather than the user's
 * screen.
 */

export const INVENTORY_MODULE = 'inventory';

/**
 * `api/locations` rather than `api/inventory`.
 *
 * The module is inventory; the resource is a location, and it is the resource a path names —
 * the same decision products made when units got `api/units` rather than `api/products/units`.
 * Movements, in ticket 09, will be a route of their own beside this one rather than a segment
 * underneath it.
 *
 * No leading slash — Nest composes controller prefixes.
 */
export const LOCATIONS_ROUTE = 'api/locations';

export const LOCATION_PATHS = {
  locations: `/${LOCATIONS_ROUTE}`,
  location: (id: string) => `/${LOCATIONS_ROUTE}/${id}`,
} as const;

/**
 * In use, or kept for the sake of history.
 *
 * There is no third state and no delete. Somewhere that has been closed still appears in every
 * movement ever recorded against it, and a deleted row would leave each of them naming an
 * identifier that resolves to nothing. Deactivating is reversible; a delete is not.
 */
export const LOCATION_STATUSES = ['active', 'inactive'] as const;

export type LocationStatus = (typeof LOCATION_STATUSES)[number];

/**
 * A location code, as this system stores it: upper case.
 *
 * Normalised on the way in rather than compared case-insensitively, for the reason
 * `PRODUCT_CODE_PATTERN` gives: the unique constraint on the column then means what it appears
 * to mean. A company holding both `wh-1` and `WH-1` has two places one van unloads into, and
 * nobody finds out until a stock count disagrees with itself.
 */
export const LOCATION_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._/-]*$/;

/**
 * The fields a caller may sort, filter or search the location list by.
 *
 * Named here rather than as string literals on either side: the backend's list declaration and
 * the frontend's table columns have to agree, so a rename should be a type error in both
 * workspaces rather than a list that quietly stops sorting.
 */
export const LOCATION_FIELDS = {
  code: 'code',
  name: 'name',
  status: 'status',
  createdAt: 'createdAt',
} as const;

export interface CreateLocationRequest {
  /** Unique within this company, and stored upper case. */
  code: string;
  name: string;
}

export interface UpdateLocationRequest {
  code?: string;
  name?: string;
  status?: LocationStatus;
}

export interface LocationSummary {
  id: string;
  code: string;
  name: string;
  status: LocationStatus;
}

export type LocationResponse = LocationSummary;

export type LocationListResponse = ListResponse<LocationSummary>;

export const LOCATION_ERROR_CODES = {
  locationNotFound: 'location_not_found',
  /** Two locations with one code, which within a company is two names for one place. */
  duplicateLocationCode: 'duplicate_location_code',
  /**
   * Deactivating somewhere that still has stock in it.
   *
   * Declared from the day locations exist rather than arriving with the ledger that can trigger
   * it, so that a client branching on this module's failures does not acquire a new one the
   * week movements ship. Nothing can hold stock until ticket 09 — see `locations.service.ts`,
   * which says where the answer will come from.
   */
  locationHoldsStock: 'location_holds_stock',
} as const;
