import type { ListResponse } from '../../http/list.js';
import type { MoneyValue } from '../../numeric/money.js';

/**
 * The crm module's wire contract — its paths, bodies, responses and refusals.
 *
 * Ticket 02's cut is a `Lead` alone: a not-yet-qualified prospect, entered before there is a
 * `Party` to hold it. Ticket 03 adds `Stage` and `Deal`: a company's own pipeline, and a sale in
 * progress against a real Party moving through it.
 *
 * Wire shapes only, as with every contract here. What records *are* lives in
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
  files: (id: string) => `/${CRM_ROUTE}/leads/${id}/files`,
  file: (leadId: string, fileId: string) => `/${CRM_ROUTE}/leads/${leadId}/files/${fileId}`,
  /** The bytes themselves. A stored attachment nobody can open is only a filename. */
  fileDownload: (leadId: string, fileId: string) =>
    `/${CRM_ROUTE}/leads/${leadId}/files/${fileId}/download`,
} as const;

export const STAGE_PATHS = {
  stages: `/${CRM_ROUTE}/stages`,
  stage: (id: string) => `/${CRM_ROUTE}/stages/${id}`,
} as const;

export const DEAL_PATHS = {
  deals: `/${CRM_ROUTE}/deals`,
  deal: (id: string) => `/${CRM_ROUTE}/deals/${id}`,
  /**
   * What several parties have in flight, answered in one request.
   *
   * The Contacts board shows every contact's deals in a column, and reading that a party at a
   * time is a request per row — the N+1 `PartyDirectory.parties` exists to prevent, arriving
   * here from the other direction. Takes `?partyIds=a,b,c`.
   *
   * Declared before `deal(id)` on the controller, or `by-party` is resolved as an id.
   */
  dealsByParty: `/${CRM_ROUTE}/deals/by-party`,
} as const;

/**
 * The most parties one roll-up may be asked about — a board's page, not a company.
 *
 * A hundred rather than more because the ids travel in the URL: a hundred uuids is roughly
 * 3.7KB of query string, and twice that is close enough to the 8KB a good many proxies stop
 * at to be a bug that only appears on somebody else's network.
 */
export const DEAL_ROLLUP_MAX_PARTIES = 100;

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

/**
 * What `Lead.status` actually holds: one of the four built-in `LEAD_STATUSES`, or the key of a
 * status this company added itself.
 *
 * The four built-ins keep their own narrow `LeadStatus` type because the lifecycle is written in
 * terms of them — `qualify`, `disqualify` and `reopen` name them by value, and a workflow rule
 * that watches `qualified` has to keep meaning the shipped `qualified`. A custom status is an
 * extra settable stage alongside `new` and `contacted`; it is never a terminal state, so nothing
 * in the lifecycle has to learn about it.
 */
export type LeadStatusKey = LeadStatus | (string & {});

/** True for the four statuses the module's own lifecycle is written against. */
export function isBuiltInLeadStatus(status: LeadStatusKey): status is LeadStatus {
  return (LEAD_STATUSES as readonly string[]).includes(status);
}

/** The statuses an ordinary edit may set. `qualified` and `disqualified` are reached by acting, never by asking. */
export const SETTABLE_LEAD_STATUSES = ['new', 'contacted'] as const;

export type SettableLeadStatus = (typeof SETTABLE_LEAD_STATUSES)[number];

/** A settable built-in, or a custom status — which is only ever settable. */
export type SettableLeadStatusKey = SettableLeadStatus | (string & {});

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
 * What a Stage may mean, beyond "in flight". `STAGE_OUTCOMES` is what an update may *set* —
 * `'won'` or `'lost'`, and at most one Stage per company may hold each, a cross-row invariant
 * `StagesService` enforces rather than the schema. `null` is never sent on a write: there is no
 * way to clear a set outcome back to in-flight through this endpoint, only to change it, the
 * same discipline `UpdateProductRequest.cost` follows. `StageOutcome` is the wider *read* type
 * every Stage response carries, including the null case an ordinary in-flight Stage is in.
 */
export const STAGE_OUTCOMES = ['won', 'lost'] as const;

export type SettableStageOutcome = (typeof STAGE_OUTCOMES)[number];

export type StageOutcome = SettableStageOutcome | null;

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
  sourceId: 'sourceId',
  groupId: 'groupId',
  status: 'status',
  assignedToUserId: 'assignedToUserId',
  createdAt: 'createdAt',
} as const;

/** The fields a caller may sort, filter or search the Stage list by. */
export const STAGE_FIELDS = {
  name: 'name',
  order: 'order',
  outcome: 'outcome',
  createdAt: 'createdAt',
} as const;

/**
 * The fields a caller may sort, filter or search the Deal list by.
 *
 * `amount` is not among them, matching `PRODUCT_FIELDS`' own omission of `cost`: a money
 * column is not one this platform's list endpoints sort or filter by.
 */
export const DEAL_FIELDS = {
  name: 'name',
  expectedCloseDate: 'expectedCloseDate',
  stageId: 'stageId',
  partyId: 'partyId',
  assignedToUserId: 'assignedToUserId',
  createdAt: 'createdAt',
} as const;

export type LeadCustomValues = Record<string, string | number | boolean | null | string[]>;

export interface CreateLeadRequest {
  name: string;
  organisationName?: string;
  email?: string;
  phone?: string;
  source?: LeadSource;
  sourceId?: string;
  groupId?: string;
  assignedToUserId?: string;
  /**
   * Everyone this lead is assigned to, since a lead may be worked by several people at once.
   * Authoritative when present; the first is kept as the primary `assignedToUserId`. Omit it to
   * assign nobody, or send `[a, b]` to share the lead.
   */
  assigneeUserIds?: string[];
  customValues?: LeadCustomValues;
}

