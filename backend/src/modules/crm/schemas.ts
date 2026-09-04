import {
  ACTIVITY_FIELDS,
  ACTIVITY_TYPES,
  DEAL_FIELDS,
  Decimal,
  LEAD_FIELDS,
  LEAD_FIELD_TYPES,
  LEAD_QUALIFY_ACTIONS,
  LEAD_SOURCE_FIELDS,
  LEAD_SOURCES,
  MONEY_SCALE,
  STAGE_FIELDS,
  STAGE_OUTCOMES,
  WORKFLOW_ACTION_TYPES,
  WORKFLOW_RULE_FIELDS,
  WORKFLOW_TRIGGER_TYPES,
  type ActivityType,
  type LeadCustomValues,
  type LeadFieldType,
  type LeadQualifyAction,
  type SettableLeadStatusKey,
  type SettableStageOutcome,
  type WorkflowActionType,
  type WorkflowTriggerType,
} from '@erp/shared';
import type { ListSpec } from '../../platform/list';
import {
  accepted,
  clearable,
  day,
  email,
  flag,
  identifier,
  money,
  oneOf,
  optional,
  passthroughValidator,
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

const SOURCE_ID = identifier({
  missing: 'Say where this lead came from.',
  invalid: 'That is not a source.',
});

/**
 * A status an ordinary edit may set.
 *
 * Only the *shape* is checked here, not the value. Since a company can add stages of its own,
 * the list of acceptable statuses is a set of rows rather than a constant, and a validator that
 * runs before any query cannot read rows. `leads.service` asks `settableStatuses()` on every
 * write; this rule's job is to make sure what reaches that check is a status key at all.
 *
 * The two unsettable built-ins are refused here rather than there, because that refusal is
 * about the shipped lifecycle and is true for every company — no read can change the answer.
 */
const STATUS = rule<SettableLeadStatusKey>('Say what status this lead is in.', (value) => {
  const given = typeof value === 'string' ? value.trim() : '';
  if (given.length === 0) return refused('Say what status this lead is in.');

  if (given === 'qualified' || given === 'disqualified') {
    return refused(
      'Qualified and Disqualified are reached by qualifying or disqualifying the lead.',
    );
  }

  return STATUS_KEY.test(given) ? accepted(given) : refused('That is not a status.');
});

/** The form `LeadStatusLabel.status` takes — what `statusKeyFor` derives from a label. */
const STATUS_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const ASSIGNEE = identifier({
  missing: 'Choose a colleague to assign this to.',
  invalid: 'That is not a user.',
});

/**
 * The set of people a lead is assigned to, since a lead may now be worked by several at once.
 *
 * Each entry is validated by `ASSIGNEE`, so a malformed id is refused with the same wording a
 * single owner gets. Duplicates are dropped rather than refused — assigning the same person
 * twice is a no-op, matching `LeadAssignee`'s `@@unique([leadId, userId])` — and order is kept,
 * because the first survives as the primary `assignedToUserId`. An empty array is a real value:
 * it takes everyone off the lead, which is why the field is `optional` (absent leaves the set
 * unchanged) rather than required.
 */
const ASSIGNEES = rule<string[]>('Choose who to assign this to.', (value) => {
  if (!Array.isArray(value)) return refused('Assignees must be a list of people.');
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const entry of value) {
    const read = ASSIGNEE.read(entry);
    if (!read.ok) return read;
    if (!seen.has(read.value)) {
      seen.add(read.value);
      ids.push(read.value);
    }
  }
  return accepted(ids);
});

const PARTY_ID = identifier({
  missing: 'Choose a party.',
  invalid: 'That is not a party.',
});

const QUALIFY_ACTION = oneOf<LeadQualifyAction>(LEAD_QUALIFY_ACTIONS, {
  missing: 'Say how this lead is being qualified.',
  invalid: 'That is not a way to qualify a lead.',
});

const GROUP_ID = identifier({
  missing: 'Choose a lead group.',
  invalid: 'That is not a lead group.',
});

const LEAD_GROUP_NAME = {
  missing: 'Enter a group name.',
  maxLength: 100,
  tooLong: 'Use 100 characters or fewer.',
} as const;

const COLOR = {
  missing: 'Enter a color code.',
  maxLength: 30,
  tooLong: 'Use 30 characters or fewer.',
} as const;

