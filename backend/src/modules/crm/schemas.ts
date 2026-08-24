import {
  ACTIVITY_TYPES,
  DEAL_FIELDS,
  Decimal,
  LEAD_FIELDS,
  LEAD_QUALIFY_ACTIONS,
  LEAD_SOURCES,
  MONEY_SCALE,
  SETTABLE_LEAD_STATUSES,
  STAGE_FIELDS,
  STAGE_OUTCOMES,
  WORKFLOW_ACTION_TYPES,
  WORKFLOW_RULE_FIELDS,
  WORKFLOW_TRIGGER_TYPES,
  type ActivityType,
  type LeadQualifyAction,
  type LeadSource,
  type SettableLeadStatus,
  type SettableStageOutcome,
  type WorkflowActionType,
  type WorkflowTriggerType,
} from '@erp/shared';
import type { ListSpec } from '../../platform/list';
import {
  accepted,
  day,
  email,
  identifier,
  money,
  oneOf,
  optional,
  refused,
  rule,
  text,
  validator,
  type FieldRule,
  type Parsed,
} from '../../platform/validation';

/**
 * What crm's Lead, Stage, and Deal endpoints accept, and what their lists let a caller ask.
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

export const QualifyLeadBody = validator({
  action: QUALIFY_ACTION,
  partyId: PARTY_ID,
});

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

// ─── stages ─────────────────────────────────────────────────────────────────────────

const STAGE_NAME = {
  missing: 'Enter a stage name.',
  maxLength: 100,
  tooLong: 'Use 100 characters or fewer.',
} as const;

/**
 * `'won' | 'lost'` only — never `null`. There is no way to clear a set outcome back to
 * in-flight through this endpoint, only to change one, matching `UpdateProductBody`'s own
 * `cost` for the same reason: offering erasure through an ordinary edit box would make an
 * accidental keystroke and a deliberate "this no longer means won" indistinguishable.
 */
const STAGE_OUTCOME = oneOf<SettableStageOutcome>(STAGE_OUTCOMES, {
  missing: 'Say whether this stage means won or lost.',
  invalid: 'That is not an outcome.',
});

/**
 * A Stage's new position on the board, 1 and up. The service reads this as "move here" and
 * renumbers every Stage in the company to match, rather than writing the number as-is — see
 * `StagesService.reorder` — which is what lets `order` stay a plain positive integer here
 * rather than something that has to already avoid colliding with a position it cannot see.
 */
const STAGE_POSITION: FieldRule<number> = rule('Enter a position.', (value) => {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return refused('Enter a whole number, such as 1.');
  }
  if (value < 1) return refused('A position is 1 or greater.');
  return accepted(value);
});

/**
 * A new Stage. No `order` — a Stage is always appended after every existing one, so a client
 * cannot collide with a position it cannot see yet. Moving it anywhere else afterwards is what
 * `UpdateStageBody.order` is for.
 */
export const CreateStageBody = validator({
  name: text(STAGE_NAME),
  outcome: optional(STAGE_OUTCOME),
});

/**
 * A change to a Stage. Every field optional, at least one required.
 *
 * `order` here is not the column's new value but the Stage's new *position* — see
 * `STAGE_POSITION` — which is what lets "reorder" and "rename" share one endpoint the way the
 * spec asks, with no separate move/reorder action.
 */
export const UpdateStageBody = validator({
  name: optional(text(STAGE_NAME)),
  order: optional(STAGE_POSITION),
  outcome: optional(STAGE_OUTCOME),
}).and((values, report) => {
  const changed = Object.values(values).some((value) => value !== undefined);
  if (!changed) report('name', 'Change something — this request changes nothing.');
});

export const STAGE_LIST: ListSpec = {
  defaultSort: STAGE_FIELDS.order,
  fields: {
    [STAGE_FIELDS.name]: { type: 'text', sortable: true, filterable: true, searchable: true },
    [STAGE_FIELDS.order]: { type: 'integer', sortable: true, filterable: true },
    [STAGE_FIELDS.outcome]: { type: 'text', filterable: true },
    [STAGE_FIELDS.createdAt]: { type: 'date', sortable: true, filterable: true },
  },
};

