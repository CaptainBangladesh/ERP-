# 08 — Inventory: locations

**What to build:** The first real business module, and somewhere for stock to live. Inventory is
produced by the generator, declares its dependency on Products, and I can create storage locations
by hand, edit them, and deactivate ones I no longer use.

Nothing is created for me, so on a fresh account the locations screen is empty and tells me to add
my first one. That matters later: when I reach the movement screen with no locations, it must send
me here rather than presenting an unusable form.

**Blocked by:** 07 — Roles, permissions, tiers, and the add-on shape stub

**Status:** ready-for-agent

- [ ] Inventory is produced by the module generator and passes the conformance pack
- [ ] Inventory declares its dependency on Products in its manifest
- [ ] Inventory reaches Products only through the public contract, enforced by the build
- [ ] I can create a location with a name and a code
- [ ] Location code is unique within my company
- [ ] I can edit a location, and deactivate and reactivate it
- [ ] A location holding stock cannot be deactivated without a clear explanation
- [ ] The locations screen shows a distinct empty state on a fresh account
- [ ] The list uses the shared table with sorting, filtering and paging
- [ ] Locations are company-scoped and invisible across companies
- [ ] Backend tests cover create, edit, deactivate, uniqueness and isolation
- [ ] Frontend tests cover the list, the forms and the empty state