/**
 * A new position on the board, 1 and up — read as "move here", never written as-is. Both
 * `LeadGroupsService.reorder` and `LeadSourcesService.reorder` renumber the whole company
 * around it, exactly as `StagesService` does, which is what lets this stay a plain positive
 * integer rather than one that has to avoid colliding with a position it cannot see.
 */
const POSITION: FieldRule<number> = rule('Enter a position.', (value) => {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return refused('Enter a whole number, such as 1.');
  }
  if (value < 1) return refused('A position is 1 or greater.');
  return accepted(value);
});

export const CreateLeadGroupBody = validator({
  name: text(LEAD_GROUP_NAME),
  color: optional(text(COLOR)),
});

export const UpdateLeadGroupBody = validator({
  name: optional(text(LEAD_GROUP_NAME)),
  color: optional(text(COLOR)),
  order: optional(POSITION),
}).and((values, report) => {
  const changed = Object.values(values).some((value) => value !== undefined);
  if (!changed) report('name', 'Change something — this request changes nothing.');
});

// ─── lead sources ───────────────────────────────────────────────────────────────────

const LEAD_SOURCE_NAME = {
  missing: 'Enter a source name.',
  maxLength: 100,
  tooLong: 'Use 100 characters or fewer.',
} as const;

export const CreateLeadSourceBody = validator({
  name: text(LEAD_SOURCE_NAME),
});

export const UpdateLeadSourceBody = validator({
  name: optional(text(LEAD_SOURCE_NAME)),
  order: optional(POSITION),
}).and((values, report) => {
  const changed = Object.values(values).some((value) => value !== undefined);
  if (!changed) report('name', 'Change something — this request changes nothing.');
});

export const LEAD_SOURCE_LIST: ListSpec = {
  defaultSort: LEAD_SOURCE_FIELDS.order,
  fields: {
    [LEAD_SOURCE_FIELDS.name]: { type: 'text', sortable: true, filterable: true, searchable: true },
    [LEAD_SOURCE_FIELDS.order]: { type: 'integer', sortable: true, filterable: true },
    [LEAD_SOURCE_FIELDS.createdAt]: { type: 'date', sortable: true, filterable: true },
  },
};

// ─── lead status labels ─────────────────────────────────────────────────────────────

const STATUS_LABEL = {
  missing: 'Enter a label.',
  maxLength: 60,
  tooLong: 'Use 60 characters or fewer.',
} as const;

/**
 * Adding a stage of this company's own. Both fields are required — a status with no colour
 * would render as one more grey pill in a picker whose whole job is being scannable.
 */
export const CreateLeadStatusLabelBody = validator({
  label: text(STATUS_LABEL),
  color: text(COLOR),
});

export const UpdateLeadStatusLabelBody = validator({
  label: optional(text(STATUS_LABEL)),
  color: optional(text(COLOR)),
}).and((values, report) => {
  const changed = Object.values(values).some((value) => value !== undefined);
  if (!changed) report('label', 'Change something — this request changes nothing.');
});

// ─── custom lead fields ─────────────────────────────────────────────────────────────

const LEAD_FIELD_LABEL = {
  missing: 'Enter a field name.',
  maxLength: 100,
  tooLong: 'Use 100 characters or fewer.',
} as const;

const LEAD_FIELD_TYPE = oneOf<LeadFieldType>(LEAD_FIELD_TYPES, {
  missing: 'Choose a field type.',
  invalid: 'That is not a field type.',
});

/**
 * The choices a `select` or `multiselect` offers. Refused empty, refused with a blank entry,
 * and refused with a repeat: each of the three would produce a dropdown a person cannot use.
 */
const LEAD_FIELD_OPTIONS: FieldRule<string[]> = rule('Enter the options this field offers.', (value) => {
  if (!Array.isArray(value)) return refused('Enter the options as a list.');
  if (value.length === 0) return refused('Enter at least one option.');
  if (value.length > 100) return refused('Use 100 options or fewer.');

  const options: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') return refused('Every option is a word or phrase.');
    const trimmed = entry.trim();
    if (trimmed.length === 0) return refused('An option cannot be blank.');
    if (trimmed.length > 100) return refused('Use 100 characters or fewer per option.');
    if (options.includes(trimmed)) return refused(`'${trimmed}' is listed twice.`);
    options.push(trimmed);
  }

  return accepted(options);
});

