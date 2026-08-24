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
} as const;

export const STAGE_PATHS = {
  stages: `/${CRM_ROUTE}/stages`,
  stage: (id: string) => `/${CRM_ROUTE}/stages/${id}`,
} as const;

export const DEAL_PATHS = {
  deals: `/${CRM_ROUTE}/deals`,
  deal: (id: string) => `/${CRM_ROUTE}/deals/${id}`,
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

export const DEAL_ERROR_CODES = {
  dealNotFound: 'deal_not_found',
  /** The `stageId` a request named does not resolve within this company. */
  dealStageNotFound: 'deal_stage_not_found',
  /** The `partyId` a request named does not resolve through `PartyDirectory`. */
  dealPartyNotFound: 'deal_party_not_found',
} as const;

// ─── activities ──────────────────────────────────────────────────────────────────────

export const ACTIVITY_TYPES = ['call', 'email', 'meeting', 'note', 'task'] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_PATHS = {
  activities: `/${CRM_ROUTE}/activities`,
  leadActivities: (id: string) => `/${CRM_ROUTE}/leads/${id}/activities`,
  dealActivities: (id: string) => `/${CRM_ROUTE}/deals/${id}/activities`,
  partyActivities: (id: string) => `/${CRM_ROUTE}/parties/${id}/activities`,
  completeTask: (id: string) => `/${CRM_ROUTE}/activities/${id}/complete`,
  reopenTask: (id: string) => `/${CRM_ROUTE}/activities/${id}/reopen`,
} as const;

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


