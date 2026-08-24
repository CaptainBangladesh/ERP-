import type { ListResponse } from '../../http/list.js';

/**
 * The crm module's wire contract — its paths, bodies, responses and refusals.
 *
 * Ticket 02's cut is a `Lead` alone: a not-yet-qualified prospect, entered before there is a
 * `Party` to hold it. Qualifying is the seam to the rest of the system — it never creates a
 * `Party` here, because Parties' own `POST /api/parties` is the only place one is created.
 * `crm` composes that flow from the *frontend*; the backend only ever links an id it is given.
 *
 * Wire shapes only, as with every contract here. What a Lead *is* lives in
 * `backend/src/modules/crm`. Nothing outside the module reads its tables.
 */

export const CRM_MODULE = 'crm';

/** No leading slash — Nest composes controller prefixes. */
export const CRM_ROUTE = 'api/crm';

export const LEAD_PATHS = {
  leads: `/${CRM_ROUTE}/leads`,
  lead: (id: string) => `/${CRM_ROUTE}/leads/${id}`,
  qualify: (id: string) => `/${CRM_ROUTE}/leads/${id}/qualify`,
  disqualify: (id: string) => `/${CRM_ROUTE}/leads/${id}/disqualify`,
  reopen: (id: string) => `/${CRM_ROUTE}/leads/${id}/reopen`,
} as const;

/**
 * Where a Lead came from. A plain wire-contract value like `Party.kind` rather than a
 * Postgres enum, so a company's real channel vocabulary is never fixed at ship time.
 */
export const LEAD_SOURCES = ['referral', 'inbound', 'outbound', 'event', 'other'] as const;

export type LeadSource = (typeof LEAD_SOURCES)[number];

/**
 * Where a Lead is in its lifecycle. `qualified` and `disqualified` are reached only through
 * their own endpoints — `qualify`, `disqualify` and `reopen` — never by naming them directly
 * in an update, so that `Lead.partyId` and `Lead.priorStatus` can never drift from the status
 * that is supposed to imply them.
 */
export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'disqualified'] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** The statuses an ordinary edit may set. `qualified` and `disqualified` are reached by acting, never by asking. */
export const SETTABLE_LEAD_STATUSES = ['new', 'contacted'] as const;

export type SettableLeadStatus = (typeof SETTABLE_LEAD_STATUSES)[number];

/**
 * How a Lead is qualified. The frontend always resolves a `Party` first — creating one via
 * Parties' own `POST /api/parties`, or finding an existing one — and sends the resulting id
 * either way; `action` says which happened, but the endpoint itself does not branch on it or
 * store it — `partyId` is all it acts on. `crm` never creates a `Party` and never writes a
 * `PartyRole`.
 */
export const LEAD_QUALIFY_ACTIONS = ['create', 'link'] as const;

export type LeadQualifyAction = (typeof LEAD_QUALIFY_ACTIONS)[number];

/**
 * The fields a caller may sort, filter or search the Lead list by.
 *
 * Named here rather than as string literals on either side: the backend's list declaration
 * and the frontend's table columns have to agree, so a rename should be a type error in both
 * workspaces rather than a list that quietly stops sorting.
 */
export const LEAD_FIELDS = {
  name: 'name',
  organisationName: 'organisationName',
  email: 'email',
  source: 'source',
  status: 'status',
  assignedToUserId: 'assignedToUserId',
  createdAt: 'createdAt',
} as const;

export interface CreateLeadRequest {
  name: string;
  /** Free text — no `Party` exists yet to hold a real organisation record. */
  organisationName?: string;
  email?: string;
  phone?: string;
  source: LeadSource;
  /** A plain platform User id, resolved and displayed by the frontend. No FK, no lookup here. */
  assignedToUserId?: string;
}

/** A change. Every field optional, at least one required — absent means "do not touch it". */
export interface UpdateLeadRequest {
  name?: string;
  organisationName?: string;
  email?: string;
  phone?: string;
  source?: LeadSource;
  status?: SettableLeadStatus;
  assignedToUserId?: string;
}

export interface QualifyLeadRequest {
  action: LeadQualifyAction;
  /** The Party this Lead becomes — created or found by the frontend beforehand. */
  partyId: string;
}

export interface LeadSummary {
  id: string;
  name: string;
  organisationName: string | null;
  email: string | null;
  phone: string | null;
  source: LeadSource;
  status: LeadStatus;
  assignedToUserId: string | null;
  /** Set once qualification links or creates a Party. Null until then. */
  partyId: string | null;
}

export type LeadResponse = LeadSummary;

export type LeadListResponse = ListResponse<LeadSummary>;

export const LEAD_ERROR_CODES = {
  leadNotFound: 'lead_not_found',
  /** The `partyId` a qualify request named does not resolve, through `PartyDirectory`. */
  leadPartyNotFound: 'lead_party_not_found',
  /** Qualifying a Lead that already holds a Party, or one that is currently disqualified. */
  leadNotQualifiable: 'lead_not_qualifiable',
  leadAlreadyDisqualified: 'lead_already_disqualified',
  leadNotDisqualified: 'lead_not_disqualified',
} as const;