const REQUIRED_FLAG = flag({ missing: 'Say whether this field is required.' });

/**
 * `options` is checked against `type` here rather than in the service, because it is a claim
 * about the request alone: a checkbox carrying a list of choices is a malformed request, not a
 * conflict with anything stored.
 */
export const CreateLeadFieldBody = validator({
  label: text(LEAD_FIELD_LABEL),
  type: LEAD_FIELD_TYPE,
  options: optional(LEAD_FIELD_OPTIONS),
  required: optional(REQUIRED_FLAG),
}).and((values, report) => {
  const takesOptions = values.type === 'select' || values.type === 'multiselect';
  if (takesOptions && values.options === undefined) {
    report('options', `A ${values.type} field needs the options it offers.`);
  }
  if (!takesOptions && values.options !== undefined) {
    report('options', `A ${values.type} field does not offer options.`);
  }
});

/**
 * A change to a definition. No `type` — see `UpdateLeadFieldRequest`: values already captured
 * were validated against the old one, and there is no honest reading of a date as a checkbox.
 */
export const UpdateLeadFieldBody = validator({
  label: optional(text(LEAD_FIELD_LABEL)),
  options: optional(LEAD_FIELD_OPTIONS),
  required: optional(REQUIRED_FLAG),
  order: optional(POSITION),
}).and((values, report) => {
  const changed = Object.values(values).some((value) => value !== undefined);
  if (!changed) report('label', 'Change something — this request changes nothing.');
});

/**
 * Custom values as they arrive: an object whose keys are definition keys. Nothing beyond the
 * shape is decided here — which keys exist, and what each one accepts, is a question about this
 * company's `LeadFieldDefinition` rows, so `LeadFieldsService.validate` answers it against the
 * database. That is deliberately the *only* place it is answered, so the manual, import and
 * public-capture write paths cannot drift apart in strictness.
 */
const CUSTOM_VALUES: FieldRule<LeadCustomValues> = rule('Enter the custom field values.', (value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return refused('Enter the custom field values as an object.');
  }
  return accepted(value as LeadCustomValues);
});

const LEAD_SOURCE_TYPE = oneOf(LEAD_SOURCES, {
  missing: 'Choose a source.',
  invalid: 'That is not a source.',
});

export const CreateLeadBody = validator({
  name: text(LEAD_NAME),
  organisationName: optional(text(ORGANISATION_NAME)),
  email: optional(email(CONTACT_EMAIL)),
  phone: optional(text(PHONE)),
  source: optional(LEAD_SOURCE_TYPE),
  sourceId: optional(SOURCE_ID),
  assignedToUserId: optional(ASSIGNEE),
  assigneeUserIds: optional(ASSIGNEES),
  groupId: optional(GROUP_ID),
  customValues: optional(CUSTOM_VALUES),
});

/**
 * Everything a lead can be changed to. The nullable columns are `clearable` rather than
 * `optional`, because a lead edited in place has to be able to lose a value as well as gain
 * one — a phone number typed into the wrong row is corrected by emptying the cell.
 *
 * `name` and `status` stay `optional`: a lead with no name is not a lead, and every lead is
 * always in one status or another.
 */
export const UpdateLeadBody = validator({
  name: optional(text(LEAD_NAME)),
  organisationName: clearable(text(ORGANISATION_NAME)),
  email: clearable(email(CONTACT_EMAIL)),
  phone: clearable(text(PHONE)),
  sourceId: clearable(SOURCE_ID),
  status: optional(STATUS),
  assignedToUserId: clearable(ASSIGNEE),
  assigneeUserIds: optional(ASSIGNEES),
  groupId: clearable(GROUP_ID),
  customValues: optional(CUSTOM_VALUES),
}).and((values, report) => {
  const changed = Object.values(values).some((value) => value !== undefined);
  if (!changed) report('name', 'Change something — this request changes nothing.');
});

export const QualifyLeadBody = validator({
  action: QUALIFY_ACTION,
  partyId: PARTY_ID,
});

/**
 * Built-in columns only. `Lead.customValues` is one JSON column, and `ListSpec` declares its
 * fields statically, so a custom field has nothing to declare here — a stated consequence of
 * the JSON-value shape rather than an omission. See `Lead.customValues` in `schema.prisma`.
 */
