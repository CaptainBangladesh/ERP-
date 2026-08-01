import { COMPANY_COLUMN } from './company-owned';

/** Data for a company-owned row, with the company left out. */
export type CompanyApplied<T> = Omit<T, typeof COMPANY_COLUMN>;

/**
 * Writes a company-owned row without naming the company.
 *
 * Prisma's generated input type insists on `companyId`, because as far as the schema is
 * concerned it is a required column. It is required — but it is the platform that supplies
 * it, on every write, from the session. This says so, in the one place a module would
 * otherwise be tempted to write the company out by hand:
 *
 *     await this.prisma.employee.create({
 *       data: companyApplied<Prisma.EmployeeUncheckedCreateInput>({ name, annualSalary }),
 *     });
 *
 * It is a type-level statement and does nothing at runtime — the extension has already done
 * the work. Naming the input type keeps every *other* field checked, which a bare cast on
 * the object would have thrown away along with the one that needed it.
 */
export function companyApplied<T extends Record<string, unknown>>(
  data: CompanyApplied<T>,
): T {
  return data as T;
}
