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

**Status:** done

- [x] Each module declares an explicit public surface; everything else is internal
- [x] A cross-module import bypassing the public surface fails the build
- [x] A module querying another module's tables fails the build
- [x] Using a module not declared in the manifest fails the build
- [x] Failure messages name both modules and state the permitted alternative
- [x] Enforcement runs in CI, not only in editors
- [x] The shared package is barred from containing domain concepts; only primitives are allowed
- [x] A conformance pack asserts company scoping, permission checks, list shape, error shape, and
      absence of cross-module table access
- [x] Existing modules are brought into compliance and pass the pack
- [x] Deleting a business module leaves the application building and booting
- [x] A deliberately violating change is proven to fail CI
- [x] Parties is a Core module; I can create a party as a person or an organisation
- [x] A party holds contact details and one or more addresses
- [x] A party can hold several roles at once — customer, supplier, employee contact — added and
      removed without recreating the party
- [x] An organisation can have people belonging to it
- [x] I can search and filter parties by name, role and status
- [x] I can deactivate a party rather than delete it, so history stays intelligible
- [x] I can merge two parties that are the same real-world entity, keeping history intact
- [x] The public contract lets other modules read a party without touching its tables
- [x] Adding a role does not require changing the Parties module
- [x] Backend tests cover creation, roles, search, deactivation, merging and isolation
- [x] Frontend tests cover the list, the forms, role management and the empty state

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

**2026-08-03 — built. The decisions worth knowing, and what moved for ticket 06.**

*The public surface is `backend/src/modules/<name>/index.ts`.* Required of every module; a
module with nothing to offer writes `export {}` and a sentence, which is a real answer rather
than an omission. Identity and hrm both give it — identity because what other modules need
from it arrives through the platform's `SessionAuthority` seam, hrm because the only read
another module would want is better served by an event it has nobody to declare yet.

*The rules are static text checks, not a lint plugin.* `npm run check:conformance`, in CI
beside `check:modules` and `check:tenancy`. ADR 0005 records why, and what would move us to
TypeScript project references instead. The trade is honest and written down: a deliberately
aliased delegate defeats the table rule. It refuses ordinary mistakes at build time, which is
what the convention was previously not doing at all.

*The manifest gained `models`.* "A module may not query another module's tables" has no
meaning until every table has one owner, so `check:modules` now refuses a model in
`schema.prisma` that no manifest claims — the same bargain `company-owned.ts` strikes with
tenancy.

*A role is an open slug and there is no table of them.* That is the whole of "adding a role
does not require changing the Parties module": nothing anywhere lists the permitted roles, so
Sales introducing `prospect` is a `POST`. `GET /api/parties/roles` answers with the roles in
use, derived from the data, which is what the filter control offers — so the screens extend by
the same act that extends the data. `SUGGESTED_PARTY_ROLES` in the contract is a suggestion
list for a fresh company and nothing checks against it.

*Merging keeps both rows.* The duplicate becomes `status: 'merged'` pointing at the survivor,
and `PartyDirectory.party(id)` follows the pointer — so an order placed against the duplicate
still resolves, and the module holding it never learns a merge happened. Chains are flattened
as they are made, so following one is always a single hop. Kinds must match: a person and an
organisation are an employee and their employer, which is what `organisationId` is for.

*`ListSpec` gained `via`.* Filtering by role is filtering on a related table, and the platform
builds the `some` clause from a declaration rather than the module writing a join. Filtering
only — a party holds three roles and a list has one order, so sorting is refused with a message
naming what it *can* sort by. `docs/api-conventions.md` describes it; ticket 08 will want it
for stock by location.

*Both of ticket 04's handovers are now rules*, and the cleanup pass it flagged is done:
`platform/list` and `platform/validation` are importable by any module through their entry
points, and `@erp/shared/ui` is refused to the backend by name.

**Left for later, deliberately.**

- **`parties.party.merged` is not emitted.** Nothing consumes it and `PartyDirectory` already
  follows merges, so nothing is broken by its absence. The first module that holds a party id
  and needs to *react* rather than resolve is the one that should declare it.
- **Permissions are `parties:parties:read` and `:write`, and nothing checks them yet.**
  Ticket 07 applies them. Merging and deactivating are writes rather than powers of their own;
  splitting them is ticket 07's call to make against a real role, not ours to invent now.
- **`src/http` and `src/prisma` are flat and importable by file.** They have no barrel to
  reach past. When either grows an `index.ts`, add it to `BACKEND_SUPPORT` in
  `platform/conformance/boundaries.ts` so the entry-point rule covers it.

**2026-08-03 — what the pack does *not* assert, and one rule that had to be weakened.**

Two things a reader of the criteria should not assume.

- **"The pack asserts permission checks" is the weakest of the five.** What it actually
  checks is that a grant restricting one of a module's tables is declared as a permission by
  that module — the drift that would otherwise leave a column readable by nobody. It does
  *not* check that a handler is guarded, because nothing guards handlers yet: `TenancyGuard`
  derives grants from ownership and ticket 07 is where permissions become enforceable. The
  rule to add then is "every non-`@Public()` handler in a module declares a permission", and
  it belongs in `platform/conformance/module-rules.ts` beside `validatedBodies`, which is the
  same shape of rule.

- **The shared-package rule deliberately tolerates an orphaned contract.** The first version
  refused `packages/src/modules/<name>/contract.ts` for a module that is not present, which
  reads well and breaks the deletion criterion: `check:conformance` runs ahead of the build
  in CI, so deleting `backend/src/modules/parties/` would have failed the build for a reason
  having nothing to do with parties. What is refused now is the *shape* — only `contract.ts`
  lives under a module's directory — which is what actually keeps domain concepts out.
  `conformance.spec.ts` covers both halves.

Also worth knowing, since it is not obvious from the endpoint: **there is no way to clear an
email, a phone number or an organisation.** The platform reads `null` and an empty string as
absent, so `PATCH` can change a contact detail but not erase one, and the detail form leaves
empty boxes out rather than sending blanks the validator would refuse. Offering erasure
should be an explicit act when somebody asks for it, not an empty box meaning "delete" —
which is also what an accidental keystroke means.