export const LEAD_LIST: ListSpec = {
  defaultSort: LEAD_FIELDS.name,
  fields: {
    [LEAD_FIELDS.name]: { type: 'text', sortable: true, filterable: true, searchable: true },
    [LEAD_FIELDS.organisationName]: { type: 'text', filterable: true, searchable: true },
    [LEAD_FIELDS.email]: { type: 'text', filterable: true, searchable: true },
    [LEAD_FIELDS.sourceId]: { type: 'text', filterable: true },
    [LEAD_FIELDS.status]: { type: 'text', sortable: true, filterable: true },
    // "Owner = X" now means "X is one of the assignees", not "X is the primary". A lead shared
    // with somebody shows up in their filtered view too, which is the point of sharing it. The
    // `via` relation turns `?filter.assignedToUserId=X` into `assignees: { some: { userId: X } }`.
    [LEAD_FIELDS.assignedToUserId]: {
      type: 'text',
      filterable: true,
      via: { relation: 'assignees', field: 'userId' },
    },
    [LEAD_FIELDS.groupId]: { type: 'text', filterable: true },
    [LEAD_FIELDS.createdAt]: { type: 'date', sortable: true, filterable: true },
  },
};

/**
 * The company-wide activity feed's list contract. Default order is newest first — a feed reads
 * from the top — and the fields offered are the ones a screen might narrow by: kind, and who
 * logged it. The mine-versus-team split the screens draw is done client-side against the signed
 * in user, so it needs no server-side filter of its own.
 */
export const ACTIVITY_LIST: ListSpec = {
  defaultSort: `-${ACTIVITY_FIELDS.occurredAt}`,
  fields: {
    [ACTIVITY_FIELDS.occurredAt]: { type: 'date', sortable: true, filterable: true },
    [ACTIVITY_FIELDS.type]: { type: 'text', filterable: true },
    [ACTIVITY_FIELDS.createdByUserId]: { type: 'text', filterable: true },
    [ACTIVITY_FIELDS.createdAt]: { type: 'date', sortable: true, filterable: true },
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

export const UpdateActivityBody = validator({
  type: optional(ACTIVITY_TYPE),
  notes: optional(text(ACTIVITY_NOTES)),
  occurredAt: optional(ACTIVITY_OCCURRED_AT),
  dueAt: optional(clearable(ACTIVITY_DUE_AT)),
});

export const UpdateLeadSubmissionBody = validator({
  formName: optional(text({ missing: 'Enter a form name.', maxLength: 200, tooLong: 'Form name must be 200 characters or fewer.' })),
  rawPayload: rule('Enter submission answers', (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return refused('Submission answers must be an object.');
    }
    return accepted(value as Record<string, unknown>);
  }),
  mappedFields: optional(
    rule('Mapped fields', (value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return refused('Mapped fields must be an object.');
      }
      return accepted(value as Record<string, string>);
    }),
  ),
});

export const UpdateMerchantProfileBody = validator({
  submissionId: optional(identifier({ missing: 'Invalid submission ID', invalid: 'Invalid submission ID' })),
  formName: optional(text({ missing: 'Enter a form name.', maxLength: 200, tooLong: 'Form name must be 200 characters or fewer.' })),
  rawPayload: rule('Enter profile data', (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return refused('Profile data must be an object.');
    }
    return accepted(value as Record<string, unknown>);
  }),
  mappedFields: optional(
    rule('Mapped fields', (value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return refused('Mapped fields must be an object.');
      }
      return accepted(value as Record<string, string>);
    }),
  ),
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

export const LEAD_IMPORT_LIST: ListSpec = {
  defaultSort: 'createdAt',
  fields: {
    filename: { type: 'text', sortable: true, filterable: true, searchable: true },
    rowCount: { type: 'integer', sortable: true, filterable: true },
    acceptedCount: { type: 'integer', sortable: true, filterable: true },
    importedByName: { type: 'text', sortable: true, filterable: true, searchable: true },
    createdAt: { type: 'date', sortable: true, filterable: true },
  },
};

export const ImportLeadsBody = validator({
  mapping: optional(text({ missing: '', maxLength: 20000, tooLong: 'Mapping is too long.' })),
  groupId: optional(identifier({ missing: '', invalid: 'Invalid group ID.' })),
  sourceId: optional(identifier({ missing: '', invalid: 'Invalid source ID.' })),
});

