import {
  Decimal,
  EMPLOYEE_FIELDS,
  MONEY_SCALE,
  PAY_RUN_FIELDS,
  sortParameter,
} from '@erp/shared';
import type { ListSpec } from '../../platform/list';
import { day, flag, money, optional, text, validator, withDefault } from '../../platform/validation';

/**
 * What the stub accepts, and what it lets a caller ask of its lists.
 *
 * Ticket 03 wrote these checks by hand against the shape ticket 04 would produce; this is
 * that replacement. The messages are unchanged, which is the point — the error shape was
 * settled before the mechanism, so nothing that consumes the API had to move when the
 * mechanism arrived.
 */

/**
 * The salary rules, written once.
 *
 * Creating and changing an employee disagree about whether the field may be absent and agree
 * about everything else, so the rule is declared here and the two schemas differ only in
 * whether it is wrapped in `optional`. Two copies would eventually accept on `PATCH` what
 * `POST` refuses.
 *
 * The maximum is the column's: `numeric(14, 2)` holds twelve digits before the point. A value
 * past it is refused with a message rather than accepted and then rejected by Postgres, which
 * would be a 500.
 */
const ANNUAL_SALARY = {
  missing: 'Enter an annual salary.',
  invalid: 'Enter an amount, to at most two decimal places.',
  scale: MONEY_SCALE,
  tooPrecise: 'Enter an amount, to at most two decimal places.',
  minimum: Decimal.ZERO,
  belowMinimum: 'A salary cannot be negative.',
  maximum: Decimal.parse('999999999999.99'),
  aboveMaximum: 'That salary is larger than this system can record.',
} as const;

const EMPLOYEE_NAME = { missing: "Enter the employee's name." } as const;

const CONFIDENTIAL = {
  missing: 'Mark this employee confidential, or leave it out.',
} as const;

export const CreateEmployeeBody = validator({
  name: text(EMPLOYEE_NAME),
  annualSalary: money(ANNUAL_SALARY),
  // Absent means "not confidential". Marking one is a deliberate act, and the platform
  // refuses it outright for a caller who could not then read the record back.
  confidential: withDefault(flag(CONFIDENTIAL), false),
});

/**
 * A change to an employee. Every field optional, and at least one required — a `PATCH` that
 * changes nothing is a caller who thinks they changed something.
 */
export const UpdateEmployeeBody = validator({
  name: optional(text(EMPLOYEE_NAME)),
  annualSalary: optional(money(ANNUAL_SALARY)),
  confidential: optional(flag(CONFIDENTIAL)),
}).and((values, report) => {
  const changed =
    values.name !== undefined ||
    values.annualSalary !== undefined ||
    values.confidential !== undefined;

  if (!changed) report('name', 'Change something — this request changes nothing.');
});

export const CalculatePayRunBody = validator({
  periodStart: day({
    missing: 'Enter a start date, as YYYY-MM-DD.',
    invalid: 'Enter a start date, as YYYY-MM-DD.',
  }),
  periodEnd: day({
    missing: 'Enter an end date, as YYYY-MM-DD.',
    invalid: 'Enter an end date, as YYYY-MM-DD.',
  }),
}).and((values, report) => {
  if (values.periodEnd < values.periodStart) {
    report('periodEnd', 'The period ends before it starts.');
  }
});

/**
 * What a caller may do to the employee list.
 *
 * `annualSalary` is offered for sorting and filtering *and* is restricted beyond company
 * scope, which is exactly the combination ticket 03 handed to ticket 04 as an open question.
 * Nothing here checks the grant: naming the column is refused by the tenancy extension, which
 * is the one place that knows it is restricted, and translated into a 403 at the boundary.
 * The same goes for `confidential`, which marks a whole record restricted. See ADR 0004.
 */
export const EMPLOYEE_LIST: ListSpec = {
  defaultSort: EMPLOYEE_FIELDS.name,
  fields: {
    [EMPLOYEE_FIELDS.name]: {
      type: 'text',
      sortable: true,
      filterable: true,
      searchable: true,
    },
    [EMPLOYEE_FIELDS.annualSalary]: { type: 'decimal', sortable: true, filterable: true },
    [EMPLOYEE_FIELDS.confidential]: { type: 'boolean', filterable: true },
    [EMPLOYEE_FIELDS.createdAt]: { type: 'date', sortable: true, filterable: true },
  },
};

/** Newest period first, because a payroll clerk is nearly always looking at the last one. */
export const PAY_RUN_LIST: ListSpec = {
  defaultSort: sortParameter(PAY_RUN_FIELDS.periodStart, true),
  fields: {
    [PAY_RUN_FIELDS.periodStart]: { type: 'date', sortable: true, filterable: true },
    [PAY_RUN_FIELDS.periodEnd]: { type: 'date', sortable: true, filterable: true },
    [PAY_RUN_FIELDS.calculatedAt]: { type: 'date', sortable: true, filterable: true },
  },
};