export interface UpdateLeadRequest {
  name?: string;
  organisationName?: string | null;
  email?: string | null;
  phone?: string | null;
  source?: LeadSource;
  sourceId?: string | null;
  /**
   * A status an ordinary edit may set: `new`, `contacted`, or the key of a custom status this
   * company added. `qualified` and `disqualified` are refused here — they are reached by
   * qualifying or disqualifying, so the Party link can never go missing.
   */
  status?: SettableLeadStatusKey;
  assignedToUserId?: string | null;
  /**
   * The complete set of people assigned to this lead. When present it replaces the current set
   * (send `[]` to take everyone off); the first becomes the primary `assignedToUserId`. Omit it
   * to leave ownership untouched. Sending the legacy single `assignedToUserId` instead still
   * works — it is read as a one-person set.
   */
  assigneeUserIds?: string[];
  groupId?: string | null;
  customValues?: LeadCustomValues;
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
  sourceId?: string | null;
  sourceName?: string | null;
  status: LeadStatusKey;
  /** The primary owner — the first of `assigneeUserIds`, or null when nobody is assigned. */
  assignedToUserId: string | null;
  /** Everyone assigned to the lead, primary first. `[]` when nobody is. */
  assigneeUserIds: string[];
  partyId: string | null;
  groupId?: string | null;
  groupName?: string | null;
  customValues?: LeadCustomValues;
}

export type LeadResponse = LeadSummary;

export type LeadListResponse = ListResponse<LeadSummary>;

export interface LeadAttachmentResponse {
  id: string;
  leadId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: string;
}

export type LeadAttachmentListResponse = ListResponse<LeadAttachmentResponse>;

/** Where a lead's stored capture-form responses are read from. */
export const LEAD_SUBMISSION_PATHS = {
  byLead: (id: string) => `/${CRM_ROUTE}/leads/${id}/submissions`,
} as const;

/**
 * One capture-form response tied to a Lead.
 *
 * `rawPayload` is every answer exactly as it arrived — including the ones no field maps, which
 * is the whole point of storing it: an answer with nowhere to go is still something the lead
 * told us.
 *
 * `mappedFields` says which of those answers reached the Lead, and what each one fed: it is
 * keyed by the answer's own key and valued by the Lead field that key was mapped onto. Keyed
 * that way round deliberately — a webhook source maps `entry_104` onto `budget`, so a set of
 * *field* names could not tell you which answer was mapped, and the Survey tab's whole job is
 * to distinguish a mapped answer from an unmapped one. The value read is not repeated here;
 * it is in `rawPayload` under the same key.
 */
export interface LeadSubmissionSummary {
  id: string;
  leadId: string;
  captureSourceId: string | null;
  /** The form's name as it stood when the response arrived; the source may be renamed later. */
  formName: string;
  rawPayload: Record<string, unknown>;
  /** Answer key → the Lead field it fed. Absent key means the answer mapped to nothing. */
  mappedFields: Record<string, string>;
  submittedAt: string;
}

export type LeadSubmissionResponse = LeadSubmissionSummary;

export type LeadSubmissionListResponse = ListResponse<LeadSubmissionSummary>;

export const LEAD_ERROR_CODES = {
  leadNotFound: 'lead_not_found',
  /** The `partyId` a qualify request named does not resolve, through `PartyDirectory`. */
  leadPartyNotFound: 'lead_party_not_found',
  /** Qualifying a Lead that already holds a Party, or one that is currently disqualified. */
  leadNotQualifiable: 'lead_not_qualifiable',
  leadAlreadyDisqualified: 'lead_already_disqualified',
  leadNotDisqualified: 'lead_not_disqualified',
  /** A file id that names nothing on this lead — including a file on another company's lead. */
  leadAttachmentNotFound: 'lead_attachment_not_found',
  /** The attachment row exists but the store has no bytes under its key. */
  leadAttachmentBytesMissing: 'lead_attachment_bytes_missing',
} as const;

// ─── stages ─────────────────────────────────────────────────────────────────────────

/**
 * A new Stage. `order` is never sent — the server always appends a new Stage after every
 * existing one, so a client cannot collide with a position it cannot see yet. Moving it
 * anywhere else afterwards is what `UpdateStageRequest.order` is for.
 */
export interface CreateStageRequest {
  name: string;
  /** `'won' | 'lost'`. At most one Stage per company may hold each. Omitted means in-flight. */
  outcome?: SettableStageOutcome;
}

/**
 * A change to a Stage. Every field optional, at least one required — absent means "do not
 * touch it", the platform's ordinary rule.
 *
 * `order` is not the field's new *value* but its new *position*: sending `order: 1` moves this
 * Stage to the front of the board, and the server renumbers every other Stage in the company to
 * keep the column contiguous — exactly the way a drag on the board itself would, and why there
 * is no separate reorder endpoint. There is no way to clear a set `outcome` back to null through
 * this endpoint, only to change it — the same discipline `UpdateProductRequest.cost` follows.
 */
export interface UpdateStageRequest {
  name?: string;
  order?: number;
  outcome?: SettableStageOutcome;
}

export interface StageSummary {
  id: string;
  name: string;
  order: number;
  outcome: StageOutcome;
}

export type StageResponse = StageSummary;

export type StageListResponse = ListResponse<StageSummary>;

export const STAGE_ERROR_CODES = {
  stageNotFound: 'stage_not_found',
  /** A second `'won'` or a second `'lost'` Stage in one company. */
  duplicateStageOutcome: 'duplicate_stage_outcome',
  /** Deleting a Stage that still holds one or more Deals. */
  stageHasDeals: 'stage_has_deals',
} as const;

// ─── deals ──────────────────────────────────────────────────────────────────────────

/**
 * A new Deal, against a Party that already exists. `amount` takes either decimal text or the
 * `{ amount, currency }` wire shape — never a JSON number, which is a double and loses pennies
 * — and the currency it names must be `DEFAULT_CURRENCY`: this platform fixes currency per
 * ADR 0004 rather than choosing one per Deal.
 */
export interface CreateDealRequest {
  /** No FK on the wire either — resolved through `PartyDirectory` on the way in. */
  partyId: string;
  /** The Stage this Deal starts in — a Deal cannot exist without one. */
  stageId: string;
  name: string;
  amount: string | MoneyValue;
  /** `YYYY-MM-DD`. */
  expectedCloseDate?: string;
  /** A plain platform User id, resolved and displayed by the frontend. No FK, no lookup here. */
  assignedToUserId?: string;
  /** Optional and informational only — traces a win back to the Lead it came from. No FK. */
  originLeadId?: string;
}

/**
 * A change to a Deal. Every field optional, at least one required — absent means "do not
 * touch it".
 *
 * Sending `stageId` is how a Deal moves on the board, and landing on a Stage whose `outcome`
 * is `'won'` or `'lost'` is the entire close flow — there is no separate close endpoint, and no
 * `outcome` field here to set: the response's `stageOutcome` always reflects the Stage a Deal
 * currently sits in.
 */
