# 01 — Payee model: employee reimbursement vs. company card vs. vendor bill

Type: grilling
Status: resolved

## Question

When someone records an expense, who is it owed to, and how does that change what the record
needs? Three shapes were named in the original ask: an employee is reimbursed out of pocket, the
company pays directly (card/bank), or a vendor sends a bill (accounts payable, tied to the
existing Parties module).

Resolve:

- Is payee type a fixed enum on every expense record, or a polymorphic reference (employee vs.
  Party vs. "company account")?
- Does a vendor bill's payee reuse the Parties module (a real `dependsOn: parties` edge), the way
  Products and Inventory already depend on modules they need — or something narrower?
- Is "employee" resolved via Identity (the acting user) or does it need HRM's Employee shape stub
  (foundation ticket 03) for someone who isn't a system user at all?
- How does payee type change approval or Accounting's payable account, even though both of those
  stay fog for now — name the shape clearly enough that those tickets aren't guessing later.

This is the most load-bearing fork on the map: it decides a real module dependency (Parties,
possibly Identity/HRM) and shapes the Accounting module's payable structure before that module's
own ticket can be written.

## Answer

**A submission can name a payee different from the submitter** — confirmed against real usage
(an office manager files on behalf of other employees) — so this is not resolvable via the
session-actor-freeze pattern alone (the pattern Inventory's `StockMovement` uses for "who did
this," since Identity's public surface is deliberately empty). Two distinct people are tracked on
every expense: who filed it, and who gets paid.

**Schema shape** — a discriminator plus per-type nullable references, following two precedents
already in this codebase exactly:

- `payeeType`: plain string (`'employee' | 'company' | 'vendor'`), not a Postgres enum — same
  reasoning as `Party.kind` and `StockMovement.classification` (wire-contract values; an enum
  would make adding one a migration).
- `payeeEmployeeId`: nullable UUID, **no FK constraint** — cross-module reference, resolved
  through HRM's new `EmployeeDirectory` (see below). Mirrors `ProductSupplier.partyId`
  (`schema.prisma:525`), which is a plain column specifically because it crosses a module
  boundary; same-module references (`PartyRole.partyId` → `Party`) do get a real `@relation`.
- `payeePartyId`: nullable UUID, no FK constraint, resolved through `PartyDirectory`. Set when
  `payeeType = 'vendor'`.
- `companyPaymentMemo`: nullable free-text string, human bookkeeping only (e.g. "Amex ending
  4022"). No `BankAccount`/`CompanyCard` model exists anywhere in this schema yet, and building
  one now would be reaching into fog the map already deferred to Accounting/bank-reconciliation.
  Set only when `payeeType = 'company'`; no reference target otherwise.
- `submittedByUserId` / `submittedByName`: separate frozen pair, same mechanism as `StockMovement`
  (`recordedById`/`recordedByName`) — copied at write time, since Identity exports nothing to
  resolve it through live. Independent of `payeeEmployeeId`.
- `payeeType` alone is the branching signal later tickets need — vendor → AP account, employee →
  reimbursement payable, company → no payable at all — matching how `StockMovement.classification`
  already lets Accounting branch without Inventory knowing account codes. No additional field
  needed at this layer.
- **Non-goal:** one payee per expense line. Splitting a single line across multiple payees isn't
  supported and wasn't asked for.

**New module edges:** Expenses gains `dependsOn: ['hrm', 'parties']`.

**Prefactor required before Expenses can be built:** HRM has no public contract today
(`dependsOn: []`, nothing depends on it). It must publish a minimal `EmployeeDirectory` —
`employee(id)`, `employees(ids[])` only — mirroring `PartyDirectory`'s shape exactly.
Deliberately *not* richer: neither `department` nor an active/inactive concept exists on
`Employee` today (`schema.prisma:327-355`), and nothing consumes either yet (approval routing and
budgets, the plausible future consumers, are still unresolved fog). Adding "can't select a
departed employee as payee" is deferred to its own ticket if it ever actually bites — it isn't a
free addition, since it would also need to touch `PayRunLine`, which already references
`Employee`.

**Vendor payee reuses Parties, matching Products exactly.** `dependsOn: ['parties']`, resolved via
`PartyDirectory`, reusing the existing `supplier` role rather than inventing a `vendor` role — the
same real-world relationship ("a counterparty I pay"), and `PartyRole` is freeform specifically so
roles don't need to proliferate for the same underlying fact.

**No auto-tagging a party as `supplier` from Expenses' backend.** Products' `addSupplier`
(`products.service.ts:157-164`) deliberately refuses to write a role cross-module — "a role is
what a party is to the business, the address book owns that." Expenses follows the same
discipline: its backend only ever *reads* through `PartyDirectory`, never writes `PartyRole`.
The UX gap this would otherwise create is solved without breaking the boundary: Parties already
exposes `POST /parties/:id/roles` as a public REST endpoint (`parties.controller.ts:87`), so when
the office manager picks a party without the `supplier` role, Expenses' *frontend* calls that
endpoint directly — the identical action as visiting the address book, just composed into one
screen. No new crack in the module boundary; Expenses' backend never touches `PartyRole`.

**Confidential employees are not a special case — they follow existing HRM restriction exactly.**
`EmployeeDirectory.employee(id)` respects `Employee.confidential` the same way every other HRM
query does: a caller without `hrm:employees:read-confidential` gets nothing back for that ID —
"unreachable by its own identifier," not merely filtered from a list. Expenses does not carve
itself an exception to a privacy guarantee that isn't its call to weaken. If someone needs to file
on a confidential employee's behalf, that's solved by granting *that person* the existing HRM
permission, not by softening what `confidential` means.

Resolved through interactive grilling; live discussion not separately filed under `research/`.
