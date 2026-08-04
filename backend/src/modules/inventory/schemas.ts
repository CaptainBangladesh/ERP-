import {
  LOCATION_CODE_PATTERN,
  LOCATION_FIELDS,
  LOCATION_STATUSES,
  type LocationStatus,
} from '@erp/shared';
import type { ListSpec } from '../../platform/list';
import { code, oneOf, optional, text, validator } from '../../platform/validation';

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
