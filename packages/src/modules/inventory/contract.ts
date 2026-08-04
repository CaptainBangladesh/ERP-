import type { ListResponse } from '../../http/list.js';
import type { MoneyValue } from '../../numeric/money.js';

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
 * Then movements, which are the module: a permanent ledger of what moved, where, how much, who
 * did it and when. Stock levels are not a second source of truth beside it — they are the
 * running total of it, written in the same transaction, and the ledger is what they are
 * checked against.
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
 *
 * No leading slash — Nest composes controller prefixes.
 */
export const LOCATIONS_ROUTE = 'api/locations';

/**
 * The ledger, and the running total derived from it — two routes rather than one.
 *
 * They answer different questions and are read by different people. `api/movements` is what
 * happened, in order, for ever; `api/stock` is what there is now. Folding the second into the
 * first as `api/movements/levels` would say that a stock figure is a view of the ledger's URL
 * space, when it is a view of the ledger's *contents* — and would put the number a warehouse
 * manager looks at every morning behind a path named for an audit trail.
 */
export const MOVEMENTS_ROUTE = 'api/movements';

export const STOCK_ROUTE = 'api/stock';

export const LOCATION_PATHS = {
  locations: `/${LOCATIONS_ROUTE}`,
  location: (id: string) => `/${LOCATIONS_ROUTE}/${id}`,
} as const;

/**
 * Receipts and issues are separate paths, not one path with a `kind` in the body.
 *
 * Receiving goods and issuing them are different acts done by different people for different
 * reasons, and the shape of the request says so. A single `POST /api/movements` taking a
 * direction would make "did you mean to take this out?" a validation question rather than a
 * question the caller already answered by choosing what to call.
 */
export const MOVEMENT_PATHS = {
  movements: `/${MOVEMENTS_ROUTE}`,
  movement: (id: string) => `/${MOVEMENTS_ROUTE}/${id}`,
  receipts: `/${MOVEMENTS_ROUTE}/receipts`,
  issues: `/${MOVEMENTS_ROUTE}/issues`,
  adjustments: `/${MOVEMENTS_ROUTE}/adjustments`,
  transfers: `/${MOVEMENTS_ROUTE}/transfers`,
} as const;

export const STOCK_PATHS = {
  stock: `/${STOCK_ROUTE}`,
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
   * week movements ship. Live from ticket 09, which is the first thing that can put stock into
   * a location — see `locations.service.ts`.
   */
  locationHoldsStock: 'location_holds_stock',
} as const;

// ─── movements ──────────────────────────────────────────────────────────────────────

/**
 * What kind of movement this is — the caller's *intent*, recorded rather than derived.
 *
 * A receipt and an issue are already distinguishable by the sign of their quantity, and that is
 * exactly why the kind is stored anyway: the sign says which way the stock went, and the kind
 * says why. Ticket 10's adjustment can raise stock and ticket 11's reversal can lower it, so a
 * ledger that inferred meaning from the sign would have two kinds of increase it could not tell
 * apart the moment a second one existed.
 */
export const MOVEMENT_KINDS = ['receipt', 'issue', 'adjustment', 'transfer'] as const;

export type MovementKind = (typeof MOVEMENT_KINDS)[number];

/**
 * What a journal entry posted from this movement would be, in the only vocabulary inventory is
 * entitled to use.
 *
 * This is the accounting seam, and the reason it is a column on every row rather than something
 * a future Accounting module works out for itself. Accounting is a *sink*: Sales, Purchase,
 * Payroll and Manufacturing all eventually post to it, and a sink retrofitted is a sink that
 * means reopening every movement type and backfilling years of history. Carrying the
 * classification from the first movement ever recorded costs one column and makes that
 * retrofit a read.
 *
 * Deliberately *not* an account code, and deliberately not a debit/credit pair. Which nominal
 * account `stock-in` posts to is a chart-of-accounts decision, and a chart of accounts belongs
 * to the module that does not exist yet. What inventory knows — and all it knows — is that
 * stock went up against something outside inventory, or down against something outside
 * inventory. Ticket 10's transfer is the interesting third case: both sides are inventory, so
 * it posts nothing at all, which is a classification this list will need and does not have yet.
 */
export const MOVEMENT_CLASSIFICATIONS = ['stock-in', 'stock-out', 'transfer'] as const;

export type MovementClassification = (typeof MOVEMENT_CLASSIFICATIONS)[number];

/**
 * The fields a caller may sort, filter or search the movement list by.
 *
 * `productId` and `locationId` rather than codes, because this list is filtered by choosing
 * from a dropdown rather than by typing — and an identifier is what a dropdown holds. Searching
 * is deliberately absent: there is no free text on a movement to search, and a search box that
 * matched an identifier would be a box nobody could type into usefully.
 */
export const MOVEMENT_FIELDS = {
  kind: 'kind',
  productId: 'productId',
  locationId: 'locationId',
  recordedAt: 'recordedAt',
} as const;

export const STOCK_FIELDS = {
  productId: 'productId',
  locationId: 'locationId',
  quantity: 'quantity',
} as const;

/**
 * Goods arriving.
 *
 * The quantity is decimal *text* and unsigned — the caller says how much arrived, and the
 * ledger's sign is the server's business. Asking a screen to send `-5` for an issue would put
 * the one rule that makes a stock figure right into forty callers' hands.
 */
