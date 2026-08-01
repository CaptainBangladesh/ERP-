# ADR 0003 — Tenant scoping by Prisma client extension, with RLS deferred

Status: accepted (ticket 03)

## Context

Every business row in this system belongs to a company, and the roadmap ends at forty-plus
modules including payroll. A single forgotten `where: { companyId }` returns another
company's data; in payroll that is salary data. The spec names this one of two "most
consequential" open defaults, and ticket 03 required it settled before any code was written.

Three candidates were on the table:

1. A **Prisma client extension** over **async local storage**. Company context is established
   once per request and injected into every query; the extension throws when it is missing.
2. **Postgres row-level security.** Policies in the database, company set per transaction.
3. **Both**, extension over RLS.

The deciding observation is that the expensive-to-reverse decision is not *which* mechanism,
but the rule that **module code never writes a company filter by hand**. Once that holds, the
mechanism is invisible above the foundation and RLS can be slid underneath later without
touching a single module. "Cheap now, expensive later" applies to the rule, not to RLS.

## Decision

**Option 1, plus a build check that closes its one hole.**

- `TenantContext` — a company id and a grant predicate — is established once per request by
  `TenancyMiddleware`, which opens an async local storage scope for the whole request, and
  filled by `TenancyGuard` the moment the session guard has resolved who the caller is.
- `PrismaService` is never injected by a module. Modules inject `ScopedPrisma`, a client
  extended with `tenantScope`, which for every model declared company-owned:
  - injects the company filter into `where` on every read, update and delete, so a read,
    update or delete by direct identifier cannot cross companies;
  - forces the acting company into `data` on every write, and refuses a write that names a
    different one;
  - **throws `MissingCompanyContextError`** when no context is established, rather than
    running unscoped.
- Every Prisma model is classified in one table, `company-owned.ts`. A model that is not
  company-owned is marked as such **with a reason**, and the application refuses to boot if
  the datamodel contains a model the table does not mention. Marking is not optional and
  cannot be arrived at by forgetting.
- The same table marks **restriction beyond company scope**, at both granularities. A
  restricted *field* is omitted from every result unless the context holds the named grant,
  and naming it — in `select`, in a filter (including one that reaches it across a relation),
  in `orderBy`, in `distinct`, in `groupBy`'s `by`, in an aggregate, or through an `include` —
  throws. A restricted *record* is filtered out entirely, exactly as the company is, so it is
  unreachable by its own identifier rather than merely absent from a list.
- The same table marks models **immutable**: update, upsert and delete are refused outright.
- `npm run check:tenancy` fails the build on `$queryRaw` / `$executeRaw` and their `Unsafe`
  variants anywhere outside `backend/test/harness/`. This is the extension's only bypass, and
  it is now a build failure rather than a rule to police.

### RLS is accepted in principle and deferred

Row-level security is the right backstop and is not rejected — it is scheduled. It is
revisited at **ticket 14, the foundation audit against the module roadmap**, and the trigger
that brings it forward is: **the first legitimate need for raw SQL against a company-owned
table.** At that point `check:tenancy` has to grant an exception, and the exception is the
signal that one auditable place is no longer one place.

Because module code never writes a filter, adding RLS then is a migration plus connection
plumbing. No module changes.

## Consequences

- Forgetting a company filter is not possible: there is no filter to forget. A query with no
  context throws with the model and operation named, in development, on the first attempt.
- Identity is the exception, and deliberately: it *establishes* the tenant, so it runs before
  one exists. Sign-in finds a user by email across all companies. That is written as
  `withoutCompanyScope('<reason>', …)` — loud, greppable, and requiring a sentence, in the
  same spirit as `@Public()`. There are two uses today, both in identity.
- The interim grant rule is that a company's owner holds every grant and nobody else holds
  any. Ticket 07 replaces `TenantContext.holdsGrant` with a real role lookup; nothing outside
  the tenancy platform changes when it does.
- Two costs we are choosing not to pay yet, both of which option 2 or 3 would incur today:
  every request would have to run inside a transaction for `SET LOCAL` to survive connection
  pooling — which interacts badly with ticket 12's row-level locks on `stock_levels` — and
  local setup would need a non-superuser application role separate from the migration role,
  whose failure mode when misconfigured is *empty result sets* rather than an error.
- Migrations are not covered. A migration script that moves rows between companies is not
  something the extension can see. This is a known gap and is part of what RLS closes.

## Alternatives considered

**Postgres RLS only.** Covers raw SQL and stray migrations, which is the guarantee a security
reviewer accepts. But a missing context under RLS yields an *empty result set*, not a throw —
so ticket 03's "fails loudly" criterion would need a second mechanism anyway, and we would
have built both while claiming to have built one.

**Both, now.** The strongest option and the one to end up at. Rejected for *this* ticket
because the plumbing cost is paid in full today against a system whose only sensitive table is
a stub, and because the layering is genuinely free later — which is exactly what the
never-filter-by-hand rule buys.