// ─── deals ──────────────────────────────────────────────────────────────────────────

const DEAL_NAME = {
  missing: 'Enter the deal name.',
  maxLength: 200,
  tooLong: 'Use 200 characters or fewer.',
} as const;

const DEAL_STAGE = identifier({
  missing: 'Choose a pipeline stage.',
  invalid: 'That is not a stage.',
});

/**
 * What this Deal is worth. The shared money rule, exactly as `products.schemas`' `COST` uses
 * it — decimal text or `{ amount, currency }`, never a JSON number, and never negative: a Deal
 * worth less than nothing is a data entry mistake in every case anybody has been able to name.
 */
const DEAL_AMOUNT = money({
  missing: 'Enter an amount.',
  invalid: 'Enter an amount, such as 1000.00.',
  scale: MONEY_SCALE,
  minimum: Decimal.ZERO,
  belowMinimum: 'An amount cannot be negative.',
});

const EXPECTED_CLOSE_DATE = day({
  missing: 'Enter an expected close date, as YYYY-MM-DD.',
  invalid: 'Enter an expected close date, as YYYY-MM-DD.',
});

/**
 * Informational only, and never checked against `leads` — see `Deal.originLeadId` in
 * `schema.prisma`. This still refuses a malformed value, because a value that cannot be a UUID
 * at all is a typo rather than a Lead somebody meant to name.
 */
const ORIGIN_LEAD = identifier({
  missing: 'Choose the lead this deal came from.',
  invalid: 'That is not a lead.',
});

export const CreateDealBody = validator({
  name: text(DEAL_NAME),
  partyId: PARTY_ID,
  stageId: DEAL_STAGE,
  amount: DEAL_AMOUNT,
  expectedCloseDate: optional(EXPECTED_CLOSE_DATE),
  assignedToUserId: optional(ASSIGNEE),
  originLeadId: optional(ORIGIN_LEAD),
});

/**
 * A change to a Deal. Every field optional, at least one required.
 *
 * Sending `stageId` is the whole of how a Deal moves — and closes, when the Stage it lands on
 * carries an outcome. There is no separate move or close endpoint.
 */
export const UpdateDealBody = validator({
  name: optional(text(DEAL_NAME)),
  partyId: optional(PARTY_ID),
  stageId: optional(DEAL_STAGE),
  amount: optional(DEAL_AMOUNT),
  expectedCloseDate: optional(EXPECTED_CLOSE_DATE),
  assignedToUserId: optional(ASSIGNEE),
  originLeadId: optional(ORIGIN_LEAD),
}).and((values, report) => {
  const changed = Object.values(values).some((value) => value !== undefined);
  if (!changed) report('name', 'Change something — this request changes nothing.');
});

export const DEAL_LIST: ListSpec = {
  defaultSort: DEAL_FIELDS.name,
  fields: {
    [DEAL_FIELDS.name]: { type: 'text', sortable: true, filterable: true, searchable: true },
    [DEAL_FIELDS.expectedCloseDate]: { type: 'date', sortable: true, filterable: true },
    [DEAL_FIELDS.stageId]: { type: 'text', filterable: true },
    [DEAL_FIELDS.partyId]: { type: 'text', filterable: true },
    [DEAL_FIELDS.assignedToUserId]: { type: 'text', filterable: true },
    [DEAL_FIELDS.createdAt]: { type: 'date', sortable: true, filterable: true },
  },
};

const ACTIVITY_TYPE = oneOf<ActivityType>(ACTIVITY_TYPES, {
  missing: 'Choose an activity type.',
  invalid: 'That is not a valid activity type.',
});

const ACTIVITY_OCCURRED_AT = day({
  missing: 'Enter an occurred date.',
  invalid: 'Enter a valid occurred date.',
});

const ACTIVITY_DUE_AT = day({
  missing: 'Enter a due date.',
  invalid: 'Enter a valid due date.',
});

const ACTIVITY_NOTES = {
  minLength: 1,
  missing: 'Enter notes or details for this activity.',
  tooShort: 'Notes cannot be blank.',
};