// ─── capture sources ────────────────────────────────────────────────────────────────

const CAPTURE_SOURCE_NAME = {
  missing: 'Enter a name for this capture source.',
  maxLength: 100,
  tooLong: 'Use 100 characters or fewer.',
} as const;

export const CreateCaptureSourceBody = validator({
  kind: oneOf(['form', 'webhook'] as const, { missing: 'Choose form or webhook.', invalid: 'Invalid kind.' }),
  name: text(CAPTURE_SOURCE_NAME),
  config: rule('Enter config', (value) => (value && typeof value === 'object' ? accepted(value as Record<string, unknown>) : refused('Enter config object.'))),
  defaultSourceId: optional(identifier({ missing: '', invalid: 'Invalid source ID.' })),
  defaultGroupId: optional(identifier({ missing: '', invalid: 'Invalid group ID.' })),
  defaultAssignedToUserId: optional(identifier({ missing: '', invalid: 'Invalid user ID.' })),
});

export const UpdateCaptureSourceBody = validator({
  name: optional(text(CAPTURE_SOURCE_NAME)),
  enabled: optional(rule('Enabled flag', (v) => (typeof v === 'boolean' ? accepted(v) : refused('Must be boolean.')))),
  config: optional(rule('Enter config', (v) => (v && typeof v === 'object' ? accepted(v as Record<string, unknown>) : refused('Must be object.')))),
  defaultSourceId: optional(identifier({ missing: '', invalid: 'Invalid source ID.' })),
  defaultGroupId: optional(identifier({ missing: '', invalid: 'Invalid group ID.' })),
  defaultAssignedToUserId: optional(identifier({ missing: '', invalid: 'Invalid user ID.' })),
}).and((values, report) => {
  const changed = Object.values(values).some((v) => v !== undefined);
  if (!changed) report('name', 'Change something — this request changes nothing.');
});

export const CAPTURE_SOURCE_LIST: ListSpec = {
  defaultSort: 'name',
  fields: {
    name: { type: 'text', sortable: true, filterable: true, searchable: true },
    kind: { type: 'text', filterable: true },
    enabled: { type: 'boolean', filterable: true },
    createdAt: { type: 'date', sortable: true, filterable: true },
  },
};

/**
 * The one schema on this platform declared with `passthroughValidator` rather than
 * `validator` — a form or webhook payload is shaped by whoever configured the capture
 * source, not by this API, so there is no fixed field list to check it against here. What
 * comes through is checked downstream, in `CaptureSourcesService.submitCapture`: known keys
 * only for a 'form' source, mapped keys only for a 'webhook' source, and every value that
 * lands in `customValues` through `LeadFieldsService.validate` — the same gate every other
 * write path onto a Lead uses.
 */
export const SubmitCaptureBody = passthroughValidator({});

export const CreateConnectUrlBody = validator({
  provider: text({ missing: 'Enter provider.', maxLength: 20, tooLong: 'Provider too long.' }),
});

/**
 * A TCP port. Its own rule because nothing else in the system takes one, and the range is the
 * whole check worth making — a host will say soon enough whether it is listening there.
 */
function port(options: { missing: string; invalid: string }): FieldRule<number> {
  return rule(options.missing, (value) => {
    const given = typeof value === 'number' ? value : Number(String(value ?? '').trim());
    if (!Number.isInteger(given) || given < 1 || given > 65535) return refused(options.invalid);
    return accepted(given);
  });
}

/**
 * The SMTP details of a company mailbox.
 *
 * The password is checked only for being present. Length and composition rules belong to
 * whoever issued it — this is somebody else's credential, and refusing a valid one because it
 * is short would simply make the mailbox unaddable.
 */
export const ConnectSmtpMailboxBody = validator({
  host: text({ missing: 'Enter the mail server host.', maxLength: 255, tooLong: 'Host is too long.' }),
  port: port({ missing: 'Enter the port.', invalid: 'Enter a port between 1 and 65535.' }),
  secure: flag({ missing: 'Say whether the connection uses SSL.' }),
  emailAddress: email({
    missing: 'Enter the email address this mailbox sends from.',
    invalid: 'Enter a valid email address.',
  }),
  displayName: text({
    missing: 'Enter the name recipients will see.',
    maxLength: 100,
    tooLong: 'Name is too long.',
  }),
  username: text({ missing: 'Enter the username.', maxLength: 255, tooLong: 'Username is too long.' }),
  password: text({ missing: 'Enter the password.', maxLength: 500, tooLong: 'Password is too long.' }),
});

