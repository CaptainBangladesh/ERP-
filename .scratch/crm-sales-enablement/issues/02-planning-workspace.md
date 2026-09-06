# 02 — Planning workspace: calendar, heatmap & coordination

Type: grilling
Status: resolved
Blocked by: 01

## Question

Build the **team-and-time side** of the enablement layer as one coherent workspace: a forward
scheduling calendar, a backward activity heatmap, and a who-owns-what coordination view. This
ticket also **establishes the nav home** ("Team" / "Planning" section) that ticket 04's planner
surfaces align to — decide it here since this is the first big surface.

Build all three views (grill each as you go; they share assignment data and one nav section):

- **Nav/layout** — a new permission-gated CRM section vs. woven into existing pages. Check
  `crm.manifest.ts` nav conventions; mind `[[crm-workspace-layout-overflow]]` (`min-w-0` on
  AppShell main). Settle the `crm:*` team permission string here so 04 and the rest match.
- **Scheduling calendar (forward)** — upcoming tasks/calls across reps from `Activity.dueAt`,
  grouped by the ticket-01 assignee. Day/week views, per-rep lanes or color-coded, a capacity read
  for overload. Schedule/reschedule/reassign/complete from the calendar (decide read-only-first vs.
  full interaction).
- **Activity heatmap (backward)** — color-graded grid of activity volume per rep over time
  (contributions-style). Settle the exact metric (completed by `completedAt` vs. all by
  `occurredAt`), the window, and the grid shape. Use `DashboardService` aggregate-query precedent;
  use the `dataviz` skill for the sequential palette/legend (light+dark).
- **Coordination (who-owns-what)** — per-rep summary of owned leads (`LeadAssignee`), open deals,
  open tasks, with **reassignment** to balance load. Reuse existing assignment write paths
  (`[[lead-multiple-assignees]]` — three create paths must stay in sync) and ticket-01 task
  reassignment; audit changes.

Manager-facing views gated by the team permission; a rep sees their own slice. Reminders/
notifications are out (no-scheduler gap — map fog). Resolution builds the aggregate endpoints and
the three frontend views under one nav section.

## Answer

Built as one `TeamPlanningPage` (`/crm/planning`) with three tabbed views, under a new **Planning**
nav entry (order 46) gated by **`crm:team:read`** — the team permission string settled here for the
rest of the map. Backend `PlanningService`/`PlanningController` (`api/crm/planning/*`), following the
`DashboardService` precedent (Prisma aggregates + in-memory bucketing, no raw SQL). All three keyed
by plain user ids the frontend joins to names — and folds in idle teammates — against identity's
user list; the backend never reaches into identity.

- **Calendar (forward)** — `GET planning/schedule?from&to` returns upcoming dated tasks across reps
  (default two-week look-ahead), parent resolved to a name server-side. A 7-day week grid, per-rep
  colour, "only my tasks" lens; complete/reassign inline (reusing ticket-01 `assign` + complete).
  Read + light interaction, not read-only.
- **Heatmap (backward)** — `GET planning/heatmap?weeks=12`. **Metric settled: authored activity by
  `occurredAt`, attributed to `createdByUserId`, system rows excluded** — "who put the work in",
  not what they were handed. Contributions-style single-hue teal ramp (colour-blind safe by
  lightness), fixed thresholds, legend, per-rep strip over 84 days.
- **Coordination** — `GET planning/coordination` returns per-rep `{leadCount, openDealCount,
  openTaskCount, overdueTaskCount}`. A workload table, busiest first, overdue flagged, idle
  teammates shown as zeroes. Task reassignment lives on the calendar (reuses ticket-01); lead/deal
  reassignment stays on their own boards.

Tests: `crm.spec.ts` "team planning" (4, incl. the `crm:team:read` gate) + `TeamPlanningPage.test.tsx`
(4). Full crm suites green (backend 57, frontend 180).
