# Spec: Modular Monolith Foundation, proven by Inventory

Status: ready-for-agent

## Problem Statement

We are building an ERP product for mid-market businesses (20–500 people) that will eventually
carry many business modules — inventory, warehouse management, payroll, ecommerce, reporting.
Today there is no codebase at all.

The problem is not "we need an inventory module." The problem is that the first module written
silently becomes the architecture. Whatever inventory does — how it reaches the database, how it
scopes data to a company, how it exposes itself to other modules, where its shared types live —
becomes the pattern every later module copies. If inventory is written without a deliberate
module contract, the product arrives at module three as a monolith whose modules are folders,
with cross-module queries threaded through it and no way back.

Two specific failure modes are near-certain without a foundation:

1. **Boundary erosion.** NestJS modules are dependency-injection containers, not enforcement.
   Nothing stops a future payroll service from injecting `PrismaService` and reading
   `stock_levels` directly. The first time it happens it is a shortcut; by the tenth time the
   modules cannot be reasoned about or changed independently.
2. **Tenant leakage.** Every row in this system belongs to a company. With Prisma, a single
   forgotten `where: { companyId }` returns another company's data. Relying on developers to
   remember it on every query is a guarantee of eventual breach, and in payroll that breach is
   salary data.

## Solution

Build a modular monolith foundation and prove it by shipping one real module — **Inventory** —
on top of it.

The foundation defines, once, how any module plugs into the system: how it is isolated, how it
talks to other modules, how it is scoped to a company, how it declares its permissions, how it
owns its schema, and what it may share. Inventory is built fully against that contract, so the
foundation is validated by real use rather than by intention.

**The roadmap is forty-plus modules across three tiers** — Core, Enterprise, and Custom industry
add-ons, all built in-house. At that scale the module contract is not overhead around the product;
it *is* the product. Every manual step in adding a module is paid forty times, and every
inconsistency becomes forty variants. So the contract is built first — manifest, registry,
dependency graph, boundary enforcement, conformance pack, generator — and inventory is the first
module to use it rather than the module it is extracted from.

**Two shape stubs live in the foundation and are never removed.** A foundation built alongside one
module ends up shaped like that module, because the developer has no counter-example in front of
them. The stubs make overfitting impossible rather than merely discouraged: an **HRM stub** shaped
like payroll (periodic calculation over a date range, a sensitive personal field, a record that can
never be edited) and an **add-on stub** shaped like an industry add-on (Custom tier, optional,
depends on another module and extends it through its public contract without editing it). Nothing
counts as foundation until all shapes consume it.

The result is a running system where a two-person team can manage products and stock, and where
adding the second module is a matter of following an established, enforced pattern.

## User Stories

### Foundation — module isolation

1. As a developer, I want each business module to live in its own directory with an explicit
   public surface, so that I can see at a glance what other modules are allowed to depend on.
2. As a developer, I want a module's internals to be unreachable from other modules, so that I
   can refactor inside a module without auditing the whole codebase.
3. As a developer, I want a cross-module import that breaches the boundary to fail the build, so
   that the architecture is enforced by CI rather than by code review vigilance.
4. As a developer, I want the boundary violation error to name both modules and explain the
   permitted alternative, so that I can fix it without reading architecture documentation.
5. As a developer, I want a documented, single way for one module to consume another, so that I
   do not invent a new integration style per feature.
6. As a developer, I want to add a new module by following one worked example, so that onboarding
   a module does not require an architect.
7. As a developer, I want the foundation to make the correct path the easy path, so that shortcuts
   are more effort than doing it properly.

### Foundation — tenancy

8. As a business owner, I want my company's data to be invisible to every other company, so that
   I can trust the product with commercially sensitive stock and cost information.
9. As a developer, I want company scoping applied automatically to every query, so that forgetting
   a filter is not possible rather than merely discouraged.
10. As a developer, I want an attempt to query without a company context to fail loudly, so that
    the mistake surfaces in development rather than in production.
11. As a security reviewer, I want tenant isolation demonstrated by tests that run against a real
    database, so that the guarantee is evidenced rather than asserted.