export interface UpdateDealRequest {
  partyId?: string;
  stageId?: string;
  name?: string;
  amount?: string | MoneyValue;
  expectedCloseDate?: string;
  assignedToUserId?: string;
  originLeadId?: string;
}

export interface DealSummary {
  id: string;
  partyId: string;
  stageId: string;
  /** The Stage's own `outcome`, read at the moment of reading — never stored on a Deal itself. */
  stageOutcome: StageOutcome;
  name: string;
  amount: MoneyValue;
  expectedCloseDate: string | null;
  assignedToUserId: string | null;
  originLeadId: string | null;
}

export type DealResponse = DealSummary;

export type DealListResponse = ListResponse<DealSummary>;

/**
 * One party's deals, counted and totalled.
 *
 * Won and lost are the *Stage's* outcome rather than anything stored on a Deal, so a pipeline
 * renamed or re-marked is reflected the moment it is read — the same rule `DealSummary`
 * follows for `stageOutcome`.
 *
 * `openValue` is what is still in play; the two are kept apart because a board that added them
 * together would report a closed year and an open pipeline as one number.
 */
export interface PartyDealRollup {
  partyId: string;
  openCount: number;
  wonCount: number;
  lostCount: number;
  openValue: MoneyValue;
  wonValue: MoneyValue;
}

/**
 * A roll-up per party that has deals.
 *
 * A party with none is absent rather than present as zeroes: the caller asked about a page of
 * contacts and most of them have no deals, so the empty case is the common one and sending it
 * would be most of the response.
 *
 * Deliberately *not* a `ListResponse`, and named so as not to claim to be one. The platform's
 * list envelope carries a page — number, size, total — and this has no page to carry: the
 * caller already holds the set it asked about, the answer is keyed to that set, and there is
 * nothing to walk. Wrapping it in a page would invent a second, meaningless way to ask for the
 * same fixed answer. See docs/api-conventions.md, "One list shape", which this is outside of
 * rather than an exception to.
 */
export interface PartyDealRollupResponse {
  items: PartyDealRollup[];
}

export const DEAL_ERROR_CODES = {
  dealNotFound: 'deal_not_found',
  /** The `stageId` a request named does not resolve within this company. */
  dealStageNotFound: 'deal_stage_not_found',
  /** The `partyId` a request named does not resolve through `PartyDirectory`. */
  dealPartyNotFound: 'deal_party_not_found',
  /** A roll-up asked about more parties than `DEAL_ROLLUP_MAX_PARTIES`. */
  dealRollupTooManyParties: 'deal_rollup_too_many_parties',
} as const;

// ─── activities ──────────────────────────────────────────────────────────────────────

export const ACTIVITY_TYPES = ['call', 'email', 'meeting', 'note', 'task'] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_PATHS = {
  /**
   * `POST` logs one activity against a single parent. `GET` reads the company-wide feed —
   * every activity across every lead, deal and party, newest first — which is what the
   * Activities screen and the Workspace home render. Per-parent history stays on the three
   * `…Activities` paths below; this is the one that answers "what has the whole team been
   * doing", without a caller having to fan out over every record to assemble it.
   */
  activities: `/${CRM_ROUTE}/activities`,
  leadActivities: (id: string) => `/${CRM_ROUTE}/leads/${id}/activities`,
  dealActivities: (id: string) => `/${CRM_ROUTE}/deals/${id}/activities`,
  partyActivities: (id: string) => `/${CRM_ROUTE}/parties/${id}/activities`,
  completeTask: (id: string) => `/${CRM_ROUTE}/activities/${id}/complete`,
  reopenTask: (id: string) => `/${CRM_ROUTE}/activities/${id}/reopen`,
  /**
   * Push a task's due date out rather than finish it.
   *
   * The Next-step rail offers one action and one deferral, because a rail that can only say
   * "done" makes somebody lie to it to clear the prompt. Snoozing moves `dueAt`; it never
   * completes the task and never deletes it.
   */
  snoozeTask: (id: string) => `/${CRM_ROUTE}/activities/${id}/snooze`,
} as const;

/**
 * The wire format of a system **Audit event**, owned by both ends at once.
 *
 * The glossary keeps two things apart that share one table and one feed: an **Activity** is
 * person-authored, an **Audit event** is system-recorded. What actually tells them apart on the
 * wire is the leading emoji on `notes` — so the backend writes these strings and the frontend
 * reads them back, which makes the format a contract rather than a convention. It lives here
 * for the same reason every request shape does: two copies of a format is one copy that will be
 * wrong, and the failure is silent — a renamed prefix simply stops matching and the feed quietly
 * renders a status change as somebody's note.
 *
 * `describeAudit` is the parser paired with the builders. It exists so the feed can render an
 * email open as a card with its own count and caveat rather than as a line of raw text; when it
 * cannot recognise a note, it says so and the caller falls back to showing the text as written.
 */
export const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

export const SYSTEM_ACTOR_NAME = 'System';

export const auditNotes = {
  statusChanged: (from: string, to: string) => `⚙️ Status updated from "${from}" to "${to}"`,

  leadAssigned: () => '👤 Lead assigned to representative',

  fileAttached: (filename: string) => `📎 Attached file: ${filename}`,

  surveyReceived: (formName: string) => `📝 Survey response received: ${formName}`,

  /**
   * An email open, always as likelihood.
   *
   * "Probably seen" is not politeness. A tracking pixel is a fetched image: image-blocking hides
   * a real read and Apple Mail Privacy Protection's pre-fetch invents one that never happened,
   * so the only honest thing the feed can say is that it looks to have been opened. The count is
   * carried for the same reason — three fetches are weak evidence of three readings, but they
   * are something a salesperson can weigh, which a bare "opened" is not.
   */
  emailOpened: (subject: string, openCount: number) =>
    `📬 Email opened${openCount > 1 ? ` ${openCount} times` : ''} (probably seen): ${subject}`,
} as const;

/** The emoji a system Audit event's notes begin with. Tolerant of a trailing variation selector. */
export const SYSTEM_AUDIT_PREFIX = /^(⚙️|⚙|📎|👤|🚀|📥|📝|📬)/u;

export function isSystemAudit(notes: string): boolean {
  return SYSTEM_AUDIT_PREFIX.test(notes);
}

