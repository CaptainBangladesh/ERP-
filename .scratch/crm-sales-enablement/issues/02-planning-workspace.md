# 02 — Planning workspace: calendar, heatmap & coordination

Type: grilling
Status: open
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
