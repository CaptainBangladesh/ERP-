# 0009 — The foundation audit against the module roadmap

**Status:** Accepted, 2026-08-04 (ticket 14)

## Context

Inventory is finished. The question this ticket exists to answer is whether the foundation is
*ready for the next thirty-nine modules* or merely *finished for inventory*, and it is asked
now because the answer stops being cheap the moment a second business module starts copying
whatever is here.

The two shape stubs have been pushing against every decision since tickets 03 and 07, so this
was expected to be a confirmation pass rather than a discovery pass. Mostly it was. Four
things it found were not confirmations, and one of them is the kind of finding the stubs were
supposed to prevent — which is itself a result about the stubs.

The check runs the contract against the shapes the roadmap actually contains: Sales and
Purchase (depend on Parties, Products and Inventory, and post to Accounting), Accounting (a
sink every module writes to), HRM and payroll (periodic, sensitive, immutable), Manufacturing
(consumes and produces stock), E-commerce (external traffic, eventual consistency with stock),
and industry add-ons (optional, extend without editing).

The audit's own evidence is `backend/test/roadmap-audit.spec.ts`: those shapes declared as
manifests and handed to the same `assembleModules` the build runs. It builds no module and
boots nothing. It exists because a conclusion recorded only in an ADR is a conclusion that
stops being true quietly, and two of the conclusions below are refusals that a later ticket
has to change deliberately rather than discover.

## Decision

### The conclusion, first

**The foundation is ready for the second business module, with one exclusion: that module
must not be Accounting.** Sales, Purchase, Manufacturing, E-commerce and any industry add-on
can be built on the contract exactly as it stands — the assembler orders them, the tiers
permit them, the boundary rules describe them, and the deletion test holds for all of them.
Accounting is the one roadmap shape the contract gets wrong today, and finding 1 is why.

Four findings carry a ticket each — three of them expensive to defer, one small enough that
only ticket 14's own "no modules are built" keeps it out of this change. Everything else is
recorded here as understood and accepted, with the trigger that would reopen it.

### Finding 1 — a sink cannot listen without becoming a dependant (issue 15)

`assembleModules` refuses a consumed event that no *declared dependency* emits. That rule is
right about what it was written for — an undeclared edge makes the module graph describe
something other than the code — but `dependsOn` is one edge doing two jobs, and a sink needs
only one of them.

Accounting listens and nothing listens to it. It injects no service, calls no method, and
reads no table; it binds to a name in a wire contract and a payload shape. Making it declare
`dependsOn: ['inventory', 'sales', 'purchase', 'hrm', 'manufacturing', …]` buys three
consequences it should not have:

- **The deletion test fails in the sink's direction.** Excluding a business module has to
  leave the application building — that is the spec's test and the property the whole module
  contract preserves. Remove inventory and Accounting refuses to assemble, naming a module it
  never called a method on. The listener is the one thing that genuinely does not care whether
  the emitter is present: an event that is never emitted is simply never heard.
- **Listening drags the emitter's tier along.** `checkTier` refuses a Core module depending on
  an Enterprise one, so Accounting cannot be Core while it also hears `hrm.pay-run.calculated`.
  A Core-tier company runs Inventory, Sales and Purchase — all of which emit exactly what a
  ledger wants — and cannot have a general ledger, for no better reason than payroll being an
  upsell.
- **It is the wrong shape to copy thirty-nine times.** Every later listener inherits it, and
  the fan-in makes Accounting's declared dependency list the largest in the system while its
  actual coupling is the smallest.

The fix is a distinction the manifest does not currently draw: a dependency that is a *service*
edge (may inject, must be present, constrains tier) against one that is an *event* edge (may
listen, need not be present, does not constrain tier). It is one manifest field, one branch in
`checkEventsAreDeclared`, one in `checkTier`, and one in the import rule that today reads
`dependsOn` as permission to import. **Cheap now, and forty modules' worth of wrong edges
later** — which is exactly the class of thing this ticket exists to find. Issue 15.

