# 04 — Activity logging

**What to build:** Anyone can log a call, email, meeting, note, or task against a Lead, Deal, or
Party, and see every Activity logged against one of those in a shared timeline on its detail
screen. A task carries its own due date and a purpose-built complete/reopen toggle; every other
type is append-only — logged once, never edited or deleted. Full field list and the
exactly-one-parent rule are in [the spec](../spec.md)'s "Activity schema and endpoints" section.

**Blocked by:** 02, 03 (needs Lead and Deal to exist as attachable parents alongside Party)

- [ ] `Activity` model + migration: type, notes, occurredAt, dueAt/completedAt (task only),
      createdByUserId/createdByName (frozen at write time, same actor-freeze mechanism as
      `StockMovement`), and exactly one of leadId/dealId/partyId.
- [ ] Log endpoint refuses a request naming zero or more than one parent.
- [ ] Task complete/reopen endpoint is the only mutation available on an existing Activity — no
      general update or delete endpoint exists.
- [ ] Timeline read endpoint per parent kind, returned in `occurredAt` order.
- [ ] A shared timeline component (per `@erp/shared/ui`'s "shared component" convention) rendered
      on the Lead, Deal, and Party detail screens, including a "log activity" entry point on each.
- [ ] HTTP integration tests covering logging each type against each of the three parent kinds,
      the zero/multiple-parent refusal, task complete/reopen, append-only enforcement (no
      update/delete route to call), and tenant isolation.
