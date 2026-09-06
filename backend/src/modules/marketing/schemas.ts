import { MARKETING_FIELDS, MARKETING_STATUSES, type MarketingStatus } from '@erp/shared';
import type { ListSpec } from '../../platform/list';
import { oneOf, optional, text, validator } from '../../platform/validation';

/**
 * What this module accepts, and what it lets a caller ask of its list.
 *
 * Declared beside the module rather than in the platform, because the wording is the part
 * that belongs to whoever owns the screen: "Enter a name." and "Enter the marketing's
 * name." are the same rule and different sentences.
 */

const MARKETING_NAME = {
  missing: 'Enter a name.',
  maxLength: 200,
  tooLong: 'Use 200 characters or fewer.',
} as const;

const STATUS = oneOf<MarketingStatus>(MARKETING_STATUSES, {
  missing: 'Say whether this marketing is active.',
  invalid: 'That is not a status you can set.',
});

export const CreateMarketingBody = validator({
  name: text(MARKETING_NAME),
});

/** A change. Every field optional, at least one required — absent means "do not touch it". */
export const UpdateMarketingBody = validator({
  name: optional(text(MARKETING_NAME)),
  status: optional(STATUS),
}).and((values, report) => {
  const changed = Object.values(values).some((value) => value !== undefined);
  if (!changed) report('name', 'Change something — this request changes nothing.');
});

/**
 * What a caller may do to the list.
 *
 * An allow-list: a field nobody names here is not reachable from a query string at all, so
 * '?sort=somethingPrivate' is refused before anything touches the database.
 */
export const MARKETING_LIST: ListSpec = {
  defaultSort: MARKETING_FIELDS.name,
  fields: {
    [MARKETING_FIELDS.name]: { type: 'text', sortable: true, filterable: true, searchable: true },
    [MARKETING_FIELDS.status]: { type: 'text', sortable: true, filterable: true },
    [MARKETING_FIELDS.createdAt]: { type: 'date', sortable: true, filterable: true },
  },
};