**This is the finding the shape stubs did not produce, and the reason is worth recording.**
**Neither stub listens, and neither is listened to.** `hrm` and `warranties` both declare
`events: { emits: [], consumes: [] }`, and what the add-on stub proves is consumption of a
*service* — `ProductCatalogue` — rather than of an event. So nothing in the foundation has
ever consumed an event, and the one rule governing consumption has never had a case run
against it. The stubs were dissimilar in tier, in sensitivity, in periodicity and in
optionality, and identical in *direction*: both sit at the end of a dependency arrow rather
than at the end of an event. A third stub shaped like a sink would have caught this at
ticket 09.

### Finding 2 — concurrency is an in-process lock, and a build check is what chose it (issue 16)

Ticket 12 serialises movements with `ResourceLockManager` in `movements.service.ts`: a
`Map` of promises keyed on `productId:locationId`, held by the singleton service. It is
correct, deadlock-free by sorting keys, and it does not block unrelated products. It is also
in-process, and it says in its own comment why it is: `check:tenancy` refuses `$queryRaw` and
`$executeRaw` anywhere outside the test harness, so `SELECT … FOR UPDATE` was not available.

Two things follow, and the second is the one that matters.

The narrow one: an in-process mutex is a correct answer for exactly one process. A second
backend instance — a second container, a worker, a blue/green overlap during a deploy —
silently reintroduces the lost update ADR 0008 described, with no error and no test failing.
The ledger still makes it recoverable and `GET /stock/reconcile` still finds it, so this is a
bounded and detectable divergence rather than a silent corruption. But "correct provided the
process count is one" is a deployment constraint nothing in the repository states.

The broad one: **ADR 0003 named the trigger that brings row-level security forward as "the
first legitimate need for raw SQL against a company-owned table", and said it would be
revisited here. That need arrived in ticket 12 and was routed around rather than recognised.**
A check written to keep tenancy auditable in one place ended up selecting the concurrency
mechanism for the module it was not about. That is the check working as designed and the
design having a consequence nobody priced: `check:tenancy` is not a rule about raw SQL, it is
a rule that says *the extension is the only enforcement*, and the honest way to hold that rule
while taking a row lock is to put the enforcement somewhere the raw statement cannot escape.

A third thing, found by running the suite rather than by reading it, and small enough to fix
here: `movements.spec.ts`'s concurrent-transfer test was intermittently failing. **Serialising
concurrent work does not order it.** The lock guarantees that two transfers sharing a location
never interleave and guarantees nothing about which goes first, and the test moved stock A→B, A→C
and B→C at once — so whenever B→C won the lock on B first it found B empty and was refused, which
is the correct answer to the question it actually asked. The test now stocks B up front, so all
three transfers are valid in all six orderings and what is asserted is what its name claims:
three transfers contending pairwise conserve the total and cannot deadlock. Worth recording
because the distinction is easy to lose and every module that serialises anything will meet it.

