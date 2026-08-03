import { WARRANTY_FIELDS, WARRANTY_STATUSES, type WarrantyStatus } from '@erp/shared';
import type { ListSpec } from '../../platform/list';
import {
  accepted,
  identifier,
  oneOf,
  optional,
  refused,
  rule,
  text,
  validator,
  type FieldRule,
} from '../../platform/validation';

/**
 * What the stub accepts, and what it lets a caller ask of its list.
 */

const PRODUCT_ID = {
  missing: 'Choose a product.',
  invalid: 'Choose a product from the list.',
} as const;

/**
 * A whole number of months. Not in `platform/validation/rules.ts`: nothing else in the system
 * validates a bounded integer yet, and a rule earns a shared place when a second module needs
 * it, not on the chance one might.
 */
function months(options: { missing: string; invalid: string }): FieldRule<number> {
  return rule(options.missing, (value) => {
    const parsed = typeof value === 'number' ? value : Number(value);
    // Bounded rather than merely "a positive integer": a warranty running for six hundred
    // months (fifty years) is already past any real product's usable life, and the ceiling
    // is what stops a mistyped extra digit from being accepted as a number instead of a typo.
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 600) return refused(options.invalid);
    return accepted(parsed);
  });
}

const MONTHS = {
  missing: 'Enter how many months this warranty covers.',
  invalid: 'Enter a whole number of months, from 1 to 600.',
} as const;

const NOTES = {
  missing: 'Enter a note, or leave this blank.',
  maxLength: 500,
  tooLong: 'Use 500 characters or fewer.',
} as const;

const STATUS = oneOf<WarrantyStatus>(WARRANTY_STATUSES, {
  missing: 'Say whether this warranty is active.',
  invalid: 'That is not a status you can set.',
});

export const CreateWarrantyBody = validator({
  productId: identifier(PRODUCT_ID),
  months: months(MONTHS),
  notes: optional(text(NOTES)),
});

/** A change. Every field optional, at least one required — absent means "do not touch it". */
export const UpdateWarrantyBody = validator({
  months: optional(months(MONTHS)),
  notes: optional(text(NOTES)),
  status: optional(STATUS),
}).and((values, report) => {
  const changed = Object.values(values).some((value) => value !== undefined);
  if (!changed) report('months', 'Change something — this request changes nothing.');
});

/**
 * What a caller may do to the list. `productName` is not offered — it is resolved through
 * `ProductCatalogue` at read time rather than stored, so there is no column to sort or filter
 * it by; a caller wanting to find a product's warranties filters the *products* screen instead.
 */
export const WARRANTY_LIST: ListSpec = {
  defaultSort: WARRANTY_FIELDS.createdAt,
  fields: {
    [WARRANTY_FIELDS.months]: { type: 'integer', sortable: true, filterable: true },
    [WARRANTY_FIELDS.status]: { type: 'text', sortable: true, filterable: true },
    [WARRANTY_FIELDS.createdAt]: { type: 'date', sortable: true, filterable: true },
  },
};
