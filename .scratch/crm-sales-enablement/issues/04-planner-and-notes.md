# 04 — Planner & notes surfaces

Type: grilling
Status: resolved
Blocked by: 01, 02

## Question

Build the three **planning/notes surfaces** the brief centred on — the "where we put notes and plan
our approach" layer. Aligns to the nav/layout ticket 02 establishes; personal planner reads the
task ownership ticket 01 adds. Grill each as you build it.

- **Per-lead approach plan** — a strategy surface on the lead workspace: how we'll approach *this*
  prospect. Decide **structured vs. free-notes** — e.g. structured fields (angle, decision-makers,
  objections to expect, next steps) vs. a rich free-notes block, or a hybrid. Must read as *intent*
  and stay distinct from the activity timeline (which is *history*). One plan per lead.
- **Rep's personal planner** — a "my planning" home: my open/assigned tasks (ticket-01 assignee)
  across all my leads, plus my own free notes / day-week plan. Personal, not tied to one lead.
- **Shared team plan** — a team-level planning surface: shared strategy notes, targets, or
  campaigns everyone on the team sees. Keep lean; decide scope with grilling (a notes/board doc,
  not a full project tool).

Settle where each lives against ticket 02's nav decision (per-lead plan on the lead workspace;
personal planner and team plan in the Team/Planning section). Resolution builds the model(s) for
approach plans and notes, endpoints, and the three frontend surfaces.

## Resolution

**Structured vs. free-notes — settled as a hybrid.** The approach plan carries four structured
intent fields (`angle`, `decisionMakers`, `objections`, `nextSteps`) *plus* a free `notes` block.
Pure free-notes gives a rep nothing to think against and nothing scannable across leads; fully
structured leaves no home for what the fields don't anticipate. The four fields prompt what a plan
should contain and read back comparably; `notes` is the escape hatch. Every field is nullable — a
partial plan is a real plan — and the whole thing is upserted (`PUT`), one row per lead.

**Three models, all ordinary company-owned tables:**
- `ApproachPlan` — `leadId @unique` (one plan per lead, `onDelete: Cascade`), the five text fields,
  `updatedByUserId` (plain user reference, no FK, resolved by the frontend like lead ownership).
- `PlannerNote` — `@@unique([companyId, userId])`, one free-notes body per rep, private to them.
- `TeamPlan` — `companyId @unique`, one shared body per company, `updatedByUserId`.

**Endpoints** (`planner.controller.ts` / `planner.service.ts`, migration
`20260906020000_planner_and_notes`):
- `GET|PUT|DELETE /leads/:id/approach-plan` — read on `crm:leads:read`, write on `crm:leads:write`;
  planning a lead *is* working it, so no new permission. `GET` always returns the shape (an all-null
  empty plan when none exists) rather than a null body, so the workspace never special-cases.
- `GET|PUT /planner/notes` — the current rep's own notes, `crm:activities:read`. No id in the path.
- `GET /team-plan` on `crm:team:read`, `PUT /team-plan` on `crm:team:manage` — a rep reads the team
  plan, a manager writes it.

**"My tasks" is not a new endpoint.** The personal planner reads the existing
`GET /activities?filter.assignedToUserId=<me>&filter.type=task` (the filter ticket 01 added), and
hides completed tasks client-side. No second aggregate over the same rows.

**Surfaces:** an **Approach plan** tab on `LeadWorkspace` (`components/ApproachPlanPanel.tsx`,
read-only without `crm:leads:write`); `/crm/planner` — "My Planner" (nav order 58, gated
`crm:activities:read` so a rep without the team gate still has their own planner); `/crm/team-plan` —
"Team Plan" (nav order 59, `crm:team:read`, editor only with `crm:team:manage`). No new permission
strings were needed. Validation refusals are 422. No scheduler, no versioning of notes (ADR 0009).
