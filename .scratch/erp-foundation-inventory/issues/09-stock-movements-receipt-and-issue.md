# 09 — Stock movements: receipt and issue

**What to build:** The heart of the module. I can record goods arriving and goods leaving, and see
stock levels change as a result. Every movement is written to a permanent ledger recording what
moved, where, how much, who did it and when — never edited or deleted afterwards. I can open a
product and read its full movement history, and the quantity on screen always reconciles with it.

Every movement also carries the value and accounting classification a journal entry would need, and
emits an event describing it. No accounting module is built, and inventory depends on none. This is
the seam: Accounting is the sink that Sales, Purchase, Payroll and Manufacturing all eventually
write to, and sinks are the expensive retrofit. Without the seam, adding it later means reopening
every movement type and backfilling history.

**Blocked by:** 08 — Inventory: locations

**Status:** done

- [x] I can record a receipt of a product into a location, increasing stock
- [x] I can record an issue of a product from a location, decreasing stock
- [x] Receipt and issue are separate, intent-named actions, not one generic movement form
- [x] Every movement records the acting user and the time it happened
- [x] Movements are append-only: no route updates or deletes one
- [x] Stock levels update in the same transaction as the movement that caused them
- [x] Stock levels always reconcile with the sum of the ledger
- [x] Every movement carries the value and accounting classification an entry would need
- [x] A movement emits an in-process event carrying enough detail to post an entry later
- [x] Inventory has no dependency on any accounting module, and none exists
- [x] I can view current stock for a product across all locations
- [x] I can view all stock held at one location
- [x] I can view a product's movement history, filtered by date, type and location
- [x] With no locations yet, the movement screen sends me to create one instead of failing
- [x] Movement forms validate quantity and required fields with field-level errors
- [x] Stock screens refresh automatically after a movement is recorded
- [x] Backend tests cover receipt, issue, resulting levels, immutability, history and events
- [x] Frontend tests cover recording a movement, validation, history and the no-locations state

## Comments

**Inherited from ticket 08: `LocationsService.productsHeldAt` returns zero and must stop.** The
refusal that stops somewhere holding stock being deactivated is already written — the rule, the
`location_holds_stock` code, the message, and the screen that shows it. The only part ticket 08
could not build is the count itself, because nothing could put stock into a location until this
ticket. Replace that method's body with a count over the ledger and the rule becomes live; add a
backend test that receives stock into a location and is then refused the deactivation, which is
the test ticket 08 had no way to write.

**Also inherited: inventory's dependency on products is declared and unused.** `ProductCatalogue`
is what a movement resolves what moved through — `warranties.service.ts` is the worked example.
`InventoryModule` imports `ProductsModule` here for the first time.

---

**Both inherited items are done.** `productsHeldAt` moved to `StockService` and counts stock
levels that are not zero; ticket 08's last unticked criterion is now ticked, with the test it
could not write. `InventoryModule` imports `ProductsModule`, and every movement resolves what
moved through `ProductCatalogue`.

**The accounting seam is ADR 0008**, along with four other decisions this ticket had to settle:
what a movement freezes, how a module announces something to a module that does not exist yet,
why stock levels are a table rather than a sum, and why the acting user's *name* is copied onto
the ledger rather than looked up. Read that before ticket 13, which has to assert the equality
this ticket makes possible.

**Two things are deliberately left for the tickets that own them**, and neither is an oversight:

- **Negative stock is permitted.** Ticket 11 owns the policy and the company setting behind it.
  Refusing it here would have meant inventing a default this ticket has no criterion for. Note
  that `productsHeldAt` counts a negative level as *held*, so a location with a discrepancy
  cannot be quietly closed.
- **The read-then-write on `StockLevel` is a lost update under concurrency.** Ticket 12 owns it,
  and it is worth stating bluntly rather than reassuringly: two requests moving the same product
  at the same place can both read one quantity and both write their own, and the second silently
  overwrites the first. The unique constraint on `(company, product, location)` covers only the
  *first* movement for a pair; after that nothing trips. It is survivable only because the level
  is a cache — both movements reach the ledger regardless, so the right number is recoverable by
  summing it, which is the reconciliation check ticket 12 is already scoped to build.

**What ticket 10 will want to know.** `SHAPE` in `movements.service.ts` is the table mapping a
movement kind to its direction and classification, and adding an adjustment or a transfer should
be a row in it rather than a new branch anywhere. `MOVEMENT_CLASSIFICATIONS` will need a third
value for a transfer, which posts nothing at all because both sides are inventory.

**A known limit, carried deliberately.** The product and location dropdowns on both screens ask
for `pageSize: 100`, so a company with more than a hundred products cannot record a movement
against the hundred-and-first. That is the same cap `ProductsPage` already applies to its unit
picker, so this ticket followed the established pattern rather than inventing a second one — but
the pattern is now on its third screen and is the wrong shape for a real catalogue. The fix is a
type-ahead that queries as you type, which is a shared-component change and its own piece of
work. Worth raising before ticket 13 rather than after.