export type AuditEvent =
  | { kind: 'status-changed'; from: string; to: string }
  | { kind: 'lead-assigned' }
  | { kind: 'file-attached'; filename: string }
  | { kind: 'survey-received'; formName: string }
  | { kind: 'email-opened'; subject: string; openCount: number }
  /** Recognisably an audit event, but not one this version knows how to take apart. */
  | { kind: 'other'; text: string };

/** Takes an audit note back apart, or `undefined` if it was a person who wrote it. */
export function describeAudit(notes: string): AuditEvent | undefined {
  if (!isSystemAudit(notes)) return undefined;

  const status = /^(?:⚙️|⚙)\s*Status updated from "(.*)" to "(.*)"$/u.exec(notes);
  if (status) return { kind: 'status-changed', from: status[1]!, to: status[2]! };

  if (/^👤/u.test(notes)) return { kind: 'lead-assigned' };

  const file = /^📎\s*Attached file:\s*(.+)$/u.exec(notes);
  if (file) return { kind: 'file-attached', filename: file[1]! };

  const survey = /^📝\s*Survey response received:\s*(.+)$/u.exec(notes);
  if (survey) return { kind: 'survey-received', formName: survey[1]! };

  const opened = /^📬\s*Email opened(?:\s+(\d+)\s+times)?\s*\(probably seen\):\s*(.+)$/u.exec(notes);
  if (opened) {
    return {
      kind: 'email-opened',
      subject: opened[2]!,
      openCount: opened[1] ? Number(opened[1]) : 1,
    };
  }

  return { kind: 'other', text: notes.replace(SYSTEM_AUDIT_PREFIX, '').trim() };
}

/**
 * A sent email, taken back apart for the feed.
 *
 * Correspondence is person-authored, so it carries no audit emoji; what marks it is the shape
 * `LeadOutreachService` writes — a subject line, then the start of the body. Returns `undefined`
 * for an email activity somebody typed by hand, which is then shown as written.
 */
export function describeSentEmail(notes: string): { subject: string; preview: string } | undefined {
  const match = /^Email sent:\s*(.+?)(?:\n\n([\s\S]*))?$/u.exec(notes);
  if (!match) return undefined;
  return { subject: match[1]!.trim(), preview: (match[2] ?? '').trim() };
}

export const ACTIVITY_FIELDS = {
  type: 'type',
  occurredAt: 'occurredAt',
  dueAt: 'dueAt',
  completedAt: 'completedAt',
  createdByUserId: 'createdByUserId',
  createdByName: 'createdByName',
  createdAt: 'createdAt',
} as const;

/**
 * Log an Activity against exactly one parent — a Lead, a Deal, or a Party.
 *
 * Appending an Activity is an explicit historical record, so there is no general update or
 * delete endpoint. `dueAt` is meaningful only when `type === 'task'`.
 */
export interface CreateActivityRequest {
  type: ActivityType;
  notes: string;
  /** ISO date/timestamp. Defaults to server now if omitted. */
  occurredAt?: string;
  /** ISO date/timestamp. Meaningful only for `type === 'task'`. */
  dueAt?: string;
  /** Exactly one parent ID must be specified. */
  leadId?: string;
  dealId?: string;
  partyId?: string;
}

export interface ActivitySummary {
  id: string;
  type: ActivityType;
  notes: string;
  occurredAt: string;
  dueAt: string | null;
  completedAt: string | null;
  createdByUserId: string;
  createdByName: string;
  leadId: string | null;
  dealId: string | null;
  partyId: string | null;
  createdAt: string;
}

export type ActivityResponse = ActivitySummary;

export interface ActivityListResponse {
  items: ActivitySummary[];
}

/**
 * An activity as it appears in the **company-wide feed**, carrying the one thing a per-parent
 * list never needs: which record it hangs off, resolved to a name.
 *
 * A lead's own history is drawn beside the lead, so it never has to say whose it is. The
 * company feed mixes every lead, deal and party together, so each row has to name its parent
 * to be worth anything — and has to carry the parent's id so the row can link back to where
 * the work is done. The name is resolved once, server-side, against the parent's own table
 * rather than the wire being trusted to already hold it; `parentName` is `null` when the
 * parent has since been removed, which is the honest thing to show rather than a dangling id.
 *
 * Personal-versus-team is *not* a field here: it is read off `createdByUserId` against whoever
 * is asking, so the same feed serves everyone without the server having to know who "me" is.
 */
export interface ActivityFeedItem extends ActivitySummary {
  parentKind: 'lead' | 'deal' | 'party' | null;
  parentName: string | null;
}

/**
 * A page of the company feed. It is a `ListResponse` — the platform's one list envelope, with
 * its page number, size and total — because the feed grows without bound and a screen reads the
 * most recent page of it rather than the whole history. Newest first by default (`-occurredAt`).
 */
export type ActivityFeedResponse = ListResponse<ActivityFeedItem>;

export const ACTIVITY_ERROR_CODES = {
  activityNotFound: 'activity_not_found',
  /** Completion or reopening was attempted on an Activity whose `type !== 'task'`. */
  activityNotTask: 'activity_not_task',
  /** The request named 0 or >1 parent identifiers. Exactly one is required. */
  invalidActivityParent: 'invalid_activity_parent',
  /** The parent identifier specified could not be resolved within this company. */
  activityParentNotFound: 'activity_parent_not_found',
} as const;

// ─── workflow automation ────────────────────────────────────────────────────────────

export const WORKFLOW_TRIGGER_TYPES = ['deal.stage_changed', 'lead.status_changed'] as const;
export type WorkflowTriggerType = (typeof WORKFLOW_TRIGGER_TYPES)[number];

export const WORKFLOW_ACTION_TYPES = ['notify_user', 'update_field', 'create_task'] as const;
export type WorkflowActionType = (typeof WORKFLOW_ACTION_TYPES)[number];

export const WORKFLOW_RULE_PATHS = {
  rules: `/${CRM_ROUTE}/workflow-rules`,
  rule: (id: string) => `/${CRM_ROUTE}/workflow-rules/${id}`,
  notifications: `/${CRM_ROUTE}/notifications`,
} as const;

export const WORKFLOW_RULE_FIELDS = {
  name: 'name',
  triggerType: 'triggerType',
  actionType: 'actionType',
  enabled: 'enabled',
  createdAt: 'createdAt',
} as const;

export interface WorkflowTriggerConfig {
  toStageId?: string;
  toStatus?: string;
}

export interface WorkflowActionConfigNotifyUser {
  userId?: string;
}

export interface WorkflowActionConfigUpdateField {
  field: string;
  value: string;
}

