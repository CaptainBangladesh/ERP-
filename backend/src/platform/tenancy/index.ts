/**
 * Tenant scoping. One company can never see another's data, because module code has no way
 * to write a query that would.
 *
 * What a *module* needs is the first group below and nothing else — the client to inject, the
 * decorator that injects it, its type, and the one helper that says the platform supplies the
 * company. Everything deciding *how* scoping happens is internal, which is what lets ADR
 * 0003's deferred row-level security be layered underneath without a module changing.
 *
 * The rest is the platform's own surface: `Tenancy` for the two places that legitimately act
 * before a company exists, and the error types, which are exported so tests can assert on
 * which refusal occurred rather than on a message.
 *
 * See docs/tenancy.md for how to add a company-owned or restricted table.
 */
export { companyApplied, type CompanyApplied } from './company-applied';
export { InjectPrisma, SCOPED_PRISMA } from './inject-prisma';
export { type ScopedPrisma } from './tenant-scope';

export { Tenancy, holdsGrant, type TenantContext } from './tenancy';
export { TenancyModule } from './tenancy.module';

export {
  CrossCompanyError,
  ImmutableRecordError,
  MissingCompanyContextError,
  RestrictedFieldError,
  RestrictedRecordError,
  TenancyError,
  TenantRootWriteError,
} from './tenancy-error';
