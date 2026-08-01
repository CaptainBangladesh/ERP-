import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  HRM_ERROR_CODES,
  HRM_PAY_GRANT,
  type CalculatePayRunRequest,
  type CreateEmployeeRequest,
  type EmployeeListResponse,
  type EmployeeResponse,
  type PayRunListResponse,
  type PayRunResponse,
  type UpdateEmployeeRequest,
} from '@erp/shared';
import { ApiException } from '../../http/api-exception';
import {
  companyApplied,
  InjectPrisma,
  Tenancy,
  type ScopedPrisma,
} from '../../platform/tenancy';
import { validateEmployee, validateEmployeeChange, validatePeriod } from './validation';

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
 */
@Injectable()
export class HrmService {
  constructor(
    @InjectPrisma() private readonly prisma: ScopedPrisma,
    private readonly tenancy: Tenancy,
  ) {}

  async addEmployee(
    body: Partial<CreateEmployeeRequest> | undefined,
  ): Promise<EmployeeResponse> {
    const input = validateEmployee(body);

    const employee = await this.prisma.employee.create({
      data: companyApplied<Prisma.EmployeeUncheckedCreateInput>({
        name: input.name,
        annualSalary: input.annualSalary,
        // Refused by the platform for a caller who could not then read the record back.
        ...(input.confidential ? { confidential: true } : {}),
      }),
    });

    return describeEmployee(employee);
  }

  /**
   * Everybody on the payroll — with or without their salaries, depending on the caller.
   *
   * Nothing here asks. The platform omits the restricted column for a caller who may not
   * read it, so the list works for staff who need to know who their colleagues are and not
   * what they earn, and the module does not have to hold two versions of one query.
   */
  async listEmployees(): Promise<EmployeeListResponse> {
    const employees = await this.prisma.employee.findMany({ orderBy: { name: 'asc' } });

    return { employees: employees.map(describeEmployee) };
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
    body: Partial<UpdateEmployeeRequest> | undefined,
  ): Promise<EmployeeResponse> {
    const change = validateEmployeeChange(body);

    const employee = await this.prisma.employee
      .update({ where: { id }, data: change })
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
    await this.prisma.employee
      .delete({ where: { id } })
      .catch((cause: unknown) => {
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
  async calculatePayRun(
    body: Partial<CalculatePayRunRequest> | undefined,
  ): Promise<PayRunResponse> {
    const period = validatePeriod(body);
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
              grossPay: grossPay(employee.annualSalary, days),
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

  async listPayRuns(): Promise<PayRunListResponse> {
    const payRuns = await this.prisma.payRun.findMany({
      orderBy: [{ periodStart: 'desc' }, { periodEnd: 'desc' }],
    });

    return { payRuns: payRuns.map(describePayRun) };
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
          grossPay: money(line.grossPay),
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
    annualSalary: money(employee.annualSalary),
  };
}

function describePayRun(payRun: {
  id: string;
  periodStart: Date;
  periodEnd: Date;
  calculatedAt: Date;
}): Omit<PayRunResponse, 'lines'> {
  return {
    id: payRun.id,
    periodStart: isoDay(payRun.periodStart),
    periodEnd: isoDay(payRun.periodEnd),
    calculatedAt: payRun.calculatedAt.toISOString(),
  };
}

/**
 * A money column on its way out, or `null` where the platform withheld it.
 *
 * The `null` branch is the one that matters and the type says it cannot happen: Prisma's
 * generated row type has the column, because as far as the schema is concerned it is
 * always there. When the caller lacks the grant it is genuinely absent from the object the
 * extension returns, and a module that trusted the type would put `undefined` on the wire.
 * That gap is the price of restricting a field at the client rather than in the database,
 * and it is written down here and in docs/tenancy.md rather than discovered.
 */
function money(value: Prisma.Decimal | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toFixed(2);
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
 * Decimal arithmetic throughout, never a JavaScript number — `48000.10 / 365 * 30` in
 * floating point is not the figure anybody agreed to pay. Rounded once, explicitly, at the
 * end, because rounding at each step compounds. The rule is the spec's and this is the first
 * module with money in it, so it is the first to keep it.
 */
function grossPay(annualSalary: Prisma.Decimal, days: number): Prisma.Decimal {
  return annualSalary.mul(days).div(DAYS_IN_YEAR).toDecimalPlaces(2);
}

/**
 * Fixed at 365, including in a leap year. Real payroll picks between several conventions
 * per employment contract; the stub picks one and says so, because its job is to exercise
 * the foundation's shape rather than to be correct about employment law.
 */
const DAYS_IN_YEAR = 365;

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
