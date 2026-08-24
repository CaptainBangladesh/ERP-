# 02 — Category model: industry templates, and whether a category is a Product

Type: grilling
Status: resolved

## Question

How are expense categories defined, and where do they live?

- Every company needs its own categories (a clinic's look nothing like a clothing outlet's or a
  school's), but industry preset templates were requested — where do templates live (a fixed
  catalog in code vs. something a company picks at setup), and what happens once a company
  customizes a template afterward?
- The pasted source spec described "every expense category is configured as an internal
  product." This platform already has a Core Products module. Does a category *reuse* Products
  (a real `dependsOn: products` edge, the way Inventory already depends on Products) or is it a
  distinct concept owned by Expenses? This is a module-boundary decision, not a detail —
  `check:conformance` will hold either answer to it.
- What does a category carry beyond a name — some accounting classification tag, following ADR
  0008's pattern (the emitting module carries value + classification in its event; it never
  holds a foreign key into Accounting)?

## Comments

**Explicitly not decided here:** which specific industry templates ship (clinic, clothing
outlet, school, etc.) or their exact category lists — that's detail that follows once the
*mechanism* (where templates live, how they're picked and customized) is settled.

## Answer

**A category is a distinct concept, owned by Expenses — not a Product.** No `dependsOn: products`
edge for this. Products' whole shape — cost, unit of measure, stockable, supplier — models a
purchasable/sellable/stockable thing; a category (Travel, Meals, Office Supplies) is a
classification tag, not a catalogued item someone buys or stocks. Inventory depends on Products
because stock genuinely is "stock of a product"; an expense is not "an expense of a product" in
that sense. Reusing Products would force every category through fields that don't apply to it,
contradicting the original source spec's framing ("every expense category is configured as an
internal product") rather than following it.

**Schema:**
- `Category`: `id`, `companyId`, `name` (unique within company, same discipline as
  `Product.code`/`UnitOfMeasure.code`), `classification` (string, e.g.
  `'operating-expense' | 'cost-of-goods' | 'capital'` — exact vocabulary is Accounting's to refine
  when that module is specified; not a Postgres enum, mirroring `StockMovement.classification` and
  `payeeType` exactly, for the same reason: a wire-contract value a later module reads, never an
  account code Expenses would have to guess at), `status` (`active`/`inactive`, same as
  `Product.status`/`UnitOfMeasure.status` — nothing is deleted, since a category assigned to a real
  expense from three years ago must stay resolvable).
- **Flat, not hierarchical.** One list per company, no parent/child. Nesting can be added later as
  its own ticket if it turns out to be needed — nothing here forecloses it, and building it now
  would be designing for a requirement nobody has stated.
- `ExpenseRecord.categoryId` is **mandatory**, not nullable — every expense must be tagged before
  it's real, matching the source workflow ("tag each line with a category") and giving Accounting
  a classification signal on every row from day one rather than a backfill problem later.

**Industry templates are onboarding suggestions, not seed data and not a gate.** A template is a
fixed list defined in code (not database rows) — e.g. a `CLINIC_TEMPLATE`, `RETAIL_TEMPLATE`
constant, each a list of `{ name, classification }` pairs. A company may, during setup, trigger an
explicit authenticated action ("start from the Clinic template") that inserts real `Category` rows
copied from that list — a real request a real user made, not a background seed, so it doesn't
conflict with this platform's "nothing is seeded, ever" discipline the same way ticket 06 confirmed
lazy materialization doesn't. Once copied, those rows are just the company's own categories: no
ongoing link back to the template, and editing or deactivating one afterward is ordinary category
editing, not "customizing a template." **Choosing a template is entirely optional and never
restricts what a company can do** — every company can create, edit, and deactivate categories
freely regardless of whether they picked a template, picked a different one, or skipped the step
entirely; templates only save typing at setup, they never gate a Core feature.

Resolved through interactive grilling; live discussion not separately filed under `research/`.
