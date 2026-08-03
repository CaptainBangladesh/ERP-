import type { ListResponse } from '../../http/list.js';

/**
 * The parties module's wire contract — one address book's paths, bodies, responses and
 * refusals.
 *
 * A party is any person or organisation the business deals with. The same record is a
 * customer to Sales, a supplier to Purchase and an employee contact to HRM, which is the
 * whole reason it is one Core module rather than four private address books that drift.
 *
 * Wire shapes only, as with every contract here. What a party *is* — the rules about roles,
 * merging and deactivation — lives in `backend/src/modules/parties`, and what other modules
 * may ask of it is `PartyDirectory`, its public surface. Nothing outside the module reads
 * its tables.
 */

export const PARTIES_MODULE = 'parties';

/** No leading slash — Nest composes controller prefixes. */
export const PARTIES_ROUTE = 'api/parties';

export const PARTY_PATHS = {
  parties: `/${PARTIES_ROUTE}`,
  party: (id: string) => `/${PARTIES_ROUTE}/${id}`,
  /**
   * The roles this company has actually used, for a filter control to offer.
   *
   * Derived from the data rather than from a list anywhere, which is what makes "adding a
   * role does not require changing the Parties module" true of the screens as well as the
   * API: a role exists because somebody gave it to somebody.
   */
  roles: `/${PARTIES_ROUTE}/roles`,
  partyRoles: (id: string) => `/${PARTIES_ROUTE}/${id}/roles`,
  partyRole: (id: string, role: string) =>
    `/${PARTIES_ROUTE}/${id}/roles/${encodeURIComponent(role)}`,
  addresses: (id: string) => `/${PARTIES_ROUTE}/${id}/addresses`,
  address: (id: string, addressId: string) =>
    `/${PARTIES_ROUTE}/${id}/addresses/${addressId}`,
  merge: (id: string) => `/${PARTIES_ROUTE}/${id}/merge`,
} as const;

/**
 * A person or an organisation, and nothing else.
 *
 * The distinction is the one the rest of the system actually branches on: only an
 * organisation can have people belonging to it, and only a person can belong to one.
 */
export const PARTY_KINDS = ['person', 'organisation'] as const;

export type PartyKind = (typeof PARTY_KINDS)[number];

/**
 * Active, or kept for the sake of history.
 *
 * `inactive` is what deactivation produces — a supplier nobody buys from any more, whose
 * past orders still have to make sense. `merged` is not something a caller sets: it is what
 * a party becomes when it turns out to have been a duplicate of another, and the row stays
 * so that anything already pointing at it still resolves.
 */
export const PARTY_STATUSES = ['active', 'inactive', 'merged'] as const;

export type PartyStatus = (typeof PARTY_STATUSES)[number];

/** The statuses a caller may set. `merged` is reached by merging, never by asking. */
export const SETTABLE_PARTY_STATUSES = ['active', 'inactive'] as const;

export type SettablePartyStatus = (typeof SETTABLE_PARTY_STATUSES)[number];

/**
 * The roles this system has needed so far, for a screen to suggest.
 *
 * Deliberately *suggestions* and not a closed set. A role is an ordinary lowercase slug and
 * the module stores whatever it is given, so the module Sales lands in can introduce
 * `prospect` by declaring the constant in its own contract and giving it to somebody —
 * nothing in Parties changes, and nothing central lists roles.
 *
 * The rule the module does enforce is the *shape*, because a role is compared, filtered on
 * and put in a URL.
 */
export const SUGGESTED_PARTY_ROLES = [
  'customer',
  'supplier',
  'employee-contact',
] as const;

/** Lowercase kebab-case, like a module name and for the same reasons. */
export const PARTY_ROLE_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * The fields a caller may sort, filter or search the party list by.
 *
 * Named here rather than as string literals on either side: the backend's list declaration
 * and the frontend's table columns have to agree, so a rename should be a type error in both
 * workspaces rather than a list that quietly stops sorting.
 *
 * `role` is the interesting one. It is not a column — it lives on the role table beside the
 * party — but it is filterable exactly like one, because which table a field is stored in is
 * not something the person operating a list screen should have to know.
 */
export const PARTY_FIELDS = {
  name: 'name',
  kind: 'kind',
  status: 'status',
  email: 'email',
  role: 'role',
  organisationId: 'organisationId',
  createdAt: 'createdAt',
} as const;

export interface CreatePartyRequest {
  kind: PartyKind;
  name: string;
  email?: string;
  phone?: string;
  /** Only for a person, and only an organisation's id. */
  organisationId?: string;
  /** Roles to hold from the start. They can equally be added afterwards. */
  roles?: string[];
}

export interface UpdatePartyRequest {
  name?: string;
  email?: string;
  phone?: string;
  organisationId?: string | null;
  status?: SettablePartyStatus;
}

export interface AddPartyRoleRequest {
  role: string;
}

export interface CreatePartyAddressRequest {
  /** What this address is for: 'Registered office', 'Delivery'. The user's own words. */
  label: string;
  line1: string;
  line2?: string;
  city: string;
  postcode: string;
  country: string;
  /** The one used when nothing says otherwise. Setting it demotes whichever held it. */
  primary?: boolean;
}

export interface MergePartiesRequest {
  /**
   * The party that turns out to be the duplicate. Its roles, addresses, contact details and
   * members move to the party in the path, and it becomes `merged` rather than disappearing.
   */
  duplicateId: string;
}

export interface PartyAddressResponse {
  id: string;
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  postcode: string;
  country: string;
  primary: boolean;
}

/**
 * A party as another screen or module sees it: enough to identify and contact, without its
 * addresses.
 *
 * This is also the shape `PartyDirectory` answers with, which is deliberate. What Sales
 * needs to show a customer's name beside an order and what a list row needs are the same
 * thing, and two shapes for it would be two things to keep in step.
 */
export interface PartySummary {
  id: string;
  kind: PartyKind;
  name: string;
  email: string | null;
  phone: string | null;
  status: PartyStatus;
  /** Sorted, so two parties holding the same roles read the same way. */
  roles: string[];
  /** The organisation a person belongs to, if any. */
  organisationId: string | null;
  organisationName: string | null;
  /** Set only on a party that was merged away, naming the one that survived. */
  mergedIntoId: string | null;
}

export interface PartyResponse extends PartySummary {
  addresses: PartyAddressResponse[];
  /** For an organisation: the people who belong to it. Empty for a person. */
  members: PartySummary[];
}

export type PartyListResponse = ListResponse<PartySummary>;

/** The roles in use in this company, ascending. */
export interface PartyRolesResponse {
  roles: string[];
}

export const PARTY_ERROR_CODES = {
  partyNotFound: 'party_not_found',
  /** A person was given people of their own, or an organisation was put inside another. */
  notAnOrganisation: 'not_an_organisation',
  /** Merging a party into itself, or into one that has itself been merged away. */
  cannotMerge: 'cannot_merge',
  /** Editing, deactivating or re-roling a party that is no longer the real record. */
  partyMerged: 'party_merged',
  addressNotFound: 'address_not_found',
} as const;
