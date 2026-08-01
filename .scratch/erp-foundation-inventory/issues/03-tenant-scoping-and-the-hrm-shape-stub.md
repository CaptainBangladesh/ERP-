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

**Status:** ready-for-agent

## Open decision — settle this before writing code

The spec marks tenancy as one of the two *"most consequential"* proposed defaults, *"worth
deliberate confirmation before implementation begins, because both are cheap to choose now and
expensive to change once several modules exist."* It is still unconfirmed. Three candidates:

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

- [ ] Company context is derived from the session once per request and carried for its duration
- [ ] Every query against a company-owned table is scoped automatically, with no per-call filter
- [ ] A query against a company-owned table without company context throws immediately
- [ ] Writes record the acting company automatically; a caller cannot write into another company
- [ ] Reads, updates and deletes by direct identifier cannot cross companies
- [ ] Tables that are not company-owned are explicitly marked as such
- [ ] A field or record can be marked as restricted beyond company scope
- [ ] The HRM shape stub exists as a module, with a periodic calculation, a sensitive field, and a
      record that cannot be edited after creation
- [ ] The stub is registered purely through its manifest
- [ ] The stub's sensitive field is unreadable without the required access
- [ ] Backend tests create two companies and assert isolation for read, update and delete
- [ ] A test proves omitting company context raises rather than returning unscoped rows
- [ ] The mechanism is documented, including how to add a company-owned or restricted table