12. As a business owner, I want my users to belong to my company and no other, so that access is
    bounded by employment.
13. As a developer, I want the tenancy mechanism to work identically for a future payroll module,
    so that the most sensitive data in the system inherits the same protection by default.

### Foundation — identity and authorization

14. As a user, I want to sign in with an email and password and receive a session, so that I can
    use the application.
15. As a user, I want my session to carry my company and my permissions, so that the system knows
    what I may do without a lookup on every request.
16. As a user, I want to be signed out when my session expires, so that an unattended machine is
    not an open door.
17. As a business owner, I want to invite colleagues into my company, so that my team can share
    one set of records.
18. As a business owner, I want to assign roles to my colleagues, so that a stock clerk cannot
    change cost prices or see payroll.
19. As a developer, I want each module to declare the permissions it introduces, so that adding a
    module extends the permission model without editing a central list.
20. As a business owner, I want an unauthorized action to be refused with a clear reason, so that
    my staff understand the boundary rather than assuming a bug.
21. As a developer, I want authorization checked at the API boundary in one consistent way, so
    that no endpoint is accidentally left unguarded.

### Foundation — data and schema ownership

22. As a developer, I want each module to own its own tables and migrations, so that two modules
    do not contend over one schema file.
23. As a developer, I want migrations to run in a defined order across modules, so that
    deployment is deterministic.
24. As a developer, I want foreign keys within a module and no circular dependencies between
    modules, so that the data model reflects the module graph.
25. As a developer, I want shared primitives — identifiers, money, quantities, pagination, error
    shapes, audit fields — defined once, so that modules agree on the basics.
26. As a developer, I want a clear rule for what earns a place in the shared package, so that it
    does not become a dumping ground that recouples every module.

### Foundation — API conventions

27. As a frontend developer, I want every endpoint to follow one resource naming convention, so
    that I can predict a URL without reading the backend.
28. As a frontend developer, I want one pagination shape across all list endpoints, so that the
    shared table component works everywhere.
29. As a frontend developer, I want one filtering and sorting convention, so that list screens are
    built the same way in every module.
30. As a frontend developer, I want one error response shape carrying a machine-readable code and
    a human-readable message, so that I can handle errors generically and show something useful.
31. As a frontend developer, I want validation failures to identify the offending fields, so that
    I can attach messages to the right inputs.
32. As a developer, I want types shared between backend and frontend from one source, so that an
    API change breaks the build rather than the user's screen.

### Inventory — products

33. As a stock manager, I want to create a product with a SKU, name, and unit of measure, so that
    I can begin tracking it.
34. As a stock manager, I want SKUs to be unique within my company, so that two records cannot
    describe the same item.
35. As a stock manager, I want to edit a product's details, so that I can correct mistakes and
    reflect supplier changes.
36. As a stock manager, I want to deactivate a product rather than delete it, so that its
    historical movements remain intelligible.
37. As a stock manager, I want to be prevented from deleting a product that has movement history,
    so that the ledger cannot be orphaned.
38. As a stock manager, I want to search and filter products by SKU, name, and status, so that I
    can find an item in a catalogue of thousands.
39. As a stock manager, I want to see a paginated product list that stays fast as the catalogue
    grows, so that the system remains usable at scale.
40. As a stock manager, I want to record a product's unit of measure, so that quantities are
    unambiguous.
41. As a stock manager, I want to record a product's cost, so that stock can be valued.

### Inventory — locations

42. As a stock manager, I want to define storage locations, so that stock is tracked where it
    physically sits.
43. As a stock manager, I want to be guided to create my first location when I have none, so that
    an empty system tells me what to do next rather than presenting an unusable form.
44. As a stock manager, I want to see stock for one product across all locations, so that I know
    total availability.
45. As a stock manager, I want to see all stock at one location, so that I can reconcile a physical
    count.

### Inventory — stock movements

46. As a stock manager, I want to record a receipt of goods, so that incoming stock is reflected.
47. As a stock manager, I want to record an issue of goods, so that outgoing stock is reflected.
48. As a stock manager, I want to record an adjustment with a reason, so that discrepancies found
    during a count are explained rather than silently corrected.
