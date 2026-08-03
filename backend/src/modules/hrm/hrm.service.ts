import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  Decimal,
  HRM_ERROR_CODES,
  HRM_PAY_GRANT,
  MONEY_SCALE,
  Money,
  type EmployeeListResponse,
  type EmployeeResponse,
  type PayRunListResponse,
  type PayRunResponse,
  type PayRunSummary,
} from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import { exactly } from '../../prisma/columns';
import { listQuery } from '../../platform/list';
import {
  companyApplied,
  InjectPrisma,
  Tenancy,
  type ScopedPrisma,
} from '../../platform/tenancy';
import type { Valid } from '../../platform/validation';
import {
  CalculatePayRunBody,
  CreateEmployeeBody,
  EMPLOYEE_LIST,
  PAY_RUN_LIST,
  UpdateEmployeeBody,
} from './schemas';

/**
 * The shape stub, doing the three things it exists to do.
 *
 * Read it as a counter-example rather than as a feature. Inventory reacts to events and
 * derives a level from a ledger; this calculates over a period, holds a number most staff
 * may not see, and writes records nothing can subsequently edit. Every one of those is a
 * demand the foundation has to meet before forty modules make meeting it expensive.
 *
 * There is not a company filter anywhere in this file, and that is the point. Employees,
 * pay runs and pay run lines are all company-owned; the platform scopes every query below,
 * so a second company's rows are not reachable from here even by trying.
 *
 * Ticket 04 took three more things out of it. Validation is a schema, paging and sorting and
 * filtering are the platform's, and money is a type rather than a private helper — so what is
 * left here is payroll behaviour and nothing else.
 */
@Injectable()
export class HrmService {
  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly tenancy: Tenancy,
  ) {}

  async addEmployee(input: Valid<typeof CreateEmployeeBody>): Promise<EmployeeResponse> {
    const employee = await this.prisma.employee.create({
      data: companyApplied<Prisma.EmployeeUncheckedCreateInput>({
        name: input.name,
        annualSalary: input.annualSalary.amount.toString(),
        // Refused by the platform for a caller who could not then read the record back.
        ...(input.confidential ? { confidential: true } : {}),
      }),
    });

    return describeEmployee(employee);
  }

  /**
   * Everybody on the payroll — with or without their salaries, depending on the caller, and
   * a page at a time.
   *
   * Nothing here asks about access and nothing here pages. The platform omits the restricted
   * column for a caller who may not read it, so the list works for staff who need to know who
   * their colleagues are and not what they earn; and `listQuery` has already turned the
   * request's parameters into a checked slice, so this reads and returns the one envelope
   * every list endpoint in every module returns.
   *
   * The total is its own query rather than the length of the rows, because the rows are one
   * page of them. It carries the same filters and none of the paging.
   */
  async listEmployees(query: Record<string, unknown>): Promise<EmployeeListResponse> {
    const slice = listQuery(query, EMPLOYEE_LIST);

    const [employees, total] = await Promise.all([
      this.prisma.employee.findMany(slice.findMany<Prisma.EmployeeFindManyArgs>()),
      this.prisma.employee.count(slice.count<Prisma.EmployeeCountArgs>()),
    ]);

    return slice.respond(employees.map(describeEmployee), total);
  }

  /**
   * Changes a name or a salary.
   *
   * The identifier is the whole of what the caller supplies, and it is enough: the platform
   * ANDs the acting company into the filter, so an id belonging to another company matches
   * nothing and the answer is the same one a made-up id gets. There is no branch here that
   * checks whose employee this is, because there is no way to write one wrong.
   */
  async changeEmployee(
    id: string,
    input: Valid<typeof UpdateEmployeeBody>,
  ): Promise<EmployeeResponse> {
    const employee = await this.prisma.employee
      .update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.annualSalary !== undefined
            ? { annualSalary: input.annualSalary.amount.toString() }
            : {}),
          ...(input.confidential !== undefined ? { confidential: input.confidential } : {}),
        },
      })
      .catch(notFound);

    return describeEmployee(employee);
  }

  /**
   * Removes somebody who should never have been added.
   *
   * Refused once they appear in a pay run: the run is immutable and its lines name this
   * employee, so removing them would leave a permanent record pointing at nobody. That is
   * the database's `RESTRICT` rather than a check here, because a check here would be a
   * second opinion that could disagree with the first.
   */
  async removeEmployee(id: string): Promise<void> {
    await this.prisma.employee.delete({ where: { id } }).catch((cause: unknown) => {
      if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2003') {
        throw employeeHasPayHistory();
      }
      return notFound(cause);
    });
  }

  /**
   * The periodic calculation: gross pay for every employee over a range of dates.
   *
   * Refused outright without the pay grant, rather than computed over values the caller may
   * not see. This is the one place the stub asks about access instead of letting the
   * platform decide, and the reason is that the answer would otherwise be silently wrong —
   * a pay run of blank numbers is worse than a refusal. Ticket 07 makes it a permission on
   * the handler.
   */
  async calculatePayRun(period: Valid<typeof CalculatePayRunBody>): Promise<PayRunResponse> {
    if (!this.tenancy.holds(HRM_PAY_GRANT)) throw payRestricted();

    const employees = await this.prisma.employee.findMany({ orderBy: { name: 'asc' } });
    const days = daysInclusive(period.periodStart, period.periodEnd);

    const payRun = await this.prisma
      .$transaction(async (tx) => {
        const run = await tx.payRun.create({
          data: companyApplied<Prisma.PayRunUncheckedCreateInput>({
            periodStart: period.periodStart,
            periodEnd: period.periodEnd,
          }),
        });

        // Written as their own statement rather than nested inside the run's create: a
        // nested write is executed as part of its parent and is not seen by the tenancy
        // extension, so the company would never be applied to the lines.
        await tx.payRunLine.createMany({
          data: employees.map((employee) =>
            companyApplied<Prisma.PayRunLineUncheckedCreateInput>({
              payRunId: run.id,
              employeeId: employee.id,
              grossPay: grossPay(employee.annualSalary, days).amount.toString(),
            }),
          ),
        });

        return run;
      })
      .catch((cause: unknown) => {
        if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002') {
          throw payRunAlreadyCalculated();
        }
        throw cause;
      });

    return this.payRun(payRun.id);
  }

  async listPayRuns(query: Record<string, unknown>): Promise<PayRunListResponse> {
    const slice = listQuery(query, PAY_RUN_LIST);

    const [payRuns, total] = await Promise.all([
      this.prisma.payRun.findMany(slice.findMany<Prisma.PayRunFindManyArgs>()),
      this.prisma.payRun.count(slice.count<Prisma.PayRunCountArgs>()),
    ]);

    return slice.respond(payRuns.map(describePayRun), total);
  }

  /**
   * One pay run and its lines.
   *
   * The lines and their employees are read as separate queries rather than through an
   * `include`. A nested read is executed inside its parent's query, where the platform
   * cannot omit a restricted column from it — so reaching pay that way is refused, and the
   * honest way to get it is to ask for it directly. See docs/tenancy.md.
   */
  async payRun(id: string): Promise<PayRunResponse> {
    const payRun = await this.prisma.payRun.findFirst({ where: { id } });
    if (!payRun) throw payRunNotFound();

    const lines = await this.prisma.payRunLine.findMany({
      where: { payRunId: payRun.id },
    });
    const employees = await this.prisma.employee.findMany({ orderBy: { name: 'asc' } });
    const nameOf = new Map(employees.map((employee) => [employee.id, employee.name]));

    return {
      ...describePayRun(payRun),
      lines: lines
        .map((line) => ({
          employeeId: line.employeeId,
          employeeName: nameOf.get(line.employeeId) ?? 'Unknown',
          grossPay: Money.wire(exactly(line.grossPay)),
        }))
        .sort((a, b) => a.employeeName.localeCompare(b.employeeName)),
    };
  }
}

