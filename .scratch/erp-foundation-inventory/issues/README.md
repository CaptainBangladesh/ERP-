# Tickets — ERP platform foundation, proven by Inventory

Fourteen tickets. Built for a roadmap of forty-plus modules across three tiers (Core, Enterprise,
Custom), all in-house. At that scale the module contract *is* the product, so it is built early —
but each piece of it rides along with the first visible feature that needs it, rather than sitting
in its own invisible ticket.

## Standing rules

**No seed data in the running application.** Every company, user, role, unit of measure, party,
product and location is created by hand through the UI. Defaults are applied in code, never as
inserted rows. Test fixtures create data inside the harness only. Empty states are acceptance
criteria on every screen.

**Two shape stubs live in the foundation and never leave** — an HRM stub (ticket 03: periodic,
sensitive, immutable) and an add-on stub (ticket 07: Custom tier, optional, extends another module).
Every foundation feature must serve all shapes, not just inventory's. This is the mechanism that
stops the platform hardening around its first module.

**The shared package holds primitives only** — money, quantity, identifiers, pagination and error
shapes, the data table. Anything with domain meaning is a module. Parties, Products and units of
measure are Core modules, not shared utilities.

**Accounting is a sink, not a dependency.** Movements carry the value and classification a journal
entry needs and emit events, but no accounting module exists and inventory never depends on one.

## Tickets

| #  | Ticket                                          | Blocked by | Infrastructure carried            | Clickable |
| -- | ----------------------------------------------- | ---------- | --------------------------------- | --------- |
| 01 | Walking skeleton and test harnesses             | —          | monorepo, both test seams         | runs      |
| 02 | Identity and access, as first module            | 01         | manifest, registry, load order    | yes       |
| 03 | Tenant scoping, and the HRM shape stub          | 02         | HRM stub, restricted fields       | no        |
| 04 | API conventions, data table, exact numbers      | 03         | list/error shapes, money, table   | yes       |
| 05 | Parties (Core), and boundary enforcement        | 04         | boundary rules, conformance pack  | yes       |
| 06 | Products and UoM (Core), and the generator      | 05         | module generator                  | yes       |
| 07 | Roles, permissions, tiers, and the add-on stub  | 06         | tier enablement, add-on stub      | yes       |
| 08 | Inventory: locations                            | 07         | —                                 | yes       |
| 09 | Stock movements: receipt and issue              | 08         | accounting seam                   | yes       |
| 10 | Adjustments and transfers                       | 09         | —                                 | yes       |
| 11 | Reversals and negative stock policy             | 10         | —                                 | yes       |
| 12 | Concurrency hardening                           | 09         | —                                 | no        |
| 13 | Stock valuation                                 | 11         | —                                 | yes       |
| 14 | Foundation audit against the module roadmap     | 13         | —                                 | no        |

Only 03, 12 and 14 produce nothing to look at, and they are spread out rather than stacked at the
front. Ticket 12 can be worked in parallel with 10 and 11; everything else is a chain.

## Why infrastructure rides along

Each piece of platform machinery attaches to the first visible ticket that genuinely needs it, which
also makes it better machinery:

- **The manifest** is designed while fitting a real module to it (02), not in the abstract.
- **Boundary rules** are written when three modules exist and one is about to be consumed by all the
  others (05) — informed by real dependencies rather than imagined ones.
- **The generator** is extracted from three working modules (06), so it encodes what turned out to be
  needed rather than what was guessed. Products is the first module it produces.
- **Tier enablement** is built against a real Custom-tier module (07) rather than a hypothetical one.

The cost is a short cleanup pass in ticket 05, bringing the two modules that predate the boundary
rules into compliance.

## Where you can start clicking

Sign-in at 02. Real business data at 05 (parties) and 06 (products). A complete inventory module you
can judge end to end by 13.
