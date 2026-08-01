# 03 — Tenant scoping, and the HRM shape stub

**What to build:** A guarantee that one company can never see another's data, enforced by the system
rather than remembered by developers. Company context is established once per request from the
session and applied automatically to every query. A query attempted without company context fails
loudly instead of quietly returning everything.

Built alongside it: the **HRM shape stub**, the first of the two deliberately dissimilar modules
that keep the platform from hardening around inventory. It is small — a table or two — and shaped
like payroll: a periodic calculation over a date range rather than a reaction to an event, a
sensitive personal field, and a record that can never be edited once created.

The stub earns its place immediately. Its sensitive field forces tenant scoping to support data
that is company-scoped *and* further restricted — a case inventory never produces, and one that is
expensive to add to the mechanism after forty modules depend on it.

**Blocked by:** 02 — Identity and access, as the first manifest-driven module

**Status:** done

## Open decision — settled

**Option 1 chosen, with the hole closed by the build.** Prisma client extension over async
local storage, plus `npm run check:tenancy`, which fails the build on `$queryRaw` and its
siblings anywhere outside the test harness. Row-level security is accepted in principle and
deferred to ticket 14 — the foundation audit — with a named trigger: the first legitimate need
for raw SQL against a company-owned table.

The reasoning turns on the observation that the expensive-to-reverse decision is not which
mechanism, but the rule that module code never writes a company filter. Once that holds, RLS
layers underneath without a module changing. Recorded as
[ADR 0003](../../../docs/adr/0003-tenant-scoping-by-prisma-client-extension.md).

## The decision as it stood

The spec marks tenancy as one of the two *"most consequential"* proposed defaults, *"worth
deliberate confirmation before implementation begins, because both are cheap to choose now and
expensive to change once several modules exist."* Three candidates were on the table:

1. **Prisma client extension + async local storage** (the spec's proposed default). Company
   context is injected into every query and the extension throws when it is missing. Enforcement
   lives in one auditable place and no database roles are managed per request. Its hole is
   `$queryRaw`, which bypasses the extension entirely and so becomes a rule to police.
2. **Postgres row-level security.** Policies in the database, company set per transaction. Raw
   SQL and a mistaken migration script are covered too, which is the guarantee a security reviewer
   accepts. Costs more plumbing: a non-superuser role with `FORCE ROW LEVEL SECURITY`, and each
   request's queries inside a transaction so `SET LOCAL` survives connection pooling.
3. **Both, extension over RLS.** The extension fails loudly and early in development; RLS is the
   backstop nothing escapes. A leak then needs two independent failures. Roughly half a ticket
   more work, and the two mechanisms have to be kept in step.

Whichever is chosen, module code must never write a company filter by hand, so the choice stays
invisible above the foundation and option 2 can be layered under option 1 later without touching
any module. Record the outcome as an ADR under `docs/adr/`.

- [x] Company context is derived from the session once per request and carried for its duration
- [x] Every query against a company-owned table is scoped automatically, with no per-call filter
- [x] A query against a company-owned table without company context throws immediately
- [x] Writes record the acting company automatically; a caller cannot write into another company
- [x] Reads, updates and deletes by direct identifier cannot cross companies
- [x] Tables that are not company-owned are explicitly marked as such
- [x] A field or record can be marked as restricted beyond company scope
- [x] The HRM shape stub exists as a module, with a periodic calculation, a sensitive field, and a
      record that cannot be edited after creation
- [x] The stub is registered purely through its manifest
- [x] The stub's sensitive field is unreadable without the required access
- [x] Backend tests create two companies and assert isolation for read, update and delete
- [x] A test proves omitting company context raises rather than returning unscoped rows
- [x] The mechanism is documented, including how to add a company-owned or restricted table

## Comments

**2026-08-01 — what the stub does not have, and why.**

No screens, and no navigation entry. Ticket 03's criteria are the mechanism and the module
shape, and a menu entry would point at a route the frontend does not serve. The manifest
declares `navigation: []`; it is the only file that changes when HRM becomes a real module.

Employees are editable and pay runs are not, which is a contrast worth keeping. `PATCH` and
`DELETE` on employees exist so that "isolation for read, update and delete" is assertable
through the real HTTP seam rather than below it — the immutable half of the stub has no such
routes by design, and the platform refuses those writes regardless of whether anybody adds one.

**2026-08-01 — restriction governs reading, not writing. Owed by ticket 07.**

A restricted field is omitted from results and refused when named explicitly, both for
callers without the grant. Nothing checks the grant on the way *in*: today a colleague could
`PATCH` an employee's salary they cannot read back. That is authorization rather than
tenancy, ticket 07 owns it, and the interim grant rule it replaces — owner holds everything,
nobody else holds anything — lives in one line of `TenancyGuard`.

**2026-08-01 — "a field *or record*" is both, and the stub uses both.**

`Employee.annualSalary` is the restricted field; `Employee.confidential` marks a restricted
record. They are genuinely different guarantees — the first hides one column of every row, the
second hides every column of one row — and the second is enforced the way the company filter
is, ANDed into `where`, so a confidential employee is unreachable by their own identifier
rather than merely missing from a list.

The record half arrived after review found only the field half built, which is also why hrm
owns two migrations rather than one.

**2026-08-01 — migrations are outside the mechanism.**

The extension sees queries through model delegates. A migration script that moved rows
between companies would not be one. This is a known gap, it is part of what row-level
security closes, and it is recorded in ADR 0003 rather than left to be discovered.
