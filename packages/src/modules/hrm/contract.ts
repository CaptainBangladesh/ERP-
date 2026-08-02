import type { ListResponse } from '../../http/list.js';
import type { MoneyValue } from '../../numeric/money.js';

/**
 * The hrm module's wire contract — the shape stub's paths, bodies, responses and refusals.
 *
 * The stub exists so the foundation is not built alone with inventory in front of it. Its
 * shape is payroll's: a calculation run over a period rather than a reaction to an event, a
 * sensitive personal field, and records that are written once and never edited.
 *
 * Money crosses the wire as a `MoneyValue` — a decimal *string* and the currency it is in.
 * A JSON number is an IEEE 754 double and cannot hold every value a `numeric` column can, so
 * serialising a salary as one would lose pennies somewhere between the database and the
 * screen; and an amount without its currency is a number whose meaning depends on who is
 * reading it. Ticket 04 made both rules the platform's rather than this module's.
 */

export const HRM_MODULE = 'hrm';

/** No leading slash — Nest composes controller prefixes. */
export const HRM_ROUTE = 'api/hrm';

export const HRM_PATHS = {
  employees: `/${HRM_ROUTE}/employees`,
  employee: (id: string) => `/${HRM_ROUTE}/employees/${id}`,
  payRuns: `/${HRM_ROUTE}/pay-runs`,
  payRun: (id: string) => `/${HRM_ROUTE}/pay-runs/${id}`,
} as const;

/**
 * The grant that reads pay.
 *
 * Restriction beyond company scope is enforced by the platform, which knows this string as
 * the grant on two columns; the module declares it as a permission in its manifest. The two
 * are checked against each other by the module contract test, so a rename cannot leave a
 * column restricted by a grant nobody can hold.
 */
export const HRM_PAY_GRANT = 'hrm:pay:read';

/**
 * The grant that sees a confidential employee at all — the *record* restriction, as against
 * the field one above. Without it such a record is filtered out of every query, so it is
 * unreachable by its own identifier rather than merely hidden from a list.
 */
export const HRM_CONFIDENTIAL_GRANT = 'hrm:employees:read-confidential';

/**
 * The fields a caller may sort, filter or search the employee list by.
 *
 * Named here rather than as string literals on either side, because the backend's list
 * declaration and the frontend's table columns have to agree on them: a rename should be a
 * type error in both workspaces rather than a list that quietly stops sorting.
 *
 * `annualSalary` is on the list *and* is restricted. That is deliberate, and it is the case
 * ticket 04 had to settle: it sorts for somebody holding `HRM_PAY_GRANT`, and answers 403
 * with `field_restricted` for anybody else. See ADR 0004.
 */
export const EMPLOYEE_FIELDS = {
  name: 'name',
  annualSalary: 'annualSalary',
  confidential: 'confidential',
  createdAt: 'createdAt',
} as const;

export const PAY_RUN_FIELDS = {
  periodStart: 'periodStart',
  periodEnd: 'periodEnd',
  calculatedAt: 'calculatedAt',
} as const;

export interface CreateEmployeeRequest {
  name: string;
  /** A `MoneyValue`, or bare decimal text in the company's own currency. */
  annualSalary: MoneyValue | string;
  /** Marks the whole record restricted. Requires `HRM_CONFIDENTIAL_GRANT` to set. */
  confidential?: boolean;
}

export interface EmployeeResponse {
  id: string;
  name: string;
  confidential: boolean;
  /**
   * `null` when the caller may not see pay. Not omitted from the object and not an error:
   * a list of colleagues is useful to somebody who may not see what they earn, and a client
   * that had to handle a missing key differently from a null would handle it wrong once.
   */
  annualSalary: MoneyValue | null;
}

/**
 * Employees are editable and pay runs are not, which is the contrast the stub is here to
 * draw. A person's name changes and their salary changes; what they were paid in March does
 * not, and the platform refuses the write rather than trusting this file to omit the route.
 */
export interface UpdateEmployeeRequest {
  name?: string;
  annualSalary?: MoneyValue | string;
  confidential?: boolean;
}

export interface CalculatePayRunRequest {
  /** `YYYY-MM-DD`, inclusive. */
  periodStart: string;
  /** `YYYY-MM-DD`, inclusive. */
  periodEnd: string;
}

export interface PayRunLineResponse {
  employeeId: string;
  employeeName: string;
  /** `null` when the caller may not see pay, as with `EmployeeResponse.annualSalary`. */
  grossPay: MoneyValue | null;
}

/** A pay run without its lines, which is what a list of them carries. */
export interface PayRunSummary {
  id: string;
  periodStart: string;
  periodEnd: string;
  calculatedAt: string;
}

export interface PayRunResponse extends PayRunSummary {
  lines: PayRunLineResponse[];
}

/**
 * Both lists are the one envelope, as every list endpoint in every module is. The named
 * aliases exist so a screen can say what it expects; there is no second shape behind them.
 */
export type EmployeeListResponse = ListResponse<EmployeeResponse>;

export type PayRunListResponse = ListResponse<PayRunSummary>;

export const HRM_ERROR_CODES = {
  /** Calculating a pay run reads salaries, so it is refused outright without the grant. */
  payRestricted: 'pay_restricted',
  payRunAlreadyCalculated: 'pay_run_already_calculated',
  payRunNotFound: 'pay_run_not_found',
  employeeNotFound: 'employee_not_found',
  /** An employee with pay history cannot be removed; the runs would stop reconciling. */
  employeeHasPayHistory: 'employee_has_pay_history',
} as const;