export const CreateEmailTemplateBody = validator({
  name: text({ missing: 'Enter template name.', maxLength: 100, tooLong: 'Name is too long.' }),
  subject: text({ missing: 'Enter email subject.', maxLength: 200, tooLong: 'Subject is too long.' }),
  body: text({ missing: 'Enter email HTML body.', maxLength: 50000, tooLong: 'Body is too long.' }),
});

export const UpdateEmailTemplateBody = validator({
  name: optional(text({ missing: '', maxLength: 100, tooLong: 'Name is too long.' })),
  subject: optional(text({ missing: '', maxLength: 200, tooLong: 'Subject is too long.' })),
  body: optional(text({ missing: '', maxLength: 50000, tooLong: 'Body is too long.' })),
}).and((values, report) => {
  const changed = Object.values(values).some((v) => v !== undefined);
  if (!changed) report('name', 'Change something — this request changes nothing.');
});

export const PreviewTemplateBody = validator({
  leadId: identifier({ missing: 'Enter lead ID.', invalid: 'Invalid lead ID.' }),
  mailboxConnectionId: optional(identifier({ missing: '', invalid: 'Invalid mailbox connection ID.' })),
});

export const SendLeadEmailBody = validator({
  mailboxConnectionId: identifier({ missing: 'Enter mailbox connection ID.', invalid: 'Invalid mailbox connection ID.' }),
  templateId: optional(identifier({ missing: '', invalid: 'Invalid template ID.' })),
  subject: optional(text({ missing: '', maxLength: 200, tooLong: 'Subject is too long.' })),
  htmlBody: optional(text({ missing: '', maxLength: 50000, tooLong: 'HTML body is too long.' })),
});

export const EMAIL_TEMPLATE_LIST: ListSpec = {
  defaultSort: 'name',
  fields: {
    name: { type: 'text', sortable: true, filterable: true, searchable: true },
    subject: { type: 'text', filterable: true, searchable: true },
    createdAt: { type: 'date', sortable: true, filterable: true },
  },
};

export const CreateCampaignBody = validator({
  name: text({ missing: 'Enter campaign name.', maxLength: 100, tooLong: 'Name is too long.' }),
  mailboxConnectionId: identifier({ missing: 'Select a connected mailbox.', invalid: 'Invalid mailbox connection ID.' }),
  templateId: identifier({ missing: 'Select an email template.', invalid: 'Invalid template ID.' }),
  segmentConfig: optional(rule('Segment config', (v) => (v && typeof v === 'object' ? accepted(v as Record<string, unknown>) : accepted({})))),
});

export const UpdateCampaignBody = validator({
  name: optional(text({ missing: '', maxLength: 100, tooLong: 'Name is too long.' })),
  mailboxConnectionId: optional(identifier({ missing: '', invalid: 'Invalid mailbox connection ID.' })),
  templateId: optional(identifier({ missing: '', invalid: 'Invalid template ID.' })),
  segmentConfig: optional(rule('Segment config', (v) => (v && typeof v === 'object' ? accepted(v as Record<string, unknown>) : accepted({})))),
}).and((values, report) => {
  const changed = Object.values(values).some((v) => v !== undefined);
  if (!changed) report('name', 'Change something — this request changes nothing.');
});

/**
 * How far to push a task out. Optional, and clamped rather than refused: the rail's Snooze is
 * one click with no field behind it, so an absent or silly number means "tomorrow" instead of
 * an error the button has nowhere to show.
 */
export const SnoozeTaskBody = validator({
  days: optional(
    rule('Days', (v) => (typeof v === 'number' && v > 0 && v <= 90 ? accepted(v) : accepted(1))),
  ),
});

export const SendCampaignBatchBody = validator({
  batchSize: optional(rule('Batch size', (v) => (typeof v === 'number' && v > 0 && v <= 100 ? accepted(v) : accepted(10)))),
});

export const CAMPAIGN_LIST: ListSpec = {
  defaultSort: 'createdAt',
  fields: {
    name: { type: 'text', sortable: true, filterable: true, searchable: true },
    status: { type: 'text', filterable: true },
    createdAt: { type: 'date', sortable: true, filterable: true },
  },
};








