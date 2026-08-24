# Spec — Expense capture, categorization & reporting

Status: ready-for-agent

Consolidates the resolved decisions on the Expenses & Accounting map
(`.scratch/expenses-accounting/map.md`): tickets
[01 — payee model](issues/01-payee-model.md),
[02 — category model](issues/02-category-model.md),
[03 — expense report grouping](issues/03-report-grouping.md),
[04 — OCR receipt capture](issues/04-ocr-capture.md),
[05 — email-gateway receipt capture](issues/05-email-gateway.md), and
[06 — recurring-expense scheduling](issues/06-recurring-scheduler.md).

Supersedes the first cut of this spec, which stopped short of a real create-expense flow because
categorization (02) and report grouping (03) were still fog — both are resolved now, so this
version goes end-to-end: an expense line can be captured, categorized, grouped into a report, and
submitted.

## Problem Statement

Nobody can record a company expense on this platform today — there is no Expenses module. Three
concrete ways an expense needs to start exist for real companies: someone photographs or uploads
a receipt, someone forwards a receipt email to the company, or someone types one in by hand. In
every case, three questions have to be answered before the expense is real: who is this money owed
to (the employee who paid out of pocket, the company's own card, or a vendor who sent a bill), who
is filing it (which is not always the same person — an office manager routinely files on behalf of
other employees), and what kind of spend it is (so it can be grouped, reported on, and eventually
posted to the right account). On top of a single line, the source workflow submits expenses in
batches — photograph receipts, tag each with a category, group them under a report, submit the
report — not one line at a time. Two further needs sit alongside first-capture: some expenses
recur on a schedule (rent, subscriptions) and should not have to be retyped every period, and a
scanned or emailed receipt is inherently untrustworthy until a person confirms what a machine
extracted from it.

## Solution

Stand up the Expenses module with a single expense-record shape that every capture path — manual,
OCR upload, and forwarded email — produces, and that carries who filed it, who is owed, and what
category it belongs to, each independent of the others. Manual entry submits a record directly.
OCR upload and forwarded email both go through one shared extraction step that turns a file into
draft field values with a per-field confidence score, landing in the same draft state a human must
review, categorize, and confirm before the expense is real. A recurring-expense rule materializes
its next occurrence as one of these same drafts, generated lazily on a user's next request into the
company rather than by an unattended background job — this platform has no scheduler, and building
one is explicitly out of scope here (see Out of Scope).

Every line — however captured — is created inside, or added to, an expense report: a first-class
record with its own name, date range, and lifecycle (`draft` → `submitted`, with `approved` /
`rejected` reserved in the status vocabulary for the still-unwritten approval-workflow ticket to
build behavior on top of). A report's lines can be added, edited, or removed while it's `draft`;
submitting it locks them. Categories come from a flat, per-company list the filer picks from,
optionally seeded from an industry template at onboarding — a suggestion, never a requirement or a
gate.

Approval routing and everything Accounting-side remain fog on the map and are not part of this
spec. What this spec delivers is the whole path from "here's a receipt" or "let me type this in"
through to a submitted, reportable, categorized expense report sitting ready for an approval
workflow that doesn't exist yet.

## User Stories

1. As an employee, I want to submit an expense I paid for out of pocket, so that I get reimbursed.
2. As an employee, I want to submit an expense that was charged to the company card, so that it's
   recorded without implying I'm owed money.
3. As an office manager, I want to file an expense on behalf of a colleague, so that people who
   don't use the system themselves can still be reimbursed.
4. As anyone reviewing an expense later, I want to see both who filed it and who it's payable to,
   even when those are different people, so that the record answers "who submitted this" and "who
   do we owe" independently.
5. As an employee submitting a vendor bill, I want to pick the vendor from the existing address
   book (Parties) rather than retype a name, so that the same counterparty is recognized
   everywhere it's paid.
6. As an employee, I want to pick a party that isn't yet tagged as a vendor and have it tagged in
   the same screen, so that I don't have to leave the expense flow to fix the address book first.
7. As an employee filing on behalf of a confidential employee, I want the system to enforce the
   same HRM confidentiality restriction it enforces everywhere else, so that a privacy guarantee
   isn't quietly weaker inside Expenses.
8. As an employee, I want to photograph or upload a receipt and have the vendor, date, total, and
   tax pre-filled, so that I don't have to type them by hand.
9. As an employee, I want to see how confident the system is in each extracted field individually
   (not just the receipt as a whole), so that I know which fields to double-check before
   confirming.
10. As an employee, I want to correct any extracted field before the expense is created, so that a
    misread total or vendor never becomes the record of what happened.
11. As anyone auditing an expense later, I want the original receipt image or PDF still attached to
    the record, so that "why does this say $84.20" is always answerable from the source document.
12. As an employee, I want to forward a receipt email to a company address and have it turn into a
    draft expense the same way an uploaded photo does, so that I don't have to download an
    attachment and re-upload it myself.
13. As the platform, I want an inbound receipt email attributed to the right company by matching
    the verified sender address against a known user, so that a forwarded receipt lands in the
    filer's own company without a per-company alias to configure.
14. As an employee, I want a forwarded receipt email that doesn't match any known user to be
    rejected rather than silently attributed to the wrong company, so that expenses never leak
    across tenants.
15. As an employee, I want a draft created from an uploaded receipt and a draft created from an
    email to look and behave identically once they reach my review screen, so that I don't have to
    learn two different review flows for the same task.
16. As someone who set up a recurring expense (e.g. monthly rent), I want it to reappear as a draft
    each time it's due, so that I don't have to remember to re-enter it manually.
17. As someone reviewing a recurring expense's draft, I want to confirm or adjust it the same way I
    would any other draft, so that recurring expenses don't bypass the same review discipline
    manual and captured expenses get.
18. As the platform, I want every expense row to be traceable to a real authenticated request that
    created it — including a recurring expense's materialization — so that no expense is ever
    written by an unattended process nobody can point to.
19. As an employee, I want to assign a category to every expense line, so that spend can be
    grouped and reported on by kind.
20. As a company setting up Expenses for the first time, I want to optionally start from an
    industry-preset category list (clinic, retail, school, ...), so that I don't have to invent a
    category list from a blank page.
21. As a company that skipped the template, or wants categories the template didn't offer, I want
    full ability to create, rename, and deactivate my own categories at any time, so that picking
    (or skipping) a template never limits what I can do.
22. As an employee, I want to group several receipts under one named expense report (e.g. "NYC
    trip — March"), so that I can submit a whole trip's or period's expenses as one batch instead
    of one at a time.
23. As an employee, I want a report to carry a date range, so that I can find and filter reports by
    when the spend happened.
24. As an employee, I want to add, edit, or remove lines in a report while it's still a draft, so
    that I can fix mistakes before I submit.
25. As an employee, I want a report's lines locked once I submit it, so that nobody — including me
    — can quietly alter what was actually submitted for approval.
26. As an employee, I want every line I create or confirm to require a category and a report, so
    that nothing "real" in the system is ever uncategorized or ungrouped, and later
    reporting/approval never has to handle a bare, unfiled line as a special case.
27. As a developer building the next piece of this map (approval workflow, Accounting), I want the
    payee, category, and report shapes to already be settled and stable, so that later tickets
    aren't guessing at fields that should have been decided here.

## Implementation Decisions

**New module: `expenses`.** Tier: core (decided on the map). `dependsOn: ['hrm', 'parties']`.

**Prefactor required first — HRM must publish a public contract.** HRM currently has
`dependsOn: []` and no public surface (unlike `PartyDirectory`/`ProductCatalogue`). Add
`EmployeeDirectory`, an abstract-class contract mirroring `PartyDirectory`'s shape exactly:
`employee(id)` and `employees(ids[])` only — no department or active/inactive concept, since
nothing on the map consumes either yet. `EmployeeDirectory.employee(id)` must respect
`Employee.confidential` exactly as every other HRM read path does: a caller without
`hrm:employees:read-confidential` gets nothing back for that ID, not a filtered result. Expenses
never carves itself an exception to this.

**`ExpenseRecord` schema — the payee and submitter fields:**
- `payeeType`: string, one of `'employee' | 'company' | 'vendor'` — a plain wire-contract value
  like `Party.kind`/`StockMovement.classification`, not a Postgres enum, so adding a fourth type
  later is not a migration.
- `payeeEmployeeId`: nullable UUID, no FK constraint — cross-module reference resolved through
  `EmployeeDirectory`. Set when `payeeType = 'employee'`.
- `payeePartyId`: nullable UUID, no FK constraint — cross-module reference resolved through
  `PartyDirectory`, reusing the existing `supplier` role (no new `vendor` role). Set when
  `payeeType = 'vendor'`.
- `companyPaymentMemo`: nullable free-text string (e.g. "Amex ending 4022") — human bookkeeping
  only, no reference target. Set when `payeeType = 'company'`. No `BankAccount`/`CompanyCard`
  model; that's Accounting/bank-reconciliation fog, not this spec.
- `submittedByUserId` / `submittedByName`: a separate frozen pair, copied at write time — same
  mechanism as `StockMovement.recordedById`/`recordedByName`. Independent of the payee fields;
  always present regardless of `payeeType`.
- No support for splitting one expense line across multiple payees.

**Expenses' backend only ever reads through `PartyDirectory` — never writes `PartyRole`.**
Matches `ProductsService.addSupplier`'s discipline exactly. If the filer picks a party that
doesn't yet hold the `supplier` role, the *frontend* calls Parties' existing public
`POST /parties/:id/roles` endpoint directly, composed into the same screen. No backend-to-backend
role write, no new crack in the module boundary.

**Draft/capture-record fields — shared by all three capture paths:**
- The original uploaded file (receipt image, PDF, or email attachment), retained indefinitely.
- `vendor`, `date`, `total`, `tax` as typed values, using this platform's existing exact-decimal
  money type for `total`/`tax` — never the extraction provider's raw currency string.
- A confidence score **per field**, not one per document.
- A capture-status marker (`manual | ocr | email | recurring`, same string-not-enum treatment as
  `payeeType`) so downstream code treats all four origins uniformly.
- The raw extraction-provider response, stored but not surfaced in any UI.
- A mandatory review/confirmation step between extraction and the point the record becomes a real,
  submittable expense — required for every non-manual capture path, regardless of confidence
  score. No auto-posting.

**Extraction is one shared, swappable interface — an abstract-class seam matching `Mailer`'s
shape** (one contract, one binding): given a file buffer and MIME type, returns
`{ vendor, date, total, tax, confidence }` (confidence per field). Both the OCR upload path and
the email-inbound path call this same interface; only how bytes arrive differs between them.
Provider: a third-party receipt-extraction API (AWS Textract `AnalyzeExpense`, Azure AI Document
Intelligence `prebuilt-receipt`, or Google Document AI Expense Parser — pick by whichever cloud
this platform's object storage ends up on; near-identical cost and capability per ticket 04's
research). Self-hosted OCR is out of scope (see Out of Scope).

**Capture paths, split cleanly along this platform's own module-boundary discipline:**
1. **OCR upload** — an authenticated multipart upload inside an existing session; the company is
   already known from the session before any file is touched.
2. **Email-inbound** — an unauthenticated webhook, verified by the provider's signature, with no
   session. Company attribution happens by looking up the verified `From` address against
   `User.email` (globally unique already) and entering `runInCompany` via the same
   `withoutCompanyScope` → `runInCompany` escape hatch sign-in uses — tenancy's one sanctioned
   pattern for a request that arrives with no session. An unmatched sender is rejected; the
   inbound webhook never guesses a company. Company resolution must happen before extraction is
   called, since extraction runs inside `runInCompany` like every other company-owned write.
   Vendor: any of SendGrid Inbound Parse, Mailgun Routes, Postmark Inbound, or AWS SES receiving
   — they converge on the same shape (one authenticated HTTPS POST to a NestJS controller).
   Building this is this platform's first inbound-email vendor relationship; `Mailer`/`DevMailer`
   is outbound-only and unrelated.
3. **Manual entry** — a direct authenticated write with no draft/extraction step; the filer is the
   source of truth for every field.

**Recurring-expense materialization — lazy, not a scheduler.** A recurring-expense rule (its own
fields — cadence, template — are fog, deferred to the "recurring expense rules" item on the map)
generates its next due occurrence as a draft on a user's next authenticated request into that
company, not on a timer. No cron, no job queue, no new platform dependency — `check:conformance`'s
21 static rules don't actually reach "who triggered this insert" (verified against
`conformance.spec.ts`), but every insert stays traceable to a real HTTP request by construction
either way. Building a true unattended scheduler (`Tenancy.runInCompany` on a timer, per ADR 0009)
is explicitly out of scope for this spec.

**`Category` schema and endpoints.** A distinct model Expenses owns — not a Product, since a
classification tag isn't a catalogued, priced, stockable thing (no new `dependsOn` edge for this).
- `Category`: `id`, `companyId`, `name` (unique within company), `classification` (string, e.g.
  `'operating-expense' | 'cost-of-goods' | 'capital'` — Accounting's to refine when that module is
  specified; not a Postgres enum, same treatment as `payeeType`), `status` (`active`/`inactive`,
  nothing deleted). Flat list, no parent/child.
- Standard CRUD endpoints (`list`, `create`, `update`, `deactivate`), permissioned like every
  other module's own resource (`expenses:categories:read` / `expenses:categories:write`).
- **Templates are static config in code, not database rows.** A fixed list per industry (e.g.
  `CLINIC_TEMPLATE`, `RETAIL_TEMPLATE`, each a list of `{ name, classification }` pairs) lives in
  the module's source. An `apply-template` endpoint, called once at onboarding, inserts real
  `Category` rows copied from the chosen list — a real authenticated request, not a seed script,
  so it doesn't conflict with "nothing is seeded, ever." No ongoing link back to the template
  after copying; editing a copied row afterward is ordinary category editing. Choosing a template
  is entirely optional and never gates category CRUD.

**`ExpenseReport` schema and endpoints.** A first-class record, not a query grouping over a
shared tag — a batch needs somewhere to hold "this was submitted."
- `ExpenseReport`: `id`, `companyId`, `submittedByUserId` / `submittedByName` (frozen pair, same
  mechanism as `ExpenseRecord`'s submitter fields), `name` (free-form label), `startDate`,
  `endDate` (both mandatory, using the existing `Field type="date"` primitive), `status` (string:
  `'draft' | 'submitted' | 'approved' | 'rejected'` — not a Postgres enum).
- **This spec only reserves the `approved`/`rejected` vocabulary; it does not build the
  transition.** No endpoint here sets those two values — that's the separate, still-fog
  approval-workflow ticket's job (permission, thresholds, levels). Reserving the values now means
  that ticket adds behavior rather than a migration.
- Endpoints: create a report (`draft`), add/edit/remove a line while `draft`, submit (transitions
  `draft` → `submitted`, and is the point at which its lines become immutable — mirroring
  `StockMovement`'s immutability pattern, scoped to the report rather than the line). No endpoint
  edits a line once its parent report has left `draft`.

**`ExpenseRecord.categoryId` and `ExpenseRecord.reportId` are both mandatory, not nullable.**
Every line needs a category and a report before it counts as real:
- A manually entered line requires both at creation — there is no draft phase for manual entry
  (per the capture-paths decision below), so both are supplied in the same request that creates
  the record.
- A captured line (OCR or email) requires both at **confirmation** — the same moment the draft
  becomes a real, submittable record, alongside any field corrections the reviewer makes.
- A line is created inside an existing `draft` report, or a report is created in the same action
  as the line's first save — either shape is acceptable as long as `reportId` is never left null
  once a line exists outside draft-capture state.

**Events.** No new event is emitted by this spec. `ExpenseRecord` carries `payeeType` and
`categoryId` (resolving to `Category.classification`) as the branching signals a future Accounting
module needs (vendor → AP account, employee → reimbursement payable, company → no payable; and
per-category classification for the journal entry's nominal account) the same way
`StockMovement.classification` lets Accounting branch without Inventory knowing account codes —
but Accounting's own consumption is a separate, not-yet-specified module.

## Testing Decisions

- **Seam: HTTP integration tests against a real Postgres test database**, following
  `test/inventory.spec.ts`'s pattern exactly — `createTestApp`/`resetDatabase` harness, nothing
  mocked below the endpoint, two companies signed up per isolation test rather than one (a claim
  like "a payee reference is scoped to its company" can't be tested with only one tenant in the
  database).
- Test only external behavior through the module's HTTP surface: request in, response and
  database state out. Do not assert against internal service method calls.
- `EmployeeDirectory` and `PartyDirectory` are exercised for real (same process, real DB) — not
  mocked — the same way `test/inventory.spec.ts` exercises `ProductCatalogue` for real.
- The extraction-provider seam (whichever cloud API is chosen) is the one collaborator worth
  faking in tests — it's a real external network call. Bind a test double behind the abstract
  extraction interface, the same way `DevMailer` fakes `Mailer` everywhere including production;
  assert the module's behavior given a known `{ vendor, date, total, tax, confidence }` response,
  not the provider's own accuracy.
- Cover per payee type: employee, company, vendor — including a vendor party that doesn't yet
  hold the `supplier` role, and a confidential employee payee both with and without
  `hrm:employees:read-confidential`.
- Cover both capture paths producing a draft (OCR upload, email-inbound with a matched sender and
  with an unmatched sender) and manual entry producing a record directly with no draft step.
- Cover recurring materialization producing exactly one draft per due occurrence on a request into
  the company, and producing none when nothing is due.
- Cover category CRUD, per-company name uniqueness, and `apply-template` producing real rows with
  no ongoing link to the template afterward (editing a copied row behaves identically to editing a
  hand-created one).
- Cover that `categoryId`/`reportId` are refused as missing on: a manual create with either
  omitted, and a draft confirmation with either omitted.
- Cover report lifecycle: creating a report, adding/editing/removing lines while `draft`,
  submitting locks it (a subsequent line edit/remove is refused), and that no endpoint in this
  spec can set `approved`/`rejected` — the status column accepts the values as data (for the
  future approval ticket to use) but nothing here transitions to them.
- Cover tenant isolation for `Category` and `ExpenseReport` the same way as `ExpenseRecord` — two
  companies signed up per isolation test, one company's rows never visible or referenceable from
  the other.
- Prior art: `test/inventory.spec.ts` (HTTP/DB pattern, tenant isolation via two sign-ups),
  `test/conformance.spec.ts` (how this repo verifies "no code path writes without a request" as a
  structural claim rather than a runtime check).

## Out of Scope

- **The approval workflow itself** — levels, thresholds, who holds the approve/reject permission,
  and the endpoints that actually transition an `ExpenseReport` to `approved`/`rejected`. This
  spec only reserves those two values in the status vocabulary; building the transition is a
  separate ticket.
- Spend policies, budgets, mileage tracking, the Accounting module, payment/reimbursement, bank
  reconciliation, and client re-invoicing — all still fog on the map, each blocked on pieces this
  spec doesn't resolve.
- The recurring-expense *rule* itself (cadence config, template, what "due" means) — this spec
  only settles that materialization is lazy and draft-shaped, not the rule's own fields.
- Hierarchical/nested categories (parent/child) — the category list is flat by decision; nesting is
  a later ticket if it turns out to be needed.
- A Project/Trip concept as a report's boundary — a report's boundary is a name plus a date range;
  no project/trip module exists on this platform to reference.
- Which specific industry templates ship, or their exact category lists — the *mechanism*
  (static config, copied via an explicit action) is decided here; the content is not.
- A true unattended scheduler / background job runner. Explicitly deferred per ADR 0009; nothing
  in this spec should require one.
- Self-hosted OCR/extraction (Tesseract, docTR, invoice2data, etc.) — ruled out on the map; this
  platform has none of the upload/storage/image plumbing it would still require, and open-source
  OCR yields raw text, not receipt-field semantics.
- A per-company email alias or customer-owned inbound domain — sender-lookup attribution is the
  decided mechanism; alias/domain options are named as later extensions, not built here.
- Auto-tagging a party with the `supplier` role from the backend — the frontend calls Parties'
  existing role-write endpoint instead; Expenses' backend never writes `PartyRole`.
- Splitting a single expense line across multiple payees.
- Any HRM concept beyond `employee(id)`/`employees(ids[])` — no department, no active/inactive
  flag on `EmployeeDirectory`.

## Further Notes

- HRM's `EmployeeDirectory` is a hard prerequisite: Expenses cannot be built (or even scaffolded
  against payee type `'employee'`) until that contract exists. Whoever picks this spec up should
  land it first, as its own small change, mirroring `PartyDirectory` file-for-file.
- Ticket 04's and 05's research files carry the full vendor pricing/citation detail behind the
  extraction-provider recommendation:
  `.scratch/expenses-accounting/research/04-ocr-capture.md` and
  `.scratch/expenses-accounting/research/05-email-gateway.md`.
- Ticket 06's research file carries the exhaustive `check:conformance` rule-list evidence behind
  "the no-background-writes rule isn't actually enforced by a build check, but the lazy-draft
  design honors it anyway": `.scratch/expenses-accounting/research/06-recurring-scheduler.md`.
- This is the second cut of this spec. The first stopped short of a full create-expense flow
  because category (02) and report grouping (03) were undecided; both resolved since, so this
  version ships the whole path from capture through a submitted report. What's left on the map
  after this spec lands is entirely about what happens *after* submission: approval, and
  everything Accounting-side.