export interface WorkflowActionConfigCreateTask {
  notes: string;
  dueInDays?: number;
}

export type WorkflowActionConfig =
  | WorkflowActionConfigNotifyUser
  | WorkflowActionConfigUpdateField
  | WorkflowActionConfigCreateTask;

export interface CreateWorkflowRuleRequest {
  name: string;
  triggerType: WorkflowTriggerType;
  triggerConfig?: WorkflowTriggerConfig | null;
  actionType: WorkflowActionType;
  actionConfig: Record<string, unknown>;
  enabled?: boolean;
}

export interface UpdateWorkflowRuleRequest {
  name?: string;
  triggerType?: WorkflowTriggerType;
  triggerConfig?: WorkflowTriggerConfig | null;
  actionType?: WorkflowActionType;
  actionConfig?: Record<string, unknown>;
  enabled?: boolean;
}

export interface WorkflowRuleSummary {
  id: string;
  name: string;
  triggerType: WorkflowTriggerType;
  triggerConfig: WorkflowTriggerConfig | null;
  actionType: WorkflowActionType;
  actionConfig: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type WorkflowRuleResponse = WorkflowRuleSummary;

export type WorkflowRuleListResponse = ListResponse<WorkflowRuleSummary>;

export interface NotificationSummary {
  id: string;
  userId: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export interface NotificationListResponse {
  items: NotificationSummary[];
}

export const WORKFLOW_RULE_ERROR_CODES = {
  ruleNotFound: 'rule_not_found',
  /** The update_field action attempted to target Deal.stageId or Lead.status. */
  invalidActionField: 'invalid_action_field',
} as const;

// ─── dashboards & events ─────────────────────────────────────────────────────────────

export const DASHBOARD_PATHS = {
  pipelineValue: `/${CRM_ROUTE}/dashboard/pipeline-value`,
  winLossRate: `/${CRM_ROUTE}/dashboard/win-loss-rate`,
  activityCounts: `/${CRM_ROUTE}/dashboard/activity-counts`,
  leadSourcePerformance: `/${CRM_ROUTE}/dashboard/lead-source-performance`,
} as const;

export interface PipelineValueStageSummary {
  stageId: string;
  stageName: string;
  order: number;
  outcome: StageOutcome;
  dealCount: number;
  totalValue: MoneyValue;
}

export interface PipelineValueResponse {
  stages: PipelineValueStageSummary[];
  totalInFlightValue: MoneyValue;
  totalInFlightDeals: number;
  totalWonValue: MoneyValue;
  totalWonDeals: number;
  totalLostValue: MoneyValue;
  totalLostDeals: number;
}

export interface WinLossRateQuery {
  fromDate?: string;
  toDate?: string;
}

export interface WinLossRateResponse {
  wonCount: number;
  lostCount: number;
  totalClosed: number;
  winRate: number;
}

export interface ActivityCountsQuery {
  fromDate?: string;
  toDate?: string;
}

export interface ActivityCountByType {
  type: ActivityType;
  count: number;
}

export interface ActivityCountByUser {
  userId: string;
  userName: string;
  count: number;
}

export interface ActivityCountsResponse {
  byType: ActivityCountByType[];
  byUser: ActivityCountByUser[];
  totalCount: number;
}

export const CRM_EVENTS = {
  leadQualified: 'crm.lead.qualified',
  leadDisqualified: 'crm.lead.disqualified',
  dealCreated: 'crm.deal.created',
  dealStageChanged: 'crm.deal.stage_changed',
  dealWon: 'crm.deal.won',
  dealLost: 'crm.deal.lost',
} as const;

export type CrmEventName = (typeof CRM_EVENTS)[keyof typeof CRM_EVENTS];

export interface LeadQualifiedEventPayload {
  leadId: string;
  partyId: string;
}

export interface LeadDisqualifiedEventPayload {
  leadId: string;
}

export interface DealCreatedEventPayload {
  dealId: string;
  partyId: string;
  stageId: string;
  amount: MoneyValue;
  name: string;
}

export interface DealStageChangedEventPayload {
  dealId: string;
  fromStageId: string;
  toStageId: string;
  outcome: StageOutcome;
}

export interface DealWonEventPayload {
  dealId: string;
  partyId: string;
  stageId: string;
  amount: MoneyValue;
}

export interface DealLostEventPayload {
  dealId: string;
  partyId: string;
  stageId: string;
  amount: MoneyValue;
}

export const LEAD_GROUP_PATHS = {
  leadGroups: `/${CRM_ROUTE}/lead-groups`,
  leadGroup: (id: string) => `/${CRM_ROUTE}/lead-groups/${id}`,
} as const;

export const LEAD_SOURCE_PATHS = {
  leadSources: `/${CRM_ROUTE}/lead-sources`,
  leadSource: (id: string) => `/${CRM_ROUTE}/lead-sources/${id}`,
} as const;

export const LEAD_STATUS_LABEL_PATHS = {
  labels: `/${CRM_ROUTE}/lead-status-labels`,
  label: (status: LeadStatusKey) => `/${CRM_ROUTE}/lead-status-labels/${status}`,
} as const;

export const LEAD_FIELD_PATHS = {
  leadFields: `/${CRM_ROUTE}/lead-fields`,
  leadField: (id: string) => `/${CRM_ROUTE}/lead-fields/${id}`,
  archive: (id: string) => `/${CRM_ROUTE}/lead-fields/${id}/archive`,
  restore: (id: string) => `/${CRM_ROUTE}/lead-fields/${id}/restore`,
} as const;

export const LEAD_IMPORT_PATHS = {
  dryRun: `/${CRM_ROUTE}/lead-imports/dry-run`,
  commit: `/${CRM_ROUTE}/lead-imports/commit`,
  imports: `/${CRM_ROUTE}/lead-imports`,
  import: (id: string) => `/${CRM_ROUTE}/lead-imports/${id}`,
} as const;

export const MAILBOX_PATHS = {
  mailboxes: `/${CRM_ROUTE}/mailboxes`,
  connections: `/${CRM_ROUTE}/mailboxes`,
  connectUrl: `/${CRM_ROUTE}/mailboxes/connect-url`,
  callback: `/${CRM_ROUTE}/mailboxes/callback`,
  revoke: (id: string) => `/${CRM_ROUTE}/mailboxes/${id}/revoke`,
  /**
   * Stops sending from a mailbox while keeping the row — the connection is still on the
   * screen, marked revoked, and reconnecting restores it.
   */
  disconnect: (id: string) => `/${CRM_ROUTE}/mailboxes/${id}/revoke`,
  /**
   * Deletes the connection outright. The other half of `disconnect`: one stops using a
   * mailbox, this one stops listing it. A screen offering "Remove" needs a verb that
   * actually removes, or the button does nothing the second time it is pressed.
   */
  remove: (id: string) => `/${CRM_ROUTE}/mailboxes/${id}`,
  /**
   * Adds a company mailbox by its SMTP details. No redirect and no consent screen — there is
   * no third party to ask, which is the whole difference from the OAuth providers.
   */
  connectSmtp: `/${CRM_ROUTE}/mailboxes/smtp`,
} as const;

export const LEAD_EMAIL_PATHS = {
  send: (id: string) => `/${CRM_ROUTE}/leads/${id}/send-email`,
  sendEmail: (id: string) => `/${CRM_ROUTE}/leads/${id}/send-email`,
  preview: `/${CRM_ROUTE}/email-templates/preview`,
  /**
   * The tracking pixel a sent 1:1 email carries, mirroring `CAMPAIGN_PATHS.publicOpenPixel`.
   * Public and unauthenticated by necessity — it is fetched by the recipient's mail client.
   */
  publicOpenPixel: (token: string) => `/api/public/lead-emails/open/${token}`,
} as const;

/**
 * What became of one 1:1 email after it left.
 *
 * An open is a **soft** signal, never proof: image-blocking hides a read, and Apple Mail
 * Privacy Protection's pre-fetch invents one. Anything rendering this must phrase it as
 * likelihood — "probably seen" — which is why the field is `openedAt` rather than `readAt`.
 */
export interface LeadEmailSendSummary {
  id: string;
  leadId: string;
  activityId: string | null;
  sentByUserId: string;
  subject: string;
  sentAt: string;
  openedAt: string | null;
  openCount: number;
}

export const EMAIL_TEMPLATE_PATHS = {
  templates: `/${CRM_ROUTE}/email-templates`,
  template: (id: string) => `/${CRM_ROUTE}/email-templates/${id}`,
  preview: (id: string) => `/${CRM_ROUTE}/email-templates/${id}/preview`,
} as const;

export const CAMPAIGN_PATHS = {
  campaigns: `/${CRM_ROUTE}/campaigns`,
  campaign: (id: string) => `/${CRM_ROUTE}/campaigns/${id}`,
  materialize: (id: string) => `/${CRM_ROUTE}/campaigns/${id}/materialize`,
  recipients: (id: string) => `/${CRM_ROUTE}/campaigns/${id}/recipients`,
  sendBatch: (id: string) => `/${CRM_ROUTE}/campaigns/${id}/send-batch`,
  publicOpenPixel: (token: string) => `/api/public/campaigns/open/${token}`,
  publicUnsubscribe: (token: string) => `/api/public/campaigns/unsubscribe/${token}`,
} as const;

export const CAPTURE_SOURCE_PATHS = {
  sources: `/${CRM_ROUTE}/capture-sources`,
  source: (id: string) => `/${CRM_ROUTE}/capture-sources/${id}`,
  publicSubmit: (slug: string) => `/api/public/capture/${slug}`,
  publicForm: (slug: string) => `/api/public/capture/${slug}`,
  rotateToken: (id: string) => `/${CRM_ROUTE}/capture-sources/${id}/rotate-token`,
} as const;

export interface LeadGroupSummary {
  id: string;
  name: string;
  color: string;
  order: number;
  leadCount: number;
}

export type LeadGroupListResponse = ListResponse<LeadGroupSummary>;
export type LeadGroupResponse = LeadGroupSummary;

export interface LeadSourceSummary {
  id: string;
  name: string;
  order: number;
  leadCount: number;
}

export type LeadSourceListResponse = ListResponse<LeadSourceSummary>;
export type LeadSourceResponse = LeadSourceSummary;

export interface LeadStatusLabelSummary {
  status: LeadStatusKey;
  label: string;
  color: string;
  /**
   * False for the four built-in lifecycle statuses, which can be renamed and recoloured but
   * never removed; true for a status this company added itself.
   */
  isCustom: boolean;
  /** Where the status sits in the picker. The four built-ins hold 0–3; custom statuses follow. */
  order: number;
  /**
   * Whether an ordinary edit may move a lead into this status. False for `qualified` and
   * `disqualified`, which are reached by qualifying or disqualifying and never by asking.
   */
  isSettable: boolean;
}

export type UpdateLeadStatusLabelRequest = Partial<Pick<LeadStatusLabelSummary, 'label' | 'color'>>;

/**
 * Adding a status of this company's own. The caller names and colours it; the key it is stored
 * under is derived from the label by the server, so no screen has to invent a wire value.
 */
export interface CreateLeadStatusLabelRequest {
  label: string;
  color: string;
}

export interface LeadStatusLabelListResponse {
  items: LeadStatusLabelSummary[];
}

export const LEAD_STATUS_LABEL_DEFAULTS: Record<LeadStatus, { label: string; color: string }> = {
  new: { label: 'New', color: '#579bfc' },
  contacted: { label: 'Contacted', color: '#9d5bf0' },
  qualified: { label: 'Qualified', color: '#00c875' },
  disqualified: { label: 'Disqualified', color: '#e2445c' },
};

export type LeadFieldType = 'text' | 'number' | 'date' | 'select' | 'boolean' | 'multiselect' | 'checkbox';

export const LEAD_FIELD_TYPES = ['text', 'number', 'date', 'select', 'boolean', 'multiselect', 'checkbox'] as const;

export interface CreateLeadFieldRequest {
  key?: string;
  label: string;
  type: LeadFieldType;
  required?: boolean;
  options?: string[];
}

export interface LeadFieldSummary {
  id: string;
  key: string;
  label: string;
  type: LeadFieldType;
  required: boolean;
  order: number;
  options: string[] | null;
  archivedAt: string | null;
}

export type LeadFieldListResponse = ListResponse<LeadFieldSummary>;
export type LeadFieldResponse = LeadFieldSummary;

export interface SendLeadEmailResponse {
  success: boolean;
  messageId?: string;
}

export const LEAD_SOURCE_FIELDS = {
  name: 'name',
  order: 'order',
  createdAt: 'createdAt',
} as const;

export const LEAD_FIELD_ERROR_CODES = {
  leadFieldNotFound: 'lead_field_not_found',
  duplicateKey: 'duplicate_key',
  keyReserved: 'key_reserved',
  invalidLeadFieldValue: 'invalid_lead_field_value',
} as const;

export const LEAD_GROUP_ERROR_CODES = {
  leadGroupNotFound: 'lead_group_not_found',
  leadGroupNotEmpty: 'lead_group_not_empty',
  leadGroupHasLeads: 'lead_group_has_leads',
} as const;

export const LEAD_STATUS_LABEL_ERROR_CODES = {
  leadStatusNotFound: 'lead_status_not_found',
  /** Tried to delete or rename away one of the four built-in lifecycle statuses. */
  leadStatusNotCustom: 'lead_status_not_custom',
  /** Tried to delete a custom status that leads are still sitting in. */
  leadStatusHasLeads: 'lead_status_has_leads',
  /** Two statuses would end up under the same derived key. */
  leadStatusDuplicate: 'lead_status_duplicate',
  /** Asked to move a lead into a status no ordinary edit may set. */
  leadStatusNotSettable: 'lead_status_not_settable',
} as const;

export const LEAD_SOURCE_ERROR_CODES = {
  leadSourceNotFound: 'lead_source_not_found',
  leadSourceNotEmpty: 'lead_source_not_empty',
  leadSourceHasLeads: 'lead_source_has_leads',
} as const;

export const CAPTURE_SOURCE_ERROR_CODES = {
  captureSourceNotFound: 'capture_source_not_found',
  sourceNotFound: 'source_not_found',
  invalidSlug: 'invalid_slug',
  invalidCaptureToken: 'invalid_capture_token',
  rateLimitExceeded: 'rate_limit_exceeded',
  unconfiguredField: 'unconfigured_field',
} as const;

export const MAILBOX_ERROR_CODES = {
  mailboxNotFound: 'mailbox_not_found',
  /**
   * The provider was reached and would not confirm whose mailbox this is. Nothing is
   * recorded when this happens — a connection row means a provider vouched for the account,
   * so a failure to establish that is the absence of a connection rather than a broken one.
   */
  connectionFailed: 'connection_failed',
  /** No credentials for this provider on this server, or no support for it yet. */
  providerUnavailable: 'mailbox_provider_unavailable',
  /**
   * A mailbox a campaign still sends from cannot be deleted — the campaign would be left
   * pointing at nothing. Disconnect it instead, or delete the campaign first.
   */
  mailboxInUse: 'mailbox_in_use',
  /**
   * The mail host rejected these details, or could not be reached. Raised while adding an
   * SMTP mailbox, because settings are proved by connecting with them rather than saved on
   * the assumption they are right and found wrong at the first send.
   */
  smtpSettingsRejected: 'smtp_settings_rejected',
  /** Sending failed at the provider. The message did not go out. */
  sendFailed: 'mailbox_send_failed',
  authStateNotFound: 'auth_state_not_found',
  mailboxNotConnected: 'mailbox_not_connected',
  invalidAuthState: 'invalid_auth_state',
} as const;

export const EMAIL_TEMPLATE_ERROR_CODES = {
  templateNotFound: 'template_not_found',
  invalidTemplateTags: 'invalid_template_tags',
} as const;

export const CAMPAIGN_ERROR_CODES = {
  campaignNotFound: 'campaign_not_found',
  campaignNotDraft: 'campaign_not_draft',
  campaignNotMaterialized: 'campaign_not_materialized',
  campaignAlreadySent: 'campaign_already_sent',
} as const;

export interface ConnectMailboxUrlResponse {
  url: string;
  state?: string;
  stateToken?: string;
}

/**
 * `connected` is what the service writes on a successful exchange — not `active`, which this
 * type claimed for a while and nothing ever stored.
 */
export type MailboxStatus = 'connected' | 'revoked';

export interface PublicUnsubscribeResponse {
  success: true;
}

export interface LeadImportRejectedRow {
  row: number;
  field: string;
  message: string;
}

export interface LeadImportDryRunResponse {
  accepted: number;
  rejected: LeadImportRejectedRow[];
}

export interface LeadImportCommitResponse {
  accepted: number;
  rejected: LeadImportRejectedRow[];
  importId: string;
}

export interface LeadImportSummary {
  id: string;
  filename: string;
  rowCount: number;
  acceptedCount: number;
  importedByUserId: string;
  importedByName: string;
  createdAt: string;
}

export type LeadImportListResponse = ListResponse<LeadImportSummary>;

export const LEAD_IMPORT_ERROR_CODES = {
  invalidFileType: 'invalid_file_type',
  fileTooLarge: 'file_too_large',
  missingFile: 'missing_file',
  importNotFound: 'import_not_found',
  invalidMapping: 'invalid_mapping',
} as const;

export type LeadFieldValue = string | number | boolean | null | string[];

/**
 * The kinds of mailbox somebody can send from.
 *
 * Two of them are OAuth providers, where the account is proved by consenting at the provider
 * and mail leaves through that provider's API. `smtp` is the other shape entirely: a host,
 * a username and a password, which is how company mail hosting (Namecheap Private Email,
 * Fastmail, a corporate Exchange) is reached. Sending routes on this value — see the mailbox
 * senders in the backend — so a person can hold a personal Gmail and a company address at
 * once and choose per send.
 */
export type MailboxProvider = 'gmail' | 'outlook' | 'smtp';

/** The SMTP details of a company mailbox. The password is never returned once stored. */
export interface ConnectSmtpMailboxRequest {
  /** e.g. `mail.privateemail.com` */
  host: string;
  /** 465 with `secure`, or 587 without. */
  port: number;
  secure: boolean;
  /** The address mail is sent from, and what the CRM shows as the sender. */
  emailAddress: string;
  displayName: string;
  /** Usually the same as `emailAddress`. Kept separate because some hosts differ. */
  username: string;
  password: string;
}

/**
 * What a mailbox's SMTP settings look like coming back out. No password, ever: it is stored
 * encrypted and there is no route that returns it, so a stolen response cannot send mail.
 */
export interface SmtpSettingsSummary {
  host: string;
  port: number;
  secure: boolean;
  username: string;
}

export interface MailboxConnectionSummary {
  id: string;
  userId?: string;
  provider: MailboxProvider;
  emailAddress: string;
  displayName: string;
  status?: string;
  connectedAt?: string;
  revokedAt?: string | null;
  createdAt: string;
  updatedAt?: string;
  /** Present only on an SMTP mailbox, so a screen can show where it sends through. */
  smtp?: SmtpSettingsSummary;
}

export interface CreateEmailTemplateRequest {
  name: string;
  subject: string;
  body: string;
}

export type PreviewTemplateResponse = EmailTemplatePreviewResponse;

export interface MailboxConnectionListResponse {
  items: MailboxConnectionSummary[];
  page?: {
    totalCount: number;
    pageSize: number;
    cursor: string | null;
    nextCursor: string | null;
  };
}

export interface EmailTemplateSummary {
  id: string;
  name: string;
  subject: string;
  body: string;
  createdByUserId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmailTemplateListResponse {
  items: EmailTemplateSummary[];
  page?: {
    totalCount: number;
    pageSize: number;
    cursor: string | null;
    nextCursor: string | null;
  };
}
export type EmailTemplateResponse = EmailTemplateSummary;

export interface CreateLeadGroupRequest {
  name: string;
  color?: string;
  order?: number;
}

export interface UpdateLeadGroupRequest {
  name?: string;
  color?: string;
  order?: number;
}

export interface CreateLeadSourceRequest {
  name: string;
  order?: number;
}

export interface UpdateLeadSourceRequest {
  name?: string;
  order?: number;
}

export interface UpdateLeadFieldRequest {
  label?: string;
  required?: boolean;
  order?: number;
  options?: string[];
}

export type CaptureSourceConfig = FormConfig;
export type CaptureSourceKind = 'webform' | 'form' | string;

export interface EmailTemplatePreviewResponse {
  subject: string;
  body?: string;
  htmlBody?: string;
  textBody?: string;
}

export type CampaignStatus = 'draft' | 'sending' | 'completed';
export type CampaignRecipientStatus = 'pending' | 'sent' | 'failed' | 'excluded' | 'unsubscribed';

export interface CreateCampaignRequest {
  name: string;
  mailboxConnectionId: string;
  templateId: string;
  segmentConfig?: Record<string, unknown>;
}

export interface CampaignSummary {
  id: string;
  name: string;
  status: CampaignStatus;
  mailboxConnectionId: string;
  templateId: string;
  totalLeadsCount: number;
  sentCount: number;
  excludedCount?: number;
  openedCount: number;
  openRate: number;
  segmentConfig?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type CampaignListResponse = ListResponse<CampaignSummary>;
export type CampaignResponse = CampaignSummary;

export interface CampaignRecipientSummary {
  id: string;
  campaignId?: string;
  leadId: string;
  leadName: string;
  emailAddress: string;
  status: CampaignRecipientStatus;
  excludeReason: string | null;
  sentAt: string | null;
  openedAt: string | null;
  openCount?: number;
  openToken?: string;
  unsubscribeToken?: string;
}

export interface CampaignRecipientListResponse {
  items: CampaignRecipientSummary[];
  page?: number;
  totalCount?: number;
}

export type CampaignSegmentConfig = Record<string, unknown>;

export type LeadSourcePerformanceRow = LeadSourcePerformanceSummary;

export interface WebhookConfig {
  url: string;
  secret?: string;
}

export interface CreateCaptureSourceRequest {
  name: string;
  kind?: CaptureSourceKind;
  type?: string;
  config?: FormConfig;
  defaultGroupId?: string;
  defaultSourceId?: string;
  defaultAssignedToUserId?: string;
}

export interface UpdateCaptureSourceRequest {
  name?: string;
  config?: FormConfig;
  defaultGroupId?: string;
  defaultSourceId?: string;
  defaultAssignedToUserId?: string;
  enabled?: boolean;
}

export interface UpdateEmailTemplateRequest {
  name?: string;
  subject?: string;
  body?: string;
}

export interface SendLeadEmailRequest {
  mailboxConnectionId: string;
  toEmail?: string;
  subject?: string;
  body?: string;
  htmlBody?: string;
  templateId?: string;
}

export interface SendLeadEmailResponse {
  success: boolean;
  messageId?: string;
  activityId?: string;
}

export interface SendCampaignBatchResponse {
  batchSent: number;
  remainingPending: number;
  status: CampaignStatus;
  campaignId?: string;
}

export interface FormConfigField {
  key: string;
  label: string;
  required: boolean;
  order?: number;
  type?: string;
  placeholder?: string;
  options?: string[];
  columnName?: string;
}

export interface FormSubmitBehavior {
  confirmationMessage?: string;
  redirectUrl?: string;
  kind?: 'message' | 'redirect';
  url?: string;
  text?: string;
}

export interface FormTemplate {
  id: string;
  name: string;
  description?: string;
  fields: FormConfigField[];
  createdAt?: string;
}

export interface FormConfig {
  title?: string;
  description?: string;
  fields?: FormConfigField[];
  submitBehavior?: FormSubmitBehavior;
  fieldMapping?: Record<string, string>;
}

export interface CaptureSourceSummary {
  id: string;
  type?: 'webform' | string;
  kind?: string;
  name: string;
  slug?: string;
  token?: string;
  enabled?: boolean;
  defaultGroupId?: string;
  defaultSourceId?: string;
  defaultAssignedToUserId?: string | null;
  submissionCount: number;
  lastSubmissionAt: string | null;
  config: FormConfig;
  createdAt: string;
  updatedAt?: string;
}

export type CaptureSourceListResponse = ListResponse<CaptureSourceSummary>;
export type CaptureSourceResponse = CaptureSourceSummary;

export interface PublicFormConfigResponse {
  name: string;
  slug: string;
  config: FormConfig;
  fields?: FormConfigField[];
  submitBehavior?: FormSubmitBehavior;
}

export interface CaptureSubmitResponse {
  success: true;
  submitBehavior: FormSubmitBehavior;
}

export interface LeadSourcePerformanceSummary {
  sourceId: string | null;
  sourceName: string;
  totalLeads?: number;
  qualifiedCount?: number;
  disqualifiedCount?: number;
  conversionRate?: number;
  producedCount?: number;
  convertedCount?: number;
}

export interface LeadSourcePerformanceResponse {
  items?: LeadSourcePerformanceSummary[];
  sources?: LeadSourcePerformanceSummary[];
  totalProduced?: number | LeadSourcePerformanceSummary;
  totalConverted?: number | LeadSourcePerformanceSummary;
}