49. As a stock manager, I want to transfer stock between locations, so that internal movement is
    tracked without changing total quantity.
50. As a stock manager, I want every movement to be recorded permanently and never edited, so that
    the ledger is trustworthy.
51. As a stock manager, I want to correct a mistaken movement by recording a reversal, so that
    both the error and the correction are visible.
52. As an auditor, I want every movement to record who made it and when, so that I can trace any
    change to a person.
53. As a stock manager, I want current stock levels to be derived from the movement ledger, so
    that the number on screen always reconciles with its history.
54. As a stock manager, I want two simultaneous movements on the same product to produce a correct
    final quantity, so that concurrent use does not corrupt stock.
55. As a stock manager, I want to be warned when a movement would drive stock negative, so that I
    can catch data-entry errors.
56. As a business owner, I want to decide whether negative stock is refused or merely flagged, so
    that the system fits how my business actually operates.
57. As a stock manager, I want to view a product's full movement history, so that I can explain
    how it reached its current quantity.
58. As a stock manager, I want to filter movement history by date, type, and location, so that I
    can investigate a specific period.

### Inventory — valuation and reporting readiness

59. As a business owner, I want to see the total value of my stock, so that I understand capital
    tied up in inventory.
60. As a business owner, I want valuation arithmetic to be exact, so that my figures do not drift
    through rounding.
61. As a developer, I want inventory to expose a read contract other modules can consume, so that
    ecommerce and reporting do not query its tables directly when they arrive.

### Frontend

62. As a user, I want to sign in and land on a usable home screen, so that I can start working.
63. As a user, I want navigation that reflects the modules I have access to, so that I am not shown
    features I cannot use.
64. As a user, I want product and movement lists that sort, filter, and paginate consistently, so
    that every screen behaves the same way.
65. As a user, I want a list to show loading, empty, and error states clearly, so that I am never
    left staring at a blank screen.
66. As a user, I want my edits to be reflected immediately with a clear indication when a save
    fails, so that I trust what I see.
67. As a user, I want data refreshed after I make a change, so that I am not acting on stale
    information.
68. As a user, I want forms to validate and show field-level errors, so that I can fix mistakes
    without guessing.
69. As a developer, I want frontend page structure to mirror backend modules, so that navigating
    the codebase is predictable.

### Payroll pressure-test (design validation, not implementation)

70. As an architect, I want the module contract checked against a periodic, calculation-driven
    module before inventory ships, so that the contract is not inventory-shaped.
71. As an architect, I want the tenancy mechanism checked against sensitive personal data, so that
    the strictest case is covered by the default.
72. As an architect, I want the authorization model checked against a module only some staff may
    access at all, so that per-module visibility is supported.
73. As an architect, I want the audit approach checked against a legally-mandated immutable trail,
    so that compliance is possible without re-architecting.
74. As an architect, I want any point where the contract fails the payroll check to be recorded as
    a decision, so that the gap is closed deliberately rather than discovered later.

## Implementation Decisions

### Status of these decisions

The stack constraints below are **fixed by the developer**. The architectural decisions marked
**(proposed default)** were still open at the time of writing; they are recorded here so the spec
is implementable, and any of them may be overturned without invalidating the rest.

### Fixed constraints

- **Backend:** NestJS. REST only, no GraphQL. Prisma as the ORM.
- **Database:** PostgreSQL, self-hosted.
- **Authentication:** JWT.
- **Frontend:** React, functional components and hooks only. Tailwind for styling. Components
  hand-built.
- **Monorepo:** three workspaces — `packages` (shared utilities, types, constants), `backend`
  (NestJS), `application` (React).
- **Barred:** microservices, message queues, Redis (until performance demands it), Redux, styled
  component libraries, premature optimisation.
- **Frontend dependency rule:** a frontend dependency is permitted only if it renders no markup
  and no CSS. TanStack Query (server state) and TanStack Table (grid logic) are adopted under this
  rule. Styled component libraries remain barred.
