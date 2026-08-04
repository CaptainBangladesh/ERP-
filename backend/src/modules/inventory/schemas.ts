import {
  Decimal,
  LOCATION_CODE_PATTERN,
  LOCATION_FIELDS,
  LOCATION_STATUSES,
  MOVEMENT_FIELDS,
  QUANTITY_SCALE,
  STOCK_FIELDS,
  type LocationStatus,
} from '@erp/shared';
import type { ListSpec } from '../../platform/list';
import {
  code,
  decimal,
  identifier,
  oneOf,
  optional,
  text,
  validator,
} from '../../platform/validation';

/**
 * What inventory accepts, and what it lets a caller ask of its lists.
 *
 * Declared beside the module rather than in the platform, because the wording is the part that
 * belongs to whoever owns the screen: "Enter a code." and "Enter the location's code." are the
 * same rule and different sentences.
 */

const LOCATION_NAME = {
  missing: 'Enter a name.',
  maxLength: 200,
  tooLong: 'Use 200 characters or fewer.',
} as const;

/**
 * The code on the label, upper-cased on the way in.
 *
 * The shared `code` rule, which is the same decision a SKU takes and for the same reason:
 * normalising means the unique constraint on the column refuses what a person would call a
 * duplicate rather than what a byte comparison would. Somewhere held as both `wh-1` and `WH-1`
 * is two places one van unloads into, and the first anybody hears of it is a stock count that
 * disagrees with itself.
 *
 * The pattern comes from this module's own contract, because the frontend has to agree with it.
 * Forty characters, as a product code has: a code longer than that is a description, and there
 * is a name field for those.
 */
const LOCATION_CODE = code({
  missing: 'Enter a code.',
  maxLength: 40,
  pattern: LOCATION_CODE_PATTERN,
  invalid: 'Use letters, numbers, and . _ - / — such as “WH-1”.',
});

const STATUS = oneOf<LocationStatus>(LOCATION_STATUSES, {
  missing: 'Say whether this location is in use.',
  invalid: 'That is not a status you can set.',
});

export const CreateLocationBody = validator({
  code: LOCATION_CODE,
  name: text(LOCATION_NAME),
});

/** A change. Every field optional, at least one required — absent means "do not touch it". */
export const UpdateLocationBody = validator({
  code: optional(LOCATION_CODE),
  name: optional(text(LOCATION_NAME)),
  status: optional(STATUS),
}).and((values, report) => {
  const changed = Object.values(values).some((value) => value !== undefined);
  if (!changed) report('name', 'Change something — this request changes nothing.');
});

/**
 * What a caller may do to the location list.
 *
 * An allow-list: a field nobody names here is not reachable from a query string at all, so
 * `?sort=somethingPrivate` is refused before anything touches the database. Code and name are
 * searchable together, which is what somebody typing into a search box over a list of places
 * expects — half a code or half a name, whichever they remember.
 */
export const LOCATION_LIST: ListSpec = {
  defaultSort: LOCATION_FIELDS.code,
  fields: {
    [LOCATION_FIELDS.code]: { type: 'text', sortable: true, filterable: true, searchable: true },
    [LOCATION_FIELDS.name]: { type: 'text', sortable: true, filterable: true, searchable: true },
    [LOCATION_FIELDS.status]: { type: 'text', sortable: true, filterable: true },
    [LOCATION_FIELDS.createdAt]: { type: 'date', sortable: true, filterable: true },
  },
};

// ─── movements ──────────────────────────────────────────────────────────────────────

const PRODUCT = {
  missing: 'Choose a product.',
  invalid: 'That is not a product.',
} as const;

const LOCATION = {
  missing: 'Choose a location.',
  invalid: 'That is not a location.',
} as const;

/**
 * The smallest quantity the column can hold, which is also the smallest a caller may send.
 *
 * Naming it from the scale rather than writing `0.000001` out means the rule and the storage
 * refuse exactly the same set, and go on doing so if the scale ever moves. It is what makes
 * "greater than zero" expressible as a minimum — the shared `decimal` rule's bound is
 * inclusive, and inclusive-of-the-smallest-step is exclusive-of-zero for a fixed-scale number.
 */
const SMALLEST_QUANTITY = Decimal.parse(`0.${'0'.repeat(QUANTITY_SCALE - 1)}1`);

