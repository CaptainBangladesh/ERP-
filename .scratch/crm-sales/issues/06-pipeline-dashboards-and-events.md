# 06 — Pipeline dashboards & events

**What to build:** A dashboard showing pipeline value by Stage, win/loss rate, and activity
counts (by type and by user, over a selectable date range) — all plain `aggregate`/`groupBy`
Prisma queries, no raw SQL or snapshot table. Alongside it, `crm` emits domain events on the
actions that produce them (`crm.lead.qualified`, `crm.lead.disqualified`, `crm.deal.created`,
`crm.deal.stage_changed`, `crm.deal.won`, `crm.deal.lost`), declared in the manifest, following
`DomainEvents`' commit-after, best-effort discipline — nothing in this ticket consumes another
module's events. Full query and event-payload shapes are in [the spec](../spec.md)'s "Dashboards
and events" section.

**Blocked by:** 02, 03, 04 (dashboard metrics and event payloads read Lead, Deal, and Activity
data all three tickets define)

- [x] Pipeline-value-by-stage query endpoint (grouped by `stageId`, closed stages bucketed
      separately from in-flight ones).
- [x] Win/loss-rate query endpoint (counts by `outcome`, over a selectable date range).
- [x] Activity-count query endpoint (grouped by `type` and by `createdByUserId`, over a selectable
      date range).
- [x] Dashboard screen rendering all three, with a correct empty/zeroed state for a company with
      no Deals.
- [x] `crm.lead.qualified`, `crm.lead.disqualified`, `crm.deal.created`, `crm.deal.stage_changed`,
      `crm.deal.won`, `crm.deal.lost` declared in the manifest's `events.emits` and actually
      emitted at the right points, after commit.
- [x] HTTP integration tests covering each dashboard query against known seeded data (including
      the zero-Deals case) and asserting each event fires with the right payload at the right
      trigger.

## Comments

**2026-08-23 — resolved.** Implemented `DashboardService`/`DashboardController` with Prisma aggregations, domain events declared in `crm.manifest.ts` and emitted on post-commit actions, frontend `DashboardPage`, and tests in `crm-dashboard-events.spec.ts` and `DashboardPage.test.tsx`.