export interface RecordReceiptRequest {
  productId: string;
  locationId: string;
  /** Decimal text, greater than zero. Never a JSON number. */
  quantity: string;
}

/** Goods leaving. The same shape as a receipt, and a different act — see `MOVEMENT_PATHS`. */
export interface RecordIssueRequest {
  productId: string;
  locationId: string;
  /** Decimal text, greater than zero. The server records it as a decrease. */
  quantity: string;
}

/** Physical count discrepancy adjustment. */
export interface RecordAdjustmentRequest {
  productId: string;
  locationId: string;
  /** Signed decimal text: positive to raise stock, negative to lower stock. Never zero. */
  quantity: string;
  /** Mandatory reason explaining discrepancy. */
  reason: string;
}

/** Transferring stock between locations. */
export interface RecordTransferRequest {
  productId: string;
  fromLocationId: string;
  toLocationId: string;
  /** Decimal text, greater than zero. */
  quantity: string;
}

/** Twin linked ledger entries resulting from a transfer. */
export interface TransferResponse {
  from: MovementSummary;
  to: MovementSummary;
}

/**
 * One line of the ledger, as anything reading history sees it.
 *
 * The product's and the location's names travel with it for the reason `ProductSummary` carries
 * its unit: every screen that shows a movement shows what moved and where, and a request per
 * row to find out is an N+1 this contract can decline to create.
 */
export interface MovementSummary {
  id: string;
  kind: MovementKind;
  classification: MovementClassification;

  productId: string;
  productCode: string;
  productName: string;
  /** The unit the quantity is measured in, as it was when the movement was recorded. */
  unitCode: string;

  locationId: string;
  locationCode: string;
  locationName: string;

  /** Signed decimal text: positive for a receipt, negative for an issue. */
  quantity: string;

  /**
   * What one of these was worth when it moved, and what the movement was worth in total.
   *
   * `null` when the product had no recorded cost at the time. Not zero — a cost of zero is a
   * claim that something is worthless, and "nobody has said" is not that claim. Ticket 13's
   * valuation is what has to add these up, and it needs to be able to tell the two apart.
   */
  unitCost: MoneyValue | null;
  /** Signed, matching the quantity, so the ledger's values sum to what the stock is worth. */
  value: MoneyValue | null;

  reason: string | null;
  transferId: string | null;

  recordedById: string;
  recordedByName: string;
  /** ISO 8601. */
  recordedAt: string;
}

export type MovementResponse = MovementSummary;

export type MovementListResponse = ListResponse<MovementSummary>;

/**
 * How much of one product is at one place, right now.
 *
 * A row exists once something has moved; there is no row saying "nothing here", because a
 * location holds nothing until it holds something and a zero that had to be created in advance
 * would be a seeded row by another name.
 */
export interface StockLevelSummary {
  productId: string;
  productCode: string;
  productName: string;
  unitCode: string;

  locationId: string;
  locationCode: string;
  locationName: string;

  /** Decimal text. Can be negative until ticket 11 decides whether it may. */
  quantity: string;
}

export type StockListResponse = ListResponse<StockLevelSummary>;

export const MOVEMENT_ERROR_CODES = {
  movementNotFound: 'movement_not_found',
  /** A movement naming a product this company does not have. */
  movementProductNotFound: 'movement_product_not_found',
  /**
   * Moving stock of something that does not have any — a delivery charge, an hour of
   * consultancy. `Product.stockable` is what says so, and a catalogue that could not hold such
   * things would push every module that needs one into inventing its own.
   */
  productNotStockable: 'product_not_stockable',
  /**
   * Moving stock into or out of somewhere deactivated.
   *
   * The other side of `location_holds_stock`, and the reason that refusal can be trusted:
   * deactivating means "we do not put things here any more", so if stock could still arrive
   * afterwards the status would be a label rather than a rule.
   */
  locationNotInUse: 'location_not_in_use',
  /**
   * Transferring stock to the location it is already at.
   */
  transferSameLocation: 'transfer_same_location',
} as const;

// ─── what inventory tells the rest of the system ────────────────────────────────────

/**
 * The event a movement emits, by name.
 *
 * Named in the contract rather than in the module because the whole point of an event is that
 * somebody else binds to it, and a string only the emitter knows is not a seam. Nothing
 * consumes it today — Accounting does not exist — which is exactly the state this ticket is
 * designed to make survivable: the entries can be posted from history whenever that module
 * arrives, because every movement has carried what they need since the first one.
 */
export const INVENTORY_EVENTS = {
  movementRecorded: `${INVENTORY_MODULE}.movement.recorded`,
} as const;

/**
 * What that event carries: enough to post a journal entry, and nothing that would make the
 * listener depend on inventory's tables.
 *
 * Identifiers rather than joined-up names, unlike `MovementSummary`. A screen needs a product's
 * name because a person is reading it; a listener posting an entry needs the identifier it will
 * store, and giving it a display name would invite it to store that instead and drift.
 */
export interface StockMovementRecorded {
  movementId: string;
  kind: MovementKind;
  classification: MovementClassification;
  productId: string;
  locationId: string;
  /** Signed decimal text, matching the ledger row. */
  quantity: string;
  /** Signed. `null` when the product had no recorded cost — see `MovementSummary`. */
  value: MoneyValue | null;
  recordedById: string;
  /** ISO 8601. */
  recordedAt: string;
  reason?: string | null;
  transferId?: string | null;
}