/**
 * How much moved — always unsigned, however it moved.
 *
 * The caller says how much arrived or how much left; which way that pushes the stock figure is
 * decided by the endpoint they chose, and written by the service. Accepting a signed quantity
 * would put the one rule that makes every stock figure right into the hands of every caller,
 * and a receipt of `-5` would be an issue nobody named.
 *
 * Zero is refused rather than accepted as a no-op. A movement of nothing is a row in a
 * permanent ledger that records that nothing happened, which is worse than useless: it is a
 * line an auditor has to ask about.
 */
const QUANTITY = decimal({
  missing: 'Enter a quantity.',
  invalid: 'Enter a quantity, such as 12 or 2.5.',
  scale: QUANTITY_SCALE,
  minimum: SMALLEST_QUANTITY,
  belowMinimum: 'Enter a quantity greater than zero — a movement of nothing is not a movement.',
});

/**
 * A receipt and an issue take the same three fields.
 *
 * One schema for both, because they genuinely are the same request: the difference between
 * them is which endpoint it was sent to, which is a difference the *contract* makes rather
 * than the body. Two identical validators would be two places for the wording to drift.
 */
export const RecordMovementBody = validator({
  productId: identifier(PRODUCT),
  locationId: identifier(LOCATION),
  quantity: QUANTITY,
});

const ADJUSTMENT_QUANTITY = decimal({
  missing: 'Enter a quantity.',
  invalid: 'Enter a quantity, such as 5 or -3.',
  scale: QUANTITY_SCALE,
});

const REASON = {
  missing: 'Enter a reason.',
  maxLength: 500,
  tooLong: 'Use 500 characters or fewer.',
} as const;

export const RecordAdjustmentBody = validator({
  productId: identifier(PRODUCT),
  locationId: identifier(LOCATION),
  quantity: ADJUSTMENT_QUANTITY,
  reason: text(REASON),
}).and((values, report) => {
  if (values.quantity.equals(Decimal.ZERO)) {
    report(
      'quantity',
      'Enter a quantity greater or less than zero — an adjustment of nothing is not an adjustment.',
    );
  }
});

const FROM_LOCATION = {
  missing: 'Choose an origin location.',
  invalid: 'That is not a location.',
} as const;

const TO_LOCATION = {
  missing: 'Choose a destination location.',
  invalid: 'That is not a location.',
} as const;

export const RecordTransferBody = validator({
  productId: identifier(PRODUCT),
  fromLocationId: identifier(FROM_LOCATION),
  toLocationId: identifier(TO_LOCATION),
  quantity: QUANTITY,
});


/**
 * What a caller may ask of the ledger.
 *
 * Newest first by default, because a history screen opens on what just happened rather than on
 * what happened when the company started. Nothing is searchable: there is no free text on a
 * movement, and a search box that matched an identifier would be one nobody could type into.
 * Product and location are filterable and not sortable — they are chosen from a dropdown, and
 * sorting a ledger by an opaque identifier orders it by nothing a person can see.
 */
export const MOVEMENT_LIST: ListSpec = {
  defaultSort: `-${MOVEMENT_FIELDS.recordedAt}`,
  fields: {
    [MOVEMENT_FIELDS.kind]: { type: 'text', sortable: true, filterable: true },
    [MOVEMENT_FIELDS.productId]: { type: 'text', filterable: true },
    [MOVEMENT_FIELDS.locationId]: { type: 'text', filterable: true },
    [MOVEMENT_FIELDS.recordedAt]: { type: 'date', sortable: true, filterable: true },
  },
};

/**
 * What a caller may ask of the stock levels.
 *
 * The two questions the ticket asks for — everywhere one product is, and everything one
 * location holds — are the same list with one filter set, so there is one endpoint rather than
 * two. Sorting by quantity is what finds the thing you are about to run out of.
 */
export const STOCK_LIST: ListSpec = {
  defaultSort: STOCK_FIELDS.productId,
  fields: {
    [STOCK_FIELDS.productId]: { type: 'text', sortable: true, filterable: true },
    [STOCK_FIELDS.locationId]: { type: 'text', sortable: true, filterable: true },
    [STOCK_FIELDS.quantity]: { type: 'decimal', sortable: true, filterable: true },
  },
};
