import {
  LEAD_FIELDS,
  LEAD_QUALIFY_ACTIONS,
  LEAD_SOURCES,
  SETTABLE_LEAD_STATUSES,
  type LeadQualifyAction,
  type LeadSource,
  type SettableLeadStatus,
} from '@erp/shared';
import type { ListSpec } from '../../platform/list';
import { email, identifier, oneOf, optional, text, validator } from '../../platform/validation';

/**
 * What crm's Lead endpoints accept, and what its list lets a caller ask of it.
 *
 * Declared beside the module rather than in the platform, because the wording is the part
 * that belongs to whoever owns the screen: "Enter the lead's name." and "Enter the
 * employee's name." are the same rule and different sentences.
 */

const LEAD_NAME = {
  missing: "Enter the lead's name.",
  maxLength: 200,
  tooLong: 'Use 200 characters or fewer.',
} as const;

/** Free text — no `Party` exists yet to hold a real organisation record. */
const ORGANISATION_NAME = {
  missing: "Enter the organisation's name.",
  maxLength: 200,
  tooLong: 'Use 200 characters or fewer.',
} as const;

const CONTACT_EMAIL = {
  missing: 'Enter an email address.',
  invalid: 'Enter an email address, such as name@example.com.',
} as const;

const PHONE = { missing: 'Enter a phone number.', maxLength: 40 } as const;

const SOURCE = oneOf<LeadSource>(LEAD_SOURCES, {
  missing: 'Say where this lead came from.',
  invalid: 'That is not a source.',
});

const STATUS = oneOf<SettableLeadStatus>(SETTABLE_LEAD_STATUSES, {
  missing: 'Say what status this lead is in.',
  // `qualified` and `disqualified` are real and deliberately not offered here: each is
  // reached by its own endpoint, which is what keeps `partyId` and the stored prior status
  // from drifting away from what the status implies.
  invalid: 'That is not a status you can set directly.',
});

const ASSIGNEE = identifier({
  missing: 'Choose a colleague to assign this to.',
  invalid: 'That is not a user.',
});

const PARTY_ID = identifier({
  missing: 'Choose a party.',
  invalid: 'That is not a party.',
});

const QUALIFY_ACTION = oneOf<LeadQualifyAction>(LEAD_QUALIFY_ACTIONS, {
  missing: 'Say how this lead is being qualified.',
  invalid: 'That is not a way to qualify a lead.',
});

export const CreateLeadBody = validator({
  name: text(LEAD_NAME),
  organisationName: optional(text(ORGANISATION_NAME)),
  email: optional(email(CONTACT_EMAIL)),
  phone: optional(text(PHONE)),
  source: SOURCE,
  assignedToUserId: optional(ASSIGNEE),
});

/**
 * A change to a Lead. Every field optional, at least one required.
 *
 * `status` here reaches only `new` and `contacted` — moving to `qualified` or
 * `disqualified` is always the dedicated endpoint that comes with it, never a bare field
 * flip, so that what a status implies (a linked Party, a stored prior status to restore) is
 * never set by one path and not the other.
 */
export const UpdateLeadBody = validator({
  name: optional(text(LEAD_NAME)),
  organisationName: optional(text(ORGANISATION_NAME)),
  email: optional(email(CONTACT_EMAIL)),
  phone: optional(text(PHONE)),
  source: optional(SOURCE),
  status: optional(STATUS),
  assignedToUserId: optional(ASSIGNEE),
}).and((values, report) => {
  const changed = Object.values(values).some((value) => value !== undefined);
  if (!changed) report('name', 'Change something — this request changes nothing.');
});

/**
 * `partyId` is required in both branches. `PartyDirectory` is read-only, so `crm` never
 * creates a Party itself — the frontend always resolves one first (creating it via Parties'
 * own `POST /api/parties`, or finding an existing one) and hands the id here either way.
 * `action` records which of those happened; it does not change what this endpoint does.
 */
export const QualifyLeadBody = validator({
  action: QUALIFY_ACTION,
  partyId: PARTY_ID,
});

/**
 * What a caller may do to the Lead list.
 *
 * An allow-list: a field nobody names here is not reachable from a query string at all, so
 * `?sort=priorStatus` is refused before anything touches the database.
 */
export const LEAD_LIST: ListSpec = {
  defaultSort: LEAD_FIELDS.name,
  fields: {
    [LEAD_FIELDS.name]: { type: 'text', sortable: true, filterable: true, searchable: true },
    [LEAD_FIELDS.organisationName]: { type: 'text', filterable: true, searchable: true },
    [LEAD_FIELDS.email]: { type: 'text', filterable: true, searchable: true },
    [LEAD_FIELDS.source]: { type: 'text', sortable: true, filterable: true },
    [LEAD_FIELDS.status]: { type: 'text', sortable: true, filterable: true },
    [LEAD_FIELDS.assignedToUserId]: { type: 'text', filterable: true },
    [LEAD_FIELDS.createdAt]: { type: 'date', sortable: true, filterable: true },
  },
};