- **Schema posture:** normalized but pragmatic; clear foreign keys; no circular dependencies.

### Core modules versus the shared package

- The shared package holds **primitives with no business meaning only**: money and quantity types,
  identifiers, pagination and error shapes, the data table. Anything with rules, tables, or screens
  is a module. Left unchecked, a shared package accumulating domain concepts becomes a second
  application that everything depends on and nobody owns — the monolith rebuilt inside the thing
  meant to prevent it.
- **Parties** is a Core module: one record that can simultaneously be a customer, a supplier, and an
  employee contact. Sales, Purchase, Inventory, HRM and Marketing all read from it. Separate
  per-module customer and supplier tables are rejected — they produce the same real-world company
  stored several times with no consolidated view, and merging them later is a migration nobody runs.
- **Products and units of measure** is a Core module beneath Inventory, so Sales, Purchase,
  Manufacturing and E-commerce depend on Products rather than on the whole inventory module.
- **Identity and access** is a Core module: companies, users, sessions.
- A Core module may not depend on a higher tier, enforced by the build.

### Module structure

- A module is a directory under the backend containing its controllers, services, entities, and
  Prisma models. Each module exposes a single explicit public surface; everything else is internal.
- **Every module declares a manifest**: name, tier, the modules it depends on, its routes,
  migrations, permissions, navigation entries, and the events it emits and consumes. The application
  assembles itself from manifests; there is no central registry to edit. Dependency cycles, missing
  dependencies, and undeclared usage all fail the build.
- **A generator produces new modules already conformant.** At forty modules, consistency cannot come
  from discipline — it comes from the starting point being correct.
- **A conformance pack** is a shared test suite every module must pass: company scoping enforced,
  permissions checked on every endpoint, list and error shapes correct, no cross-module table
  access. Adding a module means passing the pack, not surviving forty code reviews.
- **The deletion test**: excluding any business module must leave the application building and
  booting. If deleting inventory breaks the foundation, the foundation depends on inventory.
- **Tier-based enablement**: a company sits in a tier and reaches the modules that tier grants.
  Navigation, routes and permissions all respect it, and no module needs to know tiers exist.
  Per-company, per-module purchasing is not supported.
- **(proposed default)** Boundary enforcement is static, not runtime: an ESLint boundary rule plus
  TypeScript project references, wired to fail CI. A module may import another module's public
  surface and nothing else.
- **(proposed default)** Cross-module communication is by injected public service interfaces for
  synchronous reads and commands, plus Nest's in-process `EventEmitter` for notifications a module
  emits without caring who listens. An in-process emitter is not a message queue and does not
  breach the no-queues constraint. Modules never query each other's tables.
- **(proposed default)** A module self-registers its routes, its permission definitions, its
  navigation entries, and its migrations, so adding a module does not require editing a central
  registry.

### Tenancy

- Every business table carries a `companyId`. Users belong to exactly one company.
- **(proposed default)** Scoping is enforced by a Prisma client extension that requires an explicit
  company context and injects the filter on every query, throwing if no context is present. Company
  context is established once per request from the JWT and carried through async local storage.
  Postgres RLS is the alternative and remains open; the extension is preferred because it keeps
  enforcement in one auditable place and does not require managing database roles per request.
- Cross-company access is not supported. Multi-entity consolidation is out of scope.

### Data model

Tables are owned by the module that declares them. Identity and access owns companies, users and
sessions; Parties owns parties, their roles and addresses; Products owns products and units of
measure; Inventory owns locations, stock movements and stock levels.

- **The accounting seam.** Accounting is a *sink* — Sales, Purchase, Inventory, Payroll and
  Manufacturing all write to it. Sinks are the expensive retrofit, so stock movements carry the
  value and accounting classification a journal entry would need, and emit an event describing the
  movement. No accounting module is built and inventory never depends on one. Stock valuation must
  equal the sum of the movements' accounting values, which is the property that makes Accounting a
  straightforward module to add rather than a reason to rewrite inventory.