export const CreateActivityBody = validator({
  type: ACTIVITY_TYPE,
  notes: text(ACTIVITY_NOTES),
  occurredAt: optional(ACTIVITY_OCCURRED_AT),
  dueAt: optional(ACTIVITY_DUE_AT),
  leadId: optional(identifier({ missing: 'Choose a lead.', invalid: 'That is not a lead.' })),
  dealId: optional(identifier({ missing: 'Choose a deal.', invalid: 'That is not a deal.' })),
  partyId: optional(PARTY_ID),
}).and((values, report) => {
  const parentsCount = [values.leadId, values.dealId, values.partyId].filter(Boolean).length;
  if (parentsCount !== 1) {
    report('leadId', 'Specify exactly one parent: leadId, dealId, or partyId.');
  }
});

// ─── workflow automation ────────────────────────────────────────────────────────────

const RULE_NAME = {
  missing: 'Enter a rule name.',
  maxLength: 200,
  tooLong: 'Use 200 characters or fewer.',
} as const;

const TRIGGER_TYPE = oneOf<WorkflowTriggerType>(WORKFLOW_TRIGGER_TYPES, {
  missing: 'Choose a trigger type.',
  invalid: 'That is not a valid trigger type.',
});

const ACTION_TYPE = oneOf<WorkflowActionType>(WORKFLOW_ACTION_TYPES, {
  missing: 'Choose an action type.',
  invalid: 'That is not a valid action type.',
});

export const CreateWorkflowRuleBody = validator({
  name: text(RULE_NAME),
  triggerType: TRIGGER_TYPE,
  triggerConfig: optional(rule('Enter trigger config', (value) => accepted(value))),
  actionType: ACTION_TYPE,
  actionConfig: rule('Enter action config', (value) => {
    if (!value || typeof value !== 'object') {
      return refused('Enter action config.');
    }
    return accepted(value as Record<string, unknown>);
  }),
  enabled: optional(
    rule('Enabled flag', (value) => (typeof value === 'boolean' ? accepted(value) : refused('Must be boolean.'))),
  ),
}).and((values, report) => {
  if (values.actionType === 'update_field' || (values.actionConfig as any)?.field) {
    const config = values.actionConfig as { field?: string };
    if (config?.field === 'stageId' || config?.field === 'status') {
      report('actionConfig', 'update_field action cannot target stageId or status to prevent recursive loops.');
    }
  }
});

export const UpdateWorkflowRuleBody = validator({
  name: optional(text(RULE_NAME)),
  triggerType: optional(TRIGGER_TYPE),
  triggerConfig: optional(rule('Enter trigger config', (value) => accepted(value))),
  actionType: optional(ACTION_TYPE),
  actionConfig: optional(
    rule('Enter action config', (value) => {
      if (!value || typeof value !== 'object') {
        return refused('Enter action config.');
      }
      return accepted(value as Record<string, unknown>);
    }),
  ),
  enabled: optional(
    rule('Enabled flag', (value) => (typeof value === 'boolean' ? accepted(value) : refused('Must be boolean.'))),
  ),
}).and((values, report) => {
  const changed = Object.values(values).some((v) => v !== undefined);
  if (!changed) report('name', 'Change something — this request changes nothing.');
  if (values.actionType === 'update_field' || (values.actionConfig as any)?.field) {
    const config = values.actionConfig as { field?: string } | undefined;
    if (config?.field === 'stageId' || config?.field === 'status') {
      report('actionConfig', 'update_field action cannot target stageId or status to prevent recursive loops.');
    }
  }
});

export const WORKFLOW_RULE_LIST: ListSpec = {
  defaultSort: WORKFLOW_RULE_FIELDS.name,
  fields: {
    [WORKFLOW_RULE_FIELDS.name]: { type: 'text', sortable: true, filterable: true, searchable: true },
    [WORKFLOW_RULE_FIELDS.triggerType]: { type: 'text', filterable: true },
    [WORKFLOW_RULE_FIELDS.actionType]: { type: 'text', filterable: true },
    [WORKFLOW_RULE_FIELDS.enabled]: { type: 'boolean', filterable: true },
    [WORKFLOW_RULE_FIELDS.createdAt]: { type: 'date', sortable: true, filterable: true },
  },
};




