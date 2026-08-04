# 0008 — Movements carry their accounting, and announce themselves

**Status:** Accepted, 2026-08-04 (ticket 09)

## Context

Inventory's ledger is the first place in this system where something *happens* that another
module will eventually need to know about. Every ticket before this one built things that are
asked questions — a catalogue, an address book, a list of places. A stock movement is different:
it is an event, and the module that most wants to hear about it is Accounting, which does not
exist and is not in this ticket.

That combination is the whole problem. The spec calls Accounting a **sink**: Sales, Purchase,
Payroll and Manufacturing all eventually post to it. A sink is the expensive retrofit, because
adding one later means reopening every module that should have been telling it things and
backfilling history nobody recorded. The cost is not writing the Accounting module; it is
discovering that three years of stock movements never recorded what they were worth.

Five questions were open, and each had a plausible answer that would have been expensive at
forty modules.

1. **What does a movement carry so that a journal entry can be posted from it later, without
   inventory knowing what a journal entry is?**
2. **How does one module tell another that something happened, when the other one does not
   exist?**
3. **Is the stock level a table, or is it the sum of the ledger computed on demand?**
4. **How does a movement record who made it, when identity's public surface is empty by design?**
5. **What stops a ledger being edited?**

## Decision

### 1. Two frozen columns: a value, and a classification

Every movement stores `unitCost`, `value` and `classification` at the moment it is recorded.

`classification` is `stock-in` or `stock-out` — deliberately **not** an account code and
deliberately not a debit/credit pair. Which nominal account `stock-in` posts to is a
chart-of-accounts decision, and a chart of accounts belongs to the module that does not exist.
What inventory legitimately knows is that stock went up against something outside inventory, or
down against something outside inventory. Anything more would be inventory guessing at
Accounting's design and being wrong in a column that is permanent.

`value` is signed with the quantity, so summing the ledger gives what the stock is worth — which
is exactly the equality ticket 13's valuation has to assert. It is **frozen** rather than
recomputed from the product's current cost, because a ledger records what something was worth
*then*: recomputing would silently restate history every time somebody corrected a price.

`value` and `unitCost` are **null**, never zero, when the product has no recorded cost. A cost of
zero is a claim that something is worthless; "nobody has said" is not that claim, and ticket 13
cannot tell them apart if the ledger has already flattened them.

### 2. An in-process event seam in the platform, with the names in the module's contract

`platform/events` declares `DomainEvents` — an injectable with a `Map` of listeners. Inventory
emits `inventory.movement.recorded`; nothing consumes it, which is the seam working rather than
the seam missing.

**The platform owns the mechanism and the module owns the names.** The event name and its
payload shape live in `packages/src/modules/inventory/contract.ts`, so a future Accounting module
binds to a declared promise rather than to a class inside inventory. The manifest's existing
`events.emits` / `events.consumes` fields — declared since ticket 02 and empty until now — are
what `assembleModules` checks: a consumed event no declared dependency emits fails the build,
without a database.

Three properties, each a decision:

- **The company is stamped by the platform, not written by the module.** `DomainEvents` reads it
  from the acting tenant scope, exactly as the Prisma extension does. A module that could write
  the company onto an event could forget to, and an event reaching a listener without one is an
  entry posted against nobody. It also keeps the module free of the `companyId` token that the
  conformance pack refuses.
- **Emitted after the transaction commits, never inside it.** A listener inside the write would
  see a movement that could still roll back, and a slow one would hold a row lock open.
- **A listener that throws does not undo what happened.** The movement is the fact; a journal
  entry derived from it is a consequence. Rolling back the fact would make recording stock depend
  on Accounting working, which is precisely the dependency direction this seam exists to prevent.
  Failures are logged loudly, and the ledger is what makes them recoverable — a listener that
  missed an event can replay from the rows, which is what a future Accounting module will do for
  every movement recorded before it existed.

Not a message broker, and not a queue. There is one process; the durability a queue would buy is
already bought by the ledger.

### 3. A `StockLevel` table, written in the same transaction as the movement

The alternative — summing the ledger on demand — is correct by construction and gets slower
every day the business trades. A table is a projection, and a projection can disagree with what
it projects, so the bargain is that it is **only ever written inside the transaction that writes
the movement causing it**, and never anywhere else. `StockService` is read-only; there is no
endpoint that sets a level.

`movements.spec.ts` asserts reconciliation after a twenty-movement mixed sequence across two
locations rather than after one receipt, because a projection that is wrong by a fixed amount
passes every single-movement test ever written.

