import { Prisma } from '@prisma/client';
import type {
  CalculatePayRunRequest,
  CreateEmployeeRequest,
  UpdateEmployeeRequest,
} from '@erp/shared';
import { ValidationException } from '../../http/validation-exception';

/**
 * What the stub accepts.
 *
 * Hand-written, like identity's, and for the same reason: ticket 04 introduces the pipe
 * every module will share, and writing against the shape it will produce means only this
 * file goes when it arrives. Every field is checked before anything is refused, so a caller
 * is told everything that is wrong at once.
 */

/** A decimal string, and deliberately not a JSON number. See the wire contract. */
const DECIMAL = /^-?\d{1,12}(\.\d{1,2})?$/;

/** `YYYY-MM-DD`. Anything with a time in it is a period boundary somebody guessed at. */
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface ValidEmployee {
  name: string;
  annualSalary: Prisma.Decimal;
  confidential: boolean;
}

export function validateEmployee(
  body: Partial<CreateEmployeeRequest> | undefined,
): ValidEmployee {
  const input = body ?? {};
  const fields: Record<string, string> = {};

  const name = employeeName(input.name, fields);

  let annualSalary: Prisma.Decimal | undefined;
  // Absent is its own message here and no message at all on a change, which is the whole of
  // the difference between the two callers.
  if (input.annualSalary === undefined) fields.annualSalary = 'Enter an annual salary.';
  else annualSalary = salary(input.annualSalary, fields);

  if (name && annualSalary) {
    return { name, annualSalary, confidential: input.confidential === true };
  }

  throw new ValidationException(fields);
}

/**
 * A change to an employee. Every field optional, and at least one required — a PATCH that
 * changes nothing is a caller who thinks they changed something.
 */
export function validateEmployeeChange(
  body: Partial<UpdateEmployeeRequest> | undefined,
): Partial<ValidEmployee> {
  const input = body ?? {};
  const fields: Record<string, string> = {};
  const change: Partial<ValidEmployee> = {};

  if (input.name !== undefined) {
    const name = employeeName(input.name, fields);
    if (name) change.name = name;
  }

  if (input.annualSalary !== undefined) {
    const amount = salary(input.annualSalary, fields);
    if (amount) change.annualSalary = amount;
  }

  if (input.confidential !== undefined) change.confidential = input.confidential === true;

  if (Object.keys(fields).length === 0 && Object.keys(change).length === 0) {
    fields.name = 'Change something — this request changes nothing.';
  }

  if (Object.keys(fields).length > 0) throw new ValidationException(fields);

  return change;
}

/**
 * The two field rules, written once.
 *
 * Creating and changing an employee disagree about whether a field may be absent and agree
 * about everything else, so the rules live here and the two callers differ only in what they
 * do about absence. Two copies would eventually accept on `PATCH` what `POST` refuses.
 *
 * Each records its own message and returns nothing, which is what lets a caller collect every
 * problem before refusing any of them — a user fixing a form should be told everything at
 * once rather than one thing per attempt.
 */
function employeeName(value: unknown, fields: Record<string, string>): string | undefined {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) {
    fields.name = "Enter the employee's name.";
    return undefined;
  }
  return name;
}

function salary(
  value: unknown,
  fields: Record<string, string>,
): Prisma.Decimal | undefined {
  const raw = typeof value === 'string' ? value.trim() : '';

  if (!DECIMAL.test(raw)) {
    fields.annualSalary = 'Enter an amount, to at most two decimal places.';
    return undefined;
  }
  if (raw.startsWith('-')) {
    fields.annualSalary = 'A salary cannot be negative.';
    return undefined;
  }

  return new Prisma.Decimal(raw);
}

export interface ValidPeriod {
  periodStart: Date;
  periodEnd: Date;
}

export function validatePeriod(
  body: Partial<CalculatePayRunRequest> | undefined,
): ValidPeriod {
  const input = body ?? {};
  const fields: Record<string, string> = {};

  const start = day(input.periodStart);
  if (!start) fields.periodStart = 'Enter a start date, as YYYY-MM-DD.';

  const end = day(input.periodEnd);
  if (!end) fields.periodEnd = 'Enter an end date, as YYYY-MM-DD.';

  if (start && end && end < start) {
    fields.periodEnd = 'The period ends before it starts.';
  }

  // `start` and `end` are both present whenever `fields` is empty — each is the only thing
  // that fills its own entry — but that is an argument, not something the compiler can see.
  // Returning inside the narrowing branch is what makes it a fact instead.
  if (start && end && Object.keys(fields).length === 0) {
    return { periodStart: start, periodEnd: end };
  }

  throw new ValidationException(fields);
}

/**
 * A calendar day, read as UTC midnight.
 *
 * A period is a run of dates, not an instant, so anchoring it to UTC keeps the same pay run
 * the same length whether the server is in London or Lagos. `Date.parse` on a bare
 * `YYYY-MM-DD` is UTC by specification; the regex is what stops anything else reaching it.
 */
function day(value: unknown): Date | undefined {
  if (typeof value !== 'string' || !DATE.test(value)) return undefined;

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