**RLS is therefore brought forward from "accepted in principle and deferred" to a ticket.**
Not because tenancy has leaked — it has not, and the extension is exercised by
`tenancy.spec.ts` against a real database — but because the alternative to layering it is a
second concurrency mechanism per module for as long as raw SQL stays unavailable, and because
the plumbing ADR 0003 declined to pay for ("every request inside a transaction, a non-superuser
application role") is now paid against a system with a real ledger rather than against one
whose only sensitive table was a stub. Issue 16 owns the work and owns the decision of whether
the answer is RLS, a narrowly scoped raw-SQL exception with the reason written down in the
`withoutCompanyScope` spirit, or an advisory lock. What is settled here is that the status quo
— an in-process lock, chosen by a check, undocumented as a deployment constraint — does not
survive the roadmap.

### Finding 3 — the index obligation is a sentence, and it has already drifted twice (issue 17)

ADR 0004 chose offset paging over cursors, and the argument turned on one condition stated as
"a real obligation and not a hope": every list endpoint's default sort carries an index on
`(company_id, <sort column>)`. Without it the database sorts the whole company's rows to answer
for twenty-five of them, and the offset is then the least of it.

Nothing checks it. Six modules in, two endpoints do not have it:

- `USER_LIST` defaults to sorting by `name`; `users` carries only `@@index([companyId])`.
- `INVITATION_LIST` defaults to `-createdAt`; `invitations` carries `[companyId]` and
  `[email]`.

Both are the least consequential possible instances — a company has between twenty and five
hundred users and fewer pending invitations, so neither will ever be slow — and that is the
argument, not a mitigation. The obligation drifted precisely where nobody would notice, which
is what a convention does. On `stock_movements`, where the roadmap expects six figures of rows
per company, it was not forgotten; the difference between those cases is attention, and
attention is what does not scale to forty modules.

The check is mechanical: every module declares its `ListSpec` with a `defaultSort`, and the
Prisma datamodel declares its indexes. Comparing them is the same shape of static check as
every other rule in the pack. Issue 17.

### Finding 4 — money is summed as `Decimal`, which is where the currency goes (issue 18)

Ticket 04 left this for the audit to price: `Money` carries its currency everywhere it travels
and refuses arithmetic across two of them, but a *newly created* value takes its currency from
`DEFAULT_CURRENCY`. The question was whether that stays acceptable against the roadmap.

**It stays acceptable. Multi-currency remains out of scope and the constant remains the answer
until Purchase prices in a supplier's currency, at which point the change is a column on
`companies`, a field on the session principal, and the callers of one constant — not a change
to the type.** That half of the ticket 04 gap is priced and closed.

The audit found the other half, which is not what ticket 04 described. `StockService.getValuation`
adds monetary amounts by taking `MoneyValue.amount`, parsing it to a `Decimal`, summing the
`Decimal`s, and re-wrapping the total with `Money.of(total)` — which supplies `DEFAULT_CURRENCY`.
The per-product figure keeps the cost's own currency; the company total and every location
total assume the default. Today every product cost is created in `DEFAULT_CURRENCY`, so every
number is right and no test can tell.

The point is not the arithmetic, it is the guarantee. `Money.plus` refusing a currency mismatch
is the whole of what makes "carried rather than assumed" enforceable, and dropping to `Decimal`
to do the sum steps around it. The first supplier priced in EUR turns a refusal into a total
labelled GBP. **This is the retrofit ticket 04 said was expensive, quietly reintroduced in the
one module that does the most arithmetic**, and it is three lines to close: sum `Money`, let it
refuse, and start the accumulator from the first value's currency rather than from a constant.
It is a ticket rather than an edit here because ticket 14 builds nothing. Issue 18.

### What the audit confirmed, shape by shape

**A periodic, calculation-driven module.** Confirmed. `HrmService.calculatePayRun` computes
over a date range, refuses rather than computing over values the caller may not read, writes
immutable rows, and does its arithmetic in exact decimal with one stated rounding point. It
needs nothing the contract does not offer. What it does not have is a **scheduler**: a pay run
is an HTTP request somebody makes. Background jobs are explicitly deferred by the spec, and the
expensive half of that seam is already built — `Tenancy.runInCompany` exists precisely so work
outside a request can act as a company, and `DomainEvents.emit` names it in its refusal. The
trigger to build the rest is the first module that must do something *nobody asked for at that
moment*: a payroll run on a schedule, an e-commerce stock reconciliation, a dunning notice.

**Sensitive personal data and stricter access.** Confirmed, and the strongest part of the
foundation. `company-owned.ts` marks a field restricted by a grant and a *record* restricted by
a flag and a grant, both ANDed into `where` so a restricted row is unreachable by its own
identifier rather than merely absent from a list; a restricted field named in a sort, a filter,
an `orderBy`, a `groupBy` or across a relation throws, and the throw is translated to a 403 at
the boundary. Payroll's two hard cases — the column nobody below a level may read, and the
individual whose whole file is confidential — are both live in the stub. Nothing here is
inventory-shaped, because inventory has neither.

**A module only some staff may access at all.** Confirmed. Denying a module wholesale is
holding none of its permission strings, which is one click on the role screen, and it needs no
second mechanism because a permission's own prefix is what identifies its module.
`AccessGuard` refuses a handler declaring nothing, and `permission-declared` in the conformance
pack makes an unguarded handler a build failure rather than something noticed the day a role is
narrowed.

**A legally-mandated immutable trail.** Confirmed for the ledgers, with one tension recorded.
`immutable: true` refuses update, upsert and delete at the platform before the query is issued,
and it is declared on `PayRun`, `PayRunLine` and `StockMovement` — arrived at from payroll's
direction and inventory's independently, which is the stub earning its keep. A movement freezes
the actor's name, the unit and the value at the moment it happened, so history stays readable
after a person leaves and after a price is corrected.

The tension is between an immutable personal record and a right to erasure. A pay run line
naming an employee cannot be deleted, and `RESTRICT` on the employee makes that explicit rather
than silent. That is the correct behaviour for a payroll record — retention law generally wins
over erasure for exactly these rows — but it is a decision somebody should make on purpose per
table rather than inherit from a flag. It is recorded here, not ticketed: nothing about it is
expensive to retrofit, because the flag is per-model and the argument is per-model.

What does not exist is a **general** audit trail — who read what, who changed what, across
every table. `createdAt`/`updatedAt` are on most models and neither is enforced. That is
correctly out of scope: the roadmap's compliance requirement is immutable *ledgers*, which
exist, and a change-data-capture trail across forty modules is a platform feature with its own
spec rather than something to half-build now.

**A module every other module writes to.** This is finding 1. Everything about the seam *below*
the dependency edge is right: the classification is `stock-in`/`stock-out` rather than an
account code, so inventory does not guess at a chart of accounts in a column it can never edit;
the value is frozen and signed, so summing the ledger gives what the stock is worth; the value
is null rather than zero when nobody has recorded a cost; the event is emitted after commit,
carries the company stamped by the platform, and a listener that throws does not undo the fact.
A future Accounting module can replay every movement recorded before it existed, from the rows.
The one thing wrong is how it would have to declare that it is listening.

**A module reading across boundaries.** Confirmed for the mechanism. `ProductCatalogue` and
`PartyDirectory` are abstract classes in a module's `index.ts`, bound to the service in the
Nest module; `warranties` consumes one without importing anything else from `products`, and the
pack refuses the alternatives — reaching past a surface, querying a table another manifest
claims, importing a module `dependsOn` does not name.

Two things are absent and both are correctly absent. Inventory exposes no *write* contract, so
Sales and Purchase and Manufacturing have nothing to record a movement through yet; `index.ts`
says why, and the reason is that a contract written before its first consumer is a guess. And
there is no path by which an **anonymous** request establishes a company: the storefront half of
E-commerce is external traffic with no session, and every query throws without a tenant context.
The mechanism for it exists — `runInCompany` — and wiring a middleware to resolve a company from
a host or a shop key is one place, so this is a module's work rather than a foundation gap. It
is named here so that whoever builds E-commerce does not discover it as a surprise.

**A module absent for some companies.** Confirmed, twice over. `warranties` is Custom tier and a
Core company is refused `module_unavailable` before the permission is even checked; the tier is
read fresh from the database on every request, so changing a company's tier changes what it can
reach without a restart; navigation filters on the same two facts in the same one place; and no
module contains the word "tier". The roadmap-audit spec adds the general case — an add-on
depends on what it extends, is depended on by nothing, and its removal leaves everything it
extended assembling untouched.

**An add-on that must not edit what it extends.** Confirmed on the backend, with a deliberate
frontend limitation. `warranties` extends `products` through `ProductCatalogue` and could not
edit it if it tried. On the frontend, `checkFrontendModules` refuses *any* cross-module screen
import, so an add-on cannot render inside another module's page — it gets its own route and its
own navigation entry, and nothing else. That is a real constraint on what an industry add-on can
look like: no extra tab on the product detail screen, no extra column in the product list. It is
accepted rather than fixed, because the alternative is an extension-point registry that every
screen in forty modules has to be written against, and because the spec's out-of-scope list
already bars third-party add-ons — everything here is in-house, so an add-on that genuinely
needs to appear inside another module's screen is an argument for changing that module. The
trigger to revisit is the second add-on that wants it.

**Module dependency ordering against the roadmap's real graph.** Confirmed. Sales and Purchase
over Parties, Products and Inventory; Manufacturing above Inventory from Enterprise; E-commerce
over Products, Inventory and Sales; add-ons above everything from Custom — all assemble, all
order deterministically, and the back-edges somebody would eventually be tempted to add are
refused by name. The tier rule and the cycle check between them cover the graph the roadmap
describes, with Accounting the exception finding 1 covers.

### What the conformance pack fails to catch

Reviewed, as ticket 14 asks. The pack is a build refusing an ordinary mistake, not a sandbox —
ADR 0005 says so, and this is the list of what that means today.

- **Nothing ties an event to its declaration.** `assembleModules` checks `emits` against
  `consumes`, and nothing checks either against the code. A module can `emit` a name it never
  declared, or a name with a typo in it, and the event is simply never heard — the quietest
  possible failure, in the one seam built for a module that does not exist yet. This is the
  same class of gap as `permission-declared` before ticket 07 filled it, and it is folded into
  issue 15, which is already changing how event edges are declared.
- **Nothing checks a default sort against an index.** Finding 3; issue 17.
- **The rules read text.** A delegate aliased through a variable defeats the table rule; an
  import specifier assembled from fragments defeats the import rule; `assertNegativeStockPolicy`
  takes `tx: any`, which no rule has an opinion about. Accepted, and the same trade
  `check-tenancy.mjs` already makes.
- **`permission-declared` proves a handler declares *something*, never that it declares the
  right thing.** `@RequirePermission('inventory:stock:read')` on a handler that writes passes
  the pack. Only a test can catch that, and `tiers.spec.ts` and `roles.spec.ts` are where it is
  caught for the endpoints they cover.
- **Restriction is enforced at runtime, not at build time.** A module reading a restricted field
  it may not read throws when the query runs, not when the code is written. That is by design —
  ADR 0004 rejected a build-time second opinion because two copies of the restriction table
  eventually disagree — and it is worth knowing it is a runtime guarantee.
- **The frontend is checked for cross-module imports and nothing else.** No rule stops a screen
  calling another module's API path directly, which would be an undeclared edge the backend pack
  would never see. Low value today because every path is a constant in the shared contract, and
  worth a rule if a screen ever writes a URL by hand.
- **Migrations are outside every check.** ADR 0003 already records this for tenancy: a migration
  that moves rows between companies is not something the extension can see. It is also not
  something the pack can see, and it is part of what issue 16 closes.

## Consequences

- **The second business module can start, and it is not Accounting.** Sales or Purchase is the
  natural next one; either exercises the write contract inventory has deliberately not written.
- **Three issues carry the expensive gaps** — 15 (event edges), 16 (RLS and the concurrency
  mechanism), 17 (the index check) — and one carries a small one, 18 (summing money as money).
  15 blocks Accounting specifically; none of the others blocks a module.
- **`backend/test/roadmap-audit.spec.ts` asserts today's behaviour, including the two refusals
  that are findings.** It will fail when issue 15 lands, deliberately: the failing assertions are
  the specification of what issue 15 has to change, and a test that had been written aspirationally
  would have been a test nobody could run today.
- **The stubs stay, and a third is not added.** A sink-shaped stub would have caught finding 1,
  and adding one now would be building the counter-example after the fact rather than before it.
  What is recorded instead is the reason it was missed — both stubs point the same direction —
  so that the next foundation is asked about direction as well as about tier, sensitivity,
  periodicity and optionality.
- **ADR 0003's deferral of RLS is superseded** by issue 16. ADR 0004's currency decision is
  confirmed as written, and its list-index obligation is superseded by issue 17.

## Alternatives considered

**Fixing findings 1 and 4 in this ticket rather than raising them.** Tempting for finding 4,
which is three lines. Rejected on the ticket's own terms — "no modules are built; the output is
recorded decisions and follow-up tickets" — and on a better reason for finding 1: changing how
every module declares an event edge is a contract change that wants its own tests, its own
generator template update and its own review, and folding it into an audit would mean the audit
that found it was also the audit that judged the fix.

**Declaring the foundation not ready, and blocking on 15.** Rejected. Finding 1 is real and
bounded: it is wrong for listeners, and no module in the roadmap other than Accounting is
primarily a listener. Sales, Purchase, Manufacturing and E-commerce all depend on things in the
ordinary way the contract already handles, and holding them behind an Accounting-shaped problem
would be paying the cost of the finding twice.

**Recording the audit as prose only.** Rejected. Two of its conclusions are behaviours of a pure
function that the build already runs, and the difference between "we checked" and "it is checked"
is one spec file that runs in two seconds. The precedent is `test/module-contract.spec.ts`, which
exists for the same reason: the assembler's deliverable is its refusals.