The read-then-write inside that transaction is **a lost update under concurrency**, and it is
ticket 12's to fix. It should be described accurately rather than reassuringly: two requests
moving the same product at the same place can both read one quantity and both write their own
answer, and the second silently overwrites the first. The unique constraint on
`(company, product, location)` covers only the *first* movement for a pair — after that, which is
the ordinary case, nothing trips.

What makes it survivable is that the level is a cache and the ledger is the record. Both movements
are written whatever happens to the level, so the correct quantity is always recoverable by summing
the rows — which is exactly the reconciliation check ticket 12 builds. Accepting a known, bounded,
recoverable divergence for one ticket is a different thing from not having noticed it, and the
comment in `movements.service.ts` says so in those terms.

### 4. The acting user's name is copied onto the row

Identity's public surface is deliberately empty: a module asks the *platform* who is asking, and
never asks identity who somebody *was*. So there is no contract through which inventory could
resolve a user identifier later, by design rather than by omission.

Freezing the name is also simply the right column for an audit trail. An entry that renamed
people retroactively would report that somebody recorded a movement under a surname they did not
have that year, and a person leaving the company should not make three years of history
unreadable.

`unitCode` is frozen for the same reason and a second one: a quantity without its unit is not a
number anybody can act on, and resolving one would need a units dictionary that `ProductCatalogue`
does not offer and should not have to.

The product's and the location's names are resolved **live**, deliberately differently. Those
label rows that still exist and are still maintained, and a reader wants to recognise them by
what they are called now.

### 5. Two independent refusals

`StockMovement` is declared `immutable: true` in `platform/tenancy/company-owned.ts`, so `update`,
`upsert` and `delete` are refused by the platform before the query is issued. And the controller
has no `PATCH` and no `DELETE`.

Both, because they fail differently. "There is no endpoint" is a fact about today's controller and
somebody adds an endpoint; "the table refuses updates" is a fact about the system. `movements.spec.ts`
asserts each separately for that reason.

## Consequences

- Inventory finally *uses* the dependency on products it has declared since ticket 08.
  `ProductCatalogue` resolves what moved and in what unit; nothing in inventory reads a products
  table.
- `LocationsService.productsHeldAt` is real, and `location_holds_stock` is live — the criterion
  ticket 08 left unticked because nothing could put stock anywhere yet. Levels at exactly zero do
  not count as held, which is what makes a location closable after being emptied.
- The `Field` primitive gained `type="date"`. A date box knows nothing about what is being dated,
  so it stays a primitive; it holds `YYYY-MM-DD`, which is exactly what the list convention reads
  a date filter in, so no screen formats anything.
- **Negative stock is permitted.** Ticket 11 owns that policy, and pre-empting it here would have
  meant building a company setting this ticket has no criterion for. `StockService.productsHeldAt`
  counts a negative level as held, deliberately: a location showing −3 has a discrepancy somebody
  must resolve, and closing it would file that discrepancy where nobody looks.
- Three permissions rather than one — `locations`, `movements` and `stock` are three jobs.
  `inventory:stock:read` has no write counterpart, because there is no way to set a level.
- Ticket 13's valuation has what it needs: the equality it must assert is between the levels and
  the sum of `value` over the ledger, and both sides exist from this ticket onward.

## Alternatives considered

**Computing stock levels from the ledger on every read.** Rejected on performance, but the more
interesting reason is that it would have hidden the problem ticket 12 exists to solve rather than
solving it. A projection makes the reconciliation question explicit and testable.

**A generic `POST /api/movements` taking a direction.** Rejected: receiving goods and issuing them
are different acts done by different people, and one endpoint taking a `kind` turns "did you mean
to take this out?" into a validation question when it is a question the caller already answered by
choosing what to call. It would also have made a signed quantity the caller's business, which is
the one rule that makes every stock figure right.

**Emitting the event inside the transaction.** Rejected — see decision 2. The variant worth naming
is a transactional outbox: a row written in the same transaction and delivered afterwards. That is
the right answer when delivery must be guaranteed across a process boundary, and it is not needed
here because the ledger *is* the outbox — every movement is already a durable, ordered, replayable
record of exactly what a listener would have been told.

**Storing a debit/credit account pair on each movement.** Rejected as inventory guessing at
Accounting's chart of accounts, in a column that can never be edited.

**Depending on identity to resolve `recordedById` into a name.** Rejected on the architecture's own
terms — identity exports nothing, and forty modules acquiring a dependency on the one module they
would all otherwise name is exactly what `SessionAuthority` was built to prevent.