function describeEmployee(employee: {
  id: string;
  name: string;
  annualSalary: Prisma.Decimal;
  confidential: boolean;
}): EmployeeResponse {
  return {
    id: employee.id,
    name: employee.name,
    confidential: employee.confidential,
    annualSalary: Money.wire(exactly(employee.annualSalary)),
  };
}

function describePayRun(payRun: {
  id: string;
  periodStart: Date;
  periodEnd: Date;
  calculatedAt: Date;
}): PayRunSummary {
  return {
    id: payRun.id,
    periodStart: isoDay(payRun.periodStart),
    periodEnd: isoDay(payRun.periodEnd),
    calculatedAt: payRun.calculatedAt.toISOString(),
  };
}

/** A calendar day, without the midnight-UTC instant it is stored as. */
function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Both ends included: a period from the 1st to the 30th is thirty days of work. */
function daysInclusive(start: Date, end: Date): number {
  const day = 24 * 60 * 60 * 1000;
  return Math.round((end.getTime() - start.getTime()) / day) + 1;
}

/**
 * Gross pay for a period: the annual figure, apportioned by days.
 *
 * Exact arithmetic throughout, never a JavaScript number — `48000.10 / 365 * 30` in floating
 * point is not the figure anybody agreed to pay. The multiplication keeps every digit; the
 * division is the only step that cannot be exact, so it is the only step that rounds, and it
 * has to say how. Half-even because a payroll rounds thousands of these and half-up would
 * drift upward across all of them.
 */
function grossPay(annualSalary: Prisma.Decimal, days: number): Money {
  return Money.parse(annualSalary.toFixed())
    .times(Decimal.fromInteger(days))
    .dividedBy(DAYS_IN_YEAR, { scale: MONEY_SCALE, rounding: 'half-even' });
}

/**
 * Fixed at 365, including in a leap year. Real payroll picks between several conventions
 * per employment contract; the stub picks one and says so, because its job is to exercise
 * the foundation's shape rather than to be correct about employment law.
 */
const DAYS_IN_YEAR = Decimal.fromInteger(365);

/**
 * Prisma's "no row matched" for an update or a delete, as a 404.
 *
 * It is also the answer when the row exists in another company, and deliberately the same
 * answer: telling a caller that an id is real but not theirs would turn every endpoint into
 * a way of counting somebody else's records.
 */
function notFound(cause: unknown): never {
  if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2025') {
    throw employeeNotFound();
  }
  throw cause;
}

function employeeNotFound(): ApiException {
  return new ApiException(
    HRM_ERROR_CODES.employeeNotFound,
    'That employee does not exist.',
    HttpStatus.NOT_FOUND,
  );
}

function employeeHasPayHistory(): ApiException {
  return new ApiException(
    HRM_ERROR_CODES.employeeHasPayHistory,
    'That employee appears in a pay run and cannot be removed.',
    HttpStatus.CONFLICT,
  );
}

function payRestricted(): ApiException {
  return new ApiException(
    HRM_ERROR_CODES.payRestricted,
    'You do not have access to pay information.',
    HttpStatus.FORBIDDEN,
  );
}

function payRunAlreadyCalculated(): ApiException {
  return new ApiException(
    HRM_ERROR_CODES.payRunAlreadyCalculated,
    'A pay run already exists for that period. A pay run cannot be recalculated.',
    HttpStatus.CONFLICT,
  );
}

function payRunNotFound(): ApiException {
  return new ApiException(
    HRM_ERROR_CODES.payRunNotFound,
    'That pay run does not exist.',
    HttpStatus.NOT_FOUND,
  );
}
