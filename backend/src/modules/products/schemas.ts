import {
  Decimal,
  PRODUCT_CODE_PATTERN,
  PRODUCT_FIELDS,
  CATALOGUE_STATUSES,
  UNIT_CODE_PATTERN,
  UNIT_FIELDS,
  MONEY_SCALE,
  type CatalogueStatus,
} from '@erp/shared';
import type { ListSpec } from '../../platform/list';
import {
  accepted,
  code,
  decimal,
  flag,
  identifier,
  money,
  oneOf,
  optional,
  refused,
  rule,
  text,
  validator,
} from '../../platform/validation';

/**
 * What the product master accepts, and what it lets a caller ask of its lists.
 *
 * Declared beside the module rather than in the platform, because the wording is the part
 * that belongs to whoever owns the screen: "Enter a code." and "Enter the product's SKU." are
 * the same rule and different sentences.
 *
 * Two of these rules carry a decision rather than a constraint, and both are worth reading:
 * a product code is upper-cased and a unit code is not.
 */

const PRODUCT_NAME = {
  missing: 'Enter a name.',
  maxLength: 200,
  tooLong: 'Use 200 characters or fewer.',
} as const;

const UNIT_NAME = {
  missing: 'Enter a name, such as “Kilogram”.',
  maxLength: 60,
  tooLong: 'Use 60 characters or fewer.',
} as const;

const GROUP_NAME = {
  missing: 'Name what these units measure, such as “Weight”.',
  maxLength: 60,
  tooLong: 'Use 60 characters or fewer.',
} as const;

/**
 * A SKU, upper-cased on the way in.
 *
 * Normalised rather than compared case-insensitively, so that the uniqueness constraint on
 * the column means what it appears to mean. A catalogue holding both `widget-1` and
 * `WIDGET-1` is a catalogue with a duplicate nobody notices until stock has been split across
 * the two, and by then merging them is somebody's afternoon.
 */
const PRODUCT_CODE = code({
  missing: 'Enter a code.',
  maxLength: 40,
  pattern: PRODUCT_CODE_PATTERN,
  invalid: 'Use letters, numbers, and . _ - / — such as “WIDGET-1”.',
});

/**
 * A unit symbol, exactly as it was typed.
 *
 * The opposite decision to the one above, for a reason rather than by oversight: `kg` is the
 * SI symbol and `KG` is not, `kWh` means something that `KWH` and `kwh` both do not, and no
 * normalisation is right for all three. The duplicate that costs a catalogue dearly costs a
 * unit list nothing — units are a handful of rows on one screen, so two spellings of one are
 * visible immediately rather than hidden among ten thousand products.
 */
const UNIT_CODE = rule<string>('Enter a code, such as “kg”.', (value) => {
  const given = typeof value === 'string' ? value.trim() : '';
  if (given.length === 0) return refused('Enter a code, such as “kg”.');
  if (given.length > 12) return refused('Use 12 characters or fewer.');

  return UNIT_CODE_PATTERN.test(given)
    ? accepted(given)
    : refused('Use letters, numbers, and % . / - — such as “kg”, “kWh” or “m/s”.');
});

const STATUS = oneOf<CatalogueStatus>(CATALOGUE_STATUSES, {
  missing: 'Say whether this is active.',
  invalid: 'That is not a status you can set.',
});

const UNIT = { missing: 'Choose a unit of measure.', invalid: 'That is not a unit.' } as const;

/**
 * What one of these costs.
 *
 * The shared money rule, which takes either decimal text or `{ amount, currency }` and never
 * a JSON number — a double cannot hold every value the column can, so accepting one would
 * lose pennies before validation had a chance to look. Negative is refused: a cost below zero
 * is a data entry mistake in every case anybody has been able to name, and stock valued at a
 * negative amount is a report nobody can explain.
 */
const COST = money({
  missing: 'Enter a cost.',
  invalid: 'Enter an amount, such as 12.50.',
  scale: MONEY_SCALE,
  minimum: Decimal.ZERO,
  belowMinimum: 'A cost cannot be negative.',
});

/**
 * The decimal places a ratio is held at, matching `numeric(24, 12)` in the schema — so what
 * validates is exactly what stores.
 *
 * Twelve rather than the six a quantity uses, and the difference is the point: a quantity is a
 * measurement and a ratio is a *definition*. An ounce is 0.028349523125 kilograms exactly, and
 * rounding the definition to six places would make every weight derived from it permanently
 * and invisibly wrong.
 */
export const RATIO_SCALE = 12;

const SMALLEST_RATIO = Decimal.parse(`0.${'0'.repeat(RATIO_SCALE - 1)}1`);