- **(proposed default)** `stock_movements` is an append-only ledger. Rows are never updated or
  deleted; a correction is a new reversing movement. Every row records actor and timestamp.
- **(proposed default)** `stock_levels` is a maintained projection of the ledger, updated in the
  same transaction as the movement, with a uniqueness constraint on product-and-location and a
  row-level lock to serialise concurrent movements. Deriving levels by aggregation on read is
  correct but degrades as the ledger grows; the projection is reconcilable against the ledger.
- **(proposed default)** Money is stored as Postgres `numeric` and handled in application code as a
  fixed-precision decimal — never a JavaScript `number`. Quantities likewise, to support fractional
  units of measure. Rounding rules are applied explicitly at defined points, not incidentally.
- **(proposed default)** Each module owns its Prisma models and its migrations; schema is split per
  module rather than kept in one file.

### Authorization

- **(proposed default)** Role-based access control scoped to a company. Roles are collections of
  permissions; permissions are declared by the module that introduces them, in the form
  `<module>:<resource>:<action>`. Checked at the API boundary by a guard applied consistently.
- **No seed data exists in the running application.** The first company and its owner are created
  through the sign-up screen; owner status derives from having created the company, not from a
  seeded role row. Every role, product, and location is created by hand through the UI. Defaults
  are applied in code, never as inserted rows. Test fixtures create data inside the test harness
  only.
- Because nothing is seeded, an empty database is the first thing a user sees. Empty states are
  acceptance criteria on every screen, not polish.
- **(proposed default)** Module-level visibility is supported — a role may be denied a module
  wholesale — because payroll requires it.

### API contract

- **(proposed default)** Resource-oriented REST, plural nouns, nested only one level deep.
- **(proposed default)** One list envelope carrying items plus pagination metadata; cursor-based
  pagination. One filter and sort convention across all list endpoints.
- **(proposed default)** One error shape: machine-readable code, human-readable message, and for
  validation failures a per-field breakdown. Consistent HTTP status codes.
- Request and response types are defined in `packages` and consumed by both workspaces.
- Movements are created via intent-named endpoints (receipt, issue, adjustment, transfer) rather
  than a generic movement create, so that validation and permissions differ per intent.

### Frontend

- Page components mirror backend modules — `InventoryPage`, `ProductList`, `StockForm`.
- Server state is owned by TanStack Query: caching, invalidation after mutations, loading and
  error states. React Context is used only for genuine client state — session, current company,
  navigation. Redux remains barred and is unnecessary once server state is handled properly.
- One shared `DataTable` lives in the shared workspace, built on TanStack Table's headless logic
  with hand-written Tailwind markup. Every list screen uses it. No module builds its own table.
- Navigation is assembled from module-declared entries, filtered by the user's permissions.

## Testing Decisions

### What makes a good test here

A good test exercises external behavior through a stable seam and asserts on what a user or a
caller observes. It does not reach into services, repositories, or component internals. Because
the module contract is itself under design, tests that bind to internal structure would calcify
exactly the decisions that must stay movable — so the seams are deliberately high and few.

Tests are written against real infrastructure wherever it is the subject. Tenant isolation and
ledger concurrency cannot be meaningfully asserted against a mock.

### Seam 1 — backend HTTP boundary

The primary seam. Tests boot a real Nest application and drive it over `supertest` against a real
PostgreSQL instance. Prisma, services, and repositories are not mocked. Each test runs in an
isolated database state.

Covered at this seam:

- Product lifecycle: creation, SKU uniqueness within a company, update, deactivation, refusal to
  delete a product with movement history.
- Movement recording for each intent, and rejection of invalid movements.
- Ledger immutability: no route mutates or deletes a movement; corrections appear as reversals.
- Stock level correctness after sequences of movements, including transfers.
- Concurrency: simultaneous movements against one product-and-location produce a correct final
  quantity.
- **Tenant isolation**: a user of company A cannot read, update, or delete company B's products,
  locations, or movements — asserted per endpoint, and treated as the suite's highest-value test.
- Authorization: each endpoint refuses a caller lacking the required permission.
- Authentication: unauthenticated and expired-token requests are refused.
- API conventions: pagination, filtering, sorting, and error shape are consistent across list
  endpoints.
