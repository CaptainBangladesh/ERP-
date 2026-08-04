# 19 — What tickets 11 to 13 left behind

**What to build:** The unfinished half of the negative-stock policy, and the cleanup of what
tickets 11, 12 and 13 left in inventory. None of it is a new feature; all of it is work those
three tickets claimed and did not do, or did in a way that contradicts something written down.

The work was found in the tree uncommitted, marked done, with every box ticked. Ticket 14's
review is what read it. The correctness bugs were fixed on the spot as part of that ticket — the
rest is here, because it is more than a review pass should absorb and because two items are
design decisions somebody should make deliberately.

**Blocked by:** 14 — Foundation audit against the module roadmap

**Status:** ready-for-agent

### The three criteria ticket 11 claimed and did not meet

The whole permissive branch of the negative-stock policy. It only shows up for a company that has
chosen to allow negative stock, which is not the default, which is why nothing noticed.

- [ ] A movement that drives stock negative under the permissive policy warns the person recording it
- [ ] The warning appears before the movement is recorded, not only after
- [ ] The movement response says a movement went negative, so a screen has something to warn from
- [ ] `ValuationPage` shows a negative quantity as distinctly as `StockPage` does
- [ ] `StockPage.test.tsx` covers the negative display that already exists and is untested
- [ ] Frontend tests cover the warning at both moments

### Two decisions to make, not just code to write

- [ ] **`InventorySetting` has a foreign key to `companies`, and adds a back-relation to identity's
      `Company` model.** `docs/tenancy.md` step 1 of "Adding a company-owned table" says: "No
      foreign key to `companies` — keys stay inside a module." Every other company-owned table in
      the schema obeys it; this one does not, and the `inventorySetting InventorySetting?` field it
      added to `Company` is inventory reaching into identity's model. Either drop both by migration,
      or amend `docs/tenancy.md` and say why the rule has an exception. Do not leave it silently
      divergent.
- [ ] **`inventory:stock:write` guards the settings endpoint.** ADR 0008 records that
      `inventory:stock:read` has "no write counterpart, because there is no way to set a level" —
      and now there is a write permission, guarding a different resource. Permissions are
      `<module>:<resource>:<action>`, so this is `inventory:settings:*`. Either rename it and amend
      ADR 0008, or record why settings belong to the `stock` resource.

### Cleanup

- [ ] `recordMovement`, `recordAdjustment`, `recordTransfer` (twice) and `reverse` (twice) each
      contain the same create-movement-then-upsert-level block. Extract one `applyMovement(tx, …)`
- [ ] `` `${productId}:${locationId}` `` is built in eight places across two files, as a lock key
      and as a map key. It wants a type
- [ ] `assertNegativeStockPolicy` reads the setting through `this.prisma` rather than the `tx` it
      is handed, so the policy read sits outside the transaction it guards
- [ ] `reconcile()` and `getValuation()` both `findMany()` the entire ledger with no paging. ADR
      0004 names the ledger as the first table expected to pass a hundred thousand rows per company
- [ ] Single-letter and abbreviated identifiers throughout the new code — `m`, `s`, `l`, `p`,
      `loc`, `rev1`/`rev2`, `val`, `arr`, `btn`, `origQty`, `prodCode`, `successMsg`
- [ ] `UpdateInventorySettingsBody` hand-rolls a boolean `rule<boolean>` where `flag()` exists;
      its import is spliced mid-file, orphaning the doc comment above `STOCK_LIST`
- [ ] `StockPage.tsx` gained hand-written `<a>` links to Valuation and Settings, duplicating
      navigation the manifest owns
- [ ] Ticket 13's equality test is one five-movement sequence on one product; the criterion says
      "long, mixed movement sequences"
- [ ] Rationale comments deleted rather than replaced in `inventory.manifest.ts`,
      `stock.controller.ts`, `inventory.module.ts` and the frontend `manifest.ts`

## Comments

**2026-08-04 — what ticket 14 already fixed, so nobody looks for it here.**

Four things were fixed in the ticket 14 commit rather than deferred, because they were defects
rather than debt and because leaving them in a commit somebody was about to make was not
defensible:

- **`Prisma.Decimal.toString()` in three places in `reverse()`** — `unitCost` on both reversal
  writes and `quantity` on the twin-reversal event. `docs/api-conventions.md` and
  `src/prisma/columns.ts` both say `toFixed()` and never `toString()`, because Prisma prints a
  large value in exponential notation and `Decimal.parse` refuses an exponent. It works on every
  value anybody tests with and fails on a large one in production. Now `exactly(...)`.
- **`assertNegativeStockPolicy(tx: any, …)`** — now a named parameter type declaring the one read
  it does.
- **`SHAPE.reversal = { classification: 'stock-in', direction: 'up' }`** — dead and wrong.
  Reversing a receipt is stock-out. Nothing read it, which is why nothing caught it. `SHAPE` is
  now narrowed to the two kinds `record` is actually called with, and its comment says that
  tickets 10 and 11 did not extend it as ticket 09 expected.
- **The settings route written out by hand in three places** — now `INVENTORY_SETTINGS_ROUTE` in
  the shared contract, like its three siblings, and `SettingsService` no longer takes a
  `RequestSession` it never read.

**On ticket 12's missing ADR.** Its criterion "the locking approach and its reasoning are
documented for other modules to follow" is met by a comment on a private class, which is
unusually honest but is not something another module can follow. That is not listed above
because issue 16 is replacing the mechanism outright and will write the ADR for whatever
replaces it.

See ADR 0009 for the audit this came out of, and ticket 11's comments for the three un-ticked
criteria in context.