/**
 * How many of the group's base unit one of these is.
 *
 * Greater than zero, because it is a divisor: a ratio of zero would make every conversion out
 * of the unit a division by nothing, and a negative one would make a kilogram of flour weigh
 * less than none. The smallest permitted value is the smallest the column can hold, so the
 * rule and the storage refuse exactly the same set.
 */
const RATIO = decimal({
  missing: 'Enter how many of the base unit one of these is.',
  invalid: 'Enter a number, such as 1000.',
  scale: RATIO_SCALE,
  minimum: SMALLEST_RATIO,
  belowMinimum: 'A ratio is how many of the base unit one of these is, so it is more than zero.',
});

export const CreateProductBody = validator({
  code: PRODUCT_CODE,
  name: text(PRODUCT_NAME),
  unitId: identifier(UNIT),
  cost: optional(COST),
  stockable: optional(flag({ missing: 'Say whether stock of this is counted.' })),
});

/**
 * A change to a product. Every field optional, at least one required.
 *
 * Absent means "do not touch it", including a field sent as `null` or as an empty string —
 * the platform reads both as absent. The consequence worth stating: there is no way to
 * *clear* a cost through this endpoint, only to change one. Offering erasure should be an
 * explicit act when somebody asks for it, not an empty box meaning "delete", which is also
 * what an accidental keystroke means.
 */
export const UpdateProductBody = validator({
  code: optional(PRODUCT_CODE),
  name: optional(text(PRODUCT_NAME)),
  unitId: optional(identifier(UNIT)),
  cost: optional(COST),
  stockable: optional(flag({ missing: 'Say whether stock of this is counted.' })),
  status: optional(STATUS),
}).and((values, report) => {
  const changed = Object.values(values).some((value) => value !== undefined);
  if (!changed) report('name', 'Change something — this request changes nothing.');
});

export const AddProductSupplierBody = validator({
  partyId: identifier({
    missing: 'Choose a supplier.',
    invalid: 'That is not a party.',
  }),
});

export const CreateUnitGroupBody = validator({ name: text(GROUP_NAME) });

export const CreateUnitBody = validator({
  code: UNIT_CODE,
  name: text(UNIT_NAME),
  groupId: optional(
    identifier({ missing: 'Choose a group.', invalid: 'That is not a unit group.' }),
  ),
  ratio: optional(RATIO),
}).and((values, report) => {
  // A ratio only means something inside a group: it says how many of the *group's* base unit
  // one of these is, and a unit belonging to no group has nothing to be a ratio of.
  if (!values.groupId && values.ratio && !values.ratio.equals(Decimal.ONE)) {
    report('ratio', 'A unit that belongs to no group converts to nothing, so its ratio is 1.');
  }
});

export const UpdateUnitBody = validator({
  name: optional(text(UNIT_NAME)),
  ratio: optional(RATIO),
  groupId: optional(
    identifier({ missing: 'Choose a group.', invalid: 'That is not a unit group.' }),
  ),
  status: optional(STATUS),
}).and((values, report) => {
  const changed = Object.values(values).some((value) => value !== undefined);
  if (!changed) report('name', 'Change something — this request changes nothing.');
});

/**
 * What a caller may do to the product list.
 *
 * An allow-list, so a field nobody names here is not reachable from a query string at all.
 * Code and name are searchable together, which is what somebody typing into a search box over
 * a catalogue expects: half a SKU or half a name, whichever they remember.
 */
export const PRODUCT_LIST: ListSpec = {
  defaultSort: PRODUCT_FIELDS.code,
  fields: {
    [PRODUCT_FIELDS.code]: { type: 'text', sortable: true, filterable: true, searchable: true },
    [PRODUCT_FIELDS.name]: { type: 'text', sortable: true, filterable: true, searchable: true },
    [PRODUCT_FIELDS.status]: { type: 'text', sortable: true, filterable: true },
    [PRODUCT_FIELDS.stockable]: { type: 'boolean', filterable: true },
    [PRODUCT_FIELDS.unitId]: { type: 'text', filterable: true },
    [PRODUCT_FIELDS.createdAt]: { type: 'date', sortable: true, filterable: true },
  },
};

export const UNIT_LIST: ListSpec = {
  defaultSort: UNIT_FIELDS.code,
  fields: {
    [UNIT_FIELDS.code]: { type: 'text', sortable: true, filterable: true, searchable: true },
    [UNIT_FIELDS.name]: { type: 'text', sortable: true, filterable: true, searchable: true },
    [UNIT_FIELDS.status]: { type: 'text', sortable: true, filterable: true },
    [UNIT_FIELDS.groupId]: { type: 'text', filterable: true },
  },
};
