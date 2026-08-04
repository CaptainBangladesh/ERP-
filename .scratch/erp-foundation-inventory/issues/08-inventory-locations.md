# 08 — Inventory: locations

**What to build:** The first real business module, and somewhere for stock to live. Inventory is
produced by the generator, declares its dependency on Products, and I can create storage locations
by hand, edit them, and deactivate ones I no longer use.

Nothing is created for me, so on a fresh account the locations screen is empty and tells me to add
my first one. That matters later: when I reach the movement screen with no locations, it must send
me here rather than presenting an unusable form.

**Blocked by:** 07 — Roles, permissions, tiers, and the add-on shape stub

**Status:** done — the stock check was completed by ticket 09, see Comments

- [x] Inventory is produced by the module generator and passes the conformance pack
- [x] Inventory declares its dependency on Products in its manifest
- [x] Inventory reaches Products only through the public contract, enforced by the build
- [x] I can create a location with a name and a code
- [x] Location code is unique within my company
- [x] I can edit a location, and deactivate and reactivate it
- [x] A location holding stock cannot be deactivated without a clear explanation — the refusal
      was built here and made live by ticket 09, which added the count and the test
- [x] The locations screen shows a distinct empty state on a fresh account
- [x] The list uses the shared table with sorting, filtering and paging
- [x] Locations are company-scoped and invisible across companies
- [x] Backend tests cover create, edit, deactivate, uniqueness and isolation
- [x] Frontend tests cover the list, the forms and the empty state

## Comments

**"A location holding stock cannot be deactivated" is built, and cannot fire yet — so its box is
unticked.** The refusal is written where it belongs — in `LocationsService.changeLocation`, on
the way to `status: 'inactive'` — with `location_holds_stock` in the shared contract, a message
that says how much is in the way and what to do about it, and a frontend test asserting the
panel shows that message rather than a button that appears not to work. What it asks,
`productsHeldAt`, answers zero for every location, because nothing can put stock into one until
movements arrive in ticket 09.

That is deliberate rather than a stub left half-done. The alternative was a stock table this
ticket writes nothing into, which would not have made the rule any more testable — over HTTP
there is still no way to put stock anywhere — while committing to a schema ticket 09 owns. But
plumbing that cannot fire is not the criterion met, so the box stays open and ticket 09 owns it:
replace that one method's body with a count over the ledger, and add the test 08 had no way to
write. It is noted there.

**Inventory declares `dependsOn: ['products']` and does not yet call it.** A location does not
name a product; a movement does. The declaration is the module's rather than the screen's, and it
is not idle — it is what forces this module's migrations to sort after products', which is the
only thing that makes the dependency real to Prisma. The boundary rule the third criterion is
about is enforced by `check:conformance` against every module, and `conformance.spec.ts` proves
it by running each rule against a module that deliberately breaks it.
