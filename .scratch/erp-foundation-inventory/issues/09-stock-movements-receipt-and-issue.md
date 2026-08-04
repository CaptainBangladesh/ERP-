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

**Status:** ready-for-agent

- [ ] I can record a receipt of a product into a location, increasing stock
- [ ] I can record an issue of a product from a location, decreasing stock
- [ ] Receipt and issue are separate, intent-named actions, not one generic movement form
- [ ] Every movement records the acting user and the time it happened
- [ ] Movements are append-only: no route updates or deletes one
- [ ] Stock levels update in the same transaction as the movement that caused them
- [ ] Stock levels always reconcile with the sum of the ledger
- [ ] Every movement carries the value and accounting classification an entry would need
- [ ] A movement emits an in-process event carrying enough detail to post an entry later
- [ ] Inventory has no dependency on any accounting module, and none exists
- [ ] I can view current stock for a product across all locations
- [ ] I can view all stock held at one location
- [ ] I can view a product's movement history, filtered by date, type and location
- [ ] With no locations yet, the movement screen sends me to create one instead of failing
- [ ] Movement forms validate quantity and required fields with field-level errors
- [ ] Stock screens refresh automatically after a movement is recorded
- [ ] Backend tests cover receipt, issue, resulting levels, immutability, history and events
- [ ] Frontend tests cover recording a movement, validation, history and the no-locations state

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
