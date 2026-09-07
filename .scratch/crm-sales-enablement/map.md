# Map — CRM: Sales Enablement & Planning

Label: wayfinder:map

## Destination

A working **Sales Enablement & Planning** layer inside the existing `crm` module — built,
not merely decided (execution-included). It sits *beside* the sales-cycle mechanics that
already exist (leads, deals, activity timeline, workflow automation, dashboards) and helps
the team decide and prepare *how* to sell, rather than recording what happened. Reaching the
end of this map means a salesperson and a sales manager can, in the running app:

- see a **team scheduling calendar** of upcoming work across reps (built on `Activity.dueAt`),
- read a **backward-looking activity heatmap** (who's been active, quiet, peak times),
- use a **who-owns-what coordination view** to balance and reassign load across reps,
- plan approach in **planner/notes surfaces** — per-lead approach plan, a rep's personal
  planner, and a shared team plan,
- pull up **company scripts & playbooks** (call/objection scripts, step sequences) surfaced
  **in-context on the lead**, with lead data merged in, and
- get **guided next-best-action** — the right step/script proposed for a lead's current state.

## Notes

**This map carries execution, not just decisions** — overriding wayfinder's plan-only default,
the same override the `crm-sales`, `reporting-analytics`, and `expenses-accounting` maps use.
Each ticket ends in working code, not only a documented decision.

Modular monolith ERP — see `README.md`, `docs/modules.md`, `docs/tenancy.md`. This work extends
the **existing** `crm` module (Core tier, `dependsOn: ['parties']`); it does **not** create a new
module. Build on what's there: `Activity` (`type`, `dueAt`, `completedAt`, `createdByUserId`),
`LeadAssignee` (lead ownership, join table + cached primary — see `[[lead-multiple-assignees]]`),
email templates with merge-tags (`template-tag-resolver.ts`) as the precedent for
lead-data-merged content, and `DashboardService` aggregate Prisma queries as the precedent for
the heatmap's rollups.

**Settled during charting (do not re-ticket):**

- **Tasks get an assignee.** A dated `Activity` gains an owner (keep the creator too), so a
  manager can assign work and every team view can group by rep. This is the keystone — ticket
  01 — that the calendar, heatmap, and coordination views all rest on.
- **Manager vs rep = RBAC permission strings, not a new role model.** The platform already has
  `Role`/`RolePermission`/`UserRole` and permission-gated nav (`identity.manifest.ts`,
  `docs/modules.md`). Team-facing views (heatmap, coordination) declare new `crm:*` permission
  strings and gate their nav/endpoints the existing way. No role system to build.

**Prior art to check before assuming greenfield:** the `crm-sales` map's live-communication-sync
research found **this platform has no real background scheduler** (Expenses ticket 06 reached the
same conclusion and used a lazy/on-request pattern instead). Any playbook step-timing or task
**reminder/notification** that wants time-based firing hits that gap — check
`.scratch/crm-sales/map.md` (Decisions-so-far, "Live communication sync") and
`.scratch/expenses-accounting/issues/06-recurring-scheduler.md` before designing it, and flag
against ADR 0009 rather than quietly building a scheduler.

Tailwind/shared-UI gotcha: new shared components need the `@source` line — see
`[[erp-shared-ui-tailwind]]`. Prisma money/decimal: `toFixed()`, never `toString()` — see
`[[erp-prisma-decimal-tofixed]]` (relevant only if any planning surface shows deal value).

**Four tickets, two parallel tracks** (deliberately coarser than session-sized — the driver
prefers fewer, larger units and breaks sub-steps out at build time): 01 task assignee (shared
foundation), 02 planning workspace (calendar + heatmap + coordination + nav section), 03 scripts +
playbooks + guided selling, 04 planner & notes. Frontier: **none — all four are resolved.** (03 was
independent and ran in parallel with the 01→02→04 track.) This map is complete.

Use `/grilling` and `/domain-modeling` throughout; `/prototype` when a UI shape needs a concrete
artifact to react to (esp. the planning-workspace nav and the planner surfaces); the `dataviz`
skill for the heatmap palette. No research tickets — the one external unknown (email/scheduler) is
already resolved above.

## Decisions so far

<!-- one line per closed ticket, appended on resolution -->

- **01 task assignee (resolved).** `Activity.assignedToUserId` — single owner, no FK/cached name,
  resolved by the frontend like `Lead`/`Deal`; null on non-tasks, defaults to creator. One write
  path `POST /activities/:id/assign`: self-service open to every rep, colleague-assignment gated by
  the new `crm:team:manage`; audits `🎯` on the parent. See `issues/01-task-assignee.md`.
- **02 planning workspace (resolved).** `/crm/planning` (nav order 46, gated `crm:team:read` — the
  team permission for the whole map), three views over `api/crm/planning/*` aggregates. Heatmap
  metric = authored activity by `occurredAt`/`createdByUserId`, system rows excluded. Calendar and
  coordination reuse ticket-01 reassignment. See `issues/02-planning-workspace.md`.
- **03 scripts, playbooks & guided selling (resolved).** Four models — `Script` (spoken content,
  `category` + optional `leadStatus` key, merge-tags via the shared `template-tag-resolver`, no
  second mechanism), `Playbook` + `PlaybookStep` (ordered content), and `PlaybookEnrollment` (a
  lead's manual pointer, `@@unique([companyId, leadId])`). Authoring gated by the new
  `crm:playbooks:write` (manager); reads + guided-selling ride on `crm:leads:read`/`:write` so every
  rep gets scripts on their leads. `GET /leads/:id/guidance` returns relevant scripts (resolved),
  playbook position, and one next-best-action (current step, else a status+recency suggestion);
  `POST /leads/:id/playbook{,/advance}` + `DELETE` are the manual progression (no scheduler,
  ADR 0009). The one-click "do it" reuses activity creation, assigning the task to the current rep
  (ticket 01). Surfaces: a **Guidance** tab on the lead workspace, and a lean `/crm/playbooks`
  authoring page (nav order 57). Deal-stage/tag keying deferred — the shipped surface is the lead
  workspace, whose relevance dimension is `status`. See `issues/03-scripts-playbooks-guided-selling.md`.
- **04 planner & notes (resolved).** The open structured-vs-free question settled as a **hybrid**:
  `ApproachPlan` carries four structured intent fields (`angle`, `decisionMakers`, `objections`,
  `nextSteps`) plus a free `notes` block — the fields prompt what a plan should hold and read back
  scannably, the block catches the rest. Three company-owned singletons: `ApproachPlan`
  (`leadId @unique`), `PlannerNote` (`@@unique([companyId, userId])`, private to a rep) and
  `TeamPlan` (`companyId @unique`, shared). All upserted whole via `PUT`; `GET` on the approach plan
  always returns the shape (an all-null empty plan) rather than a null body. **No new permission
  strings**: the approach plan rides on `crm:leads:read`/`:write` (planning a lead is working it),
  the personal planner on `crm:activities:read`, the team plan reads on `crm:team:read` and writes
  on `crm:team:manage`. **"My tasks" is not a new endpoint** — the planner reads the existing
  `GET /activities?filter.assignedToUserId=<me>&filter.type=task` from ticket 01. Surfaces: an
  **Approach plan** tab on the lead workspace, `/crm/planner` ("My Planner", nav 58) and
  `/crm/team-plan` ("Team Plan", nav 59). See `issues/04-planner-and-notes.md`.

## Not yet specified

- **Exact `crm:*` permission strings for team views** — which strings gate the calendar, heatmap,
  and coordination views, and how they map to a "manager" role. Settled *inside* the Planning
  workspace ticket (it establishes the nav section and the team permission); listed here so the
  rest of the map aligns to whatever string it picks.
- **Playbook step-sequencing & timing depth** — auto-advancing a rep through playbook steps, or
  time-gated steps ("day 3: send follow-up"). Hits the no-scheduler gap (see Notes). Ticket 02
  builds playbooks as *content* (ordered steps + scripts); proactive/timed sequencing is deferred
  until real usage shows it's needed and the scheduler question is faced.
- **Task/assignment reminders & notifications** — telling a rep "you've been assigned a task" or
  "this is due today". Needs a check of what in-app notification surface (if any) exists in the
  app today, then a decision constrained by the no-scheduler finding. Not sharp enough to ticket.

## Out of scope

- **Qualification framework / lead scoring** (BANT/MEDDIC checklists, fit/interest score) — raised
  while scoping methodology and deliberately set aside; the "how we sell" here lives in playbooks
  + guided next-best-action, not a scoring model. Already tracked as fog on `crm-sales`' map
  ("Lead scoring"); stays there, not built by this effort.
- **Standalone searchable scripts library page** — considered for the scripts piece and *not*
  chosen; the emphasis is in-context-on-the-lead + playbooks. Authoring/organization of scripts
  is covered by ticket 02, but a big browsable library UI is not a goal of this map.
