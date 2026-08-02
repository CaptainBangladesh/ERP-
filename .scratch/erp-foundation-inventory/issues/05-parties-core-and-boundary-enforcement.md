# 05 — Parties (Core), and boundary enforcement

**What to build:** One address book for the whole system, and the wall between modules.

A party is any person or organisation the business deals with, and the same record can be a
customer, a supplier, and an employee contact at once — so Sales, Purchase, Inventory, HRM and
Marketing all read from one place rather than each keeping their own. I can create parties by hand,
give them contact details and addresses, mark which roles they hold, search and filter them, and
merge duplicates. This is the first screen where I put meaningful business data in.

Boundary enforcement lands here because this is the moment it becomes meaningful: three modules now
exist, and one of them is about to be consumed by all the others. A module may use another's
declared public surface and nothing else — reaching into internals, querying its tables, or using a
module it did not declare all fail the build. A conformance pack asserts the things every module
must get right, so adding a module means passing the pack rather than surviving a code review.

Rules written now, with real modules to test them against, are better rules than ones written
against imagined modules — but expect a short cleanup pass over the two modules that predate them.

**Blocked by:** 04 — API conventions, the shared data table, and exact numbers

**Status:** ready-for-agent

- [ ] Each module declares an explicit public surface; everything else is internal
- [ ] A cross-module import bypassing the public surface fails the build
- [ ] A module querying another module's tables fails the build
- [ ] Using a module not declared in the manifest fails the build
- [ ] Failure messages name both modules and state the permitted alternative
- [ ] Enforcement runs in CI, not only in editors
- [ ] The shared package is barred from containing domain concepts; only primitives are allowed
- [ ] A conformance pack asserts company scoping, permission checks, list shape, error shape, and
      absence of cross-module table access
- [ ] Existing modules are brought into compliance and pass the pack
- [ ] Deleting a business module leaves the application building and booting
- [ ] A deliberately violating change is proven to fail CI
- [ ] Parties is a Core module; I can create a party as a person or an organisation
- [ ] A party holds contact details and one or more addresses
- [ ] A party can hold several roles at once — customer, supplier, employee contact — added and
      removed without recreating the party
- [ ] An organisation can have people belonging to it
- [ ] I can search and filter parties by name, role and status
- [ ] I can deactivate a party rather than delete it, so history stays intelligible
- [ ] I can merge two parties that are the same real-world entity, keeping history intact
- [ ] The public contract lets other modules read a party without touching its tables
- [ ] Adding a role does not require changing the Parties module
- [ ] Backend tests cover creation, roles, search, deactivation, merging and isolation
- [ ] Frontend tests cover the list, the forms, role management and the empty state

## Comments

**2026-08-02 — two things ticket 04 left for the conformance pack.**

The pack is this ticket's, and ticket 04 produced the first two rules it should carry. Both
are conventions today, enforced by nothing.

- **Every list endpoint returns `ListResponse<T>` and accepts the platform's parameters.** A
  module declares a `ListSpec` and calls `listQuery`; one that hand-rolled a `?limit=` would
  compile and would break the shared table. `docs/api-conventions.md` describes the shape.
- **Every handler taking a body declares its validator.** `@Body(validated(Schema))` is
  per-parameter rather than a global pipe, because request shapes are interfaces in the shared
  contract and do not survive to runtime — so a handler that forgets it gets an unchecked
  body. It is the same bargain `@Public()` strikes, and it wants the same treatment: visible,
  and checked by something.

Ticket 04 also predates the boundary rules, so it is part of the cleanup pass this ticket
already owns. Two things to look at when the rules land: `platform/list` and
`platform/validation` are platform rather than module code and should be importable by any
module, and `@erp/shared/ui` is a second entry point on the shared package that the backend
must never import.