- Money and quantity arithmetic across long movement sequences, asserting no precision drift.

### Seam 2 — frontend network boundary

Page-level components rendered with the HTTP layer intercepted. Assertions are on rendered output
and user interaction, never on hooks or component state.

Covered at this seam:

- Product list renders, sorts, filters, and paginates.
- Loading, empty, and error states render distinctly.
- Movement form validates, submits, and surfaces field-level server errors.
- The list refreshes after a successful mutation.
- Navigation reflects the permissions in the session.

No component-level unit tests. No tests of hooks in isolation.

### Static checks — not tests

Module boundary enforcement is a lint rule and a build failure in CI, not a runtime test. A test
asserting "payroll does not import inventory internals" would be testing the linter.

### Prior art

None — this is the first code in the repository. These two seams and their harnesses are
themselves foundation deliverables, and the inventory suite is the prior art every later module
copies. Getting the harness ergonomics right is therefore in scope: if writing an HTTP test is
tedious, later modules will not be tested.

## Out of Scope

**Scale bands.** The product targets businesses of 20–500 people. The two-person shop and the
ten-thousand-person enterprise are explicitly excluded. The foundation must not *foreclose* the
enterprise end, but no work is done to serve it now — no SSO, no approval chains, no multi-entity
consolidation, no org hierarchy.

**Other modules.** Sales, Accounting, HRM and payroll, Manufacturing, Procurement, E-commerce,
Marketing, warehouse management and reporting are not built. HRM and industry add-ons appear only
as shape stubs pressure-testing the module contract.

**Third-party extensibility.** Add-ons are written in-house only, so there is no versioned public
API, no stability policy, no isolation between modules, and no packaging or distribution story.
This keeps module contracts freely refactorable — a freedom worth protecting deliberately, since it
disappears the moment an outside party ships a module.

**Per-company module purchasing.** Enablement is by tier band only.

**Deferred infrastructure.** Microservices, message queues, and Redis. Caching is added only if a
measured performance problem demands it.

**Deferred inventory depth.** Purchase orders and supplier management; sales orders; bins and
put-away logic (warehouse module); lot, batch, and serial number tracking; multi-currency;
FIFO/LIFO/weighted-average costing beyond a single cost per product; barcode scanning; stock
take and cycle counting workflows; reorder points and replenishment; landed cost.

**Deferred platform concerns.** Background jobs and scheduling; email and notifications beyond
what authentication requires; file and image attachments; import and export; a public API for
third parties; webhooks; internationalisation and localisation; a reporting or analytics layer.

## Further Notes

**On the proposed defaults.** Roughly ten architectural decisions in this spec were open when it
was written and have been given recommended answers so the spec is actionable. They are marked
**(proposed default)** throughout. The two most consequential — boundary enforcement and the
tenancy mechanism — are worth deliberate confirmation before implementation begins, because both
are cheap to choose now and expensive to change once several modules exist.

**On the payroll pressure-test.** It is a gate, not a phase. Each foundation decision should be
checked against payroll's requirements as it is made, and the check recorded. Deferring the whole
pressure-test until after inventory ships defeats its purpose, because by then the contract will
have hardened around inventory's shape.

**On the frontend dependency rule.** The rule is "renders nothing," not "these two packages are
excused." It is stated as a rule so future dependency questions have a principled answer rather
than requiring a fresh negotiation. Anything shipping DOM or CSS remains barred.

**On the ledger projection.** The `stock_levels` projection is the one place in inventory where
correctness depends on getting transactional behavior exactly right. It warrants the most careful
implementation and the most adversarial tests in the suite — concurrent movements, transfers, and
reversals in particular.

**Alternative considered and rejected: charting this as a wayfinder map.** The foundation
decisions were originally being charted as a decision map with research tickets and a blocking
graph. That path was set aside in favour of committing to defaults now and building. The tradeoff
is real — the defaults above carry less validation than a resolved decision ticket would — and it
is the reason each one is marked rather than presented as settled.
