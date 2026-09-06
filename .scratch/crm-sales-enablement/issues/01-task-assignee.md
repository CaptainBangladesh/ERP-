# 01 — Task assignee on Activity

Type: grilling
Status: open

## Question

Give a dated `Activity` (a task) an **owner** so work can be assigned and every team view can
group by rep — the keystone the calendar, heatmap, and coordination views all rest on.

Decide and build:

- **Model**: add an assignee to `Activity` (e.g. `assignedToUserId` + cached `assignedToName`,
  matching the `createdByUserId`/`createdByName` pattern already on the model). Keep the creator.
  Is a single assignee enough, or do tasks need multiple assignees like `LeadAssignee`? (Default:
  single — a task is one rep's to do; see `[[lead-multiple-assignees]]` only if that proves wrong.)
- **Who can assign to whom** — can any user assign a task to any colleague, or only a manager?
  Resolve via the RBAC permission decision in the map (default: assigning to *others* is gated;
  self-assignment always allowed).
- **Assignment on create and after** — set at creation and reassignable later; audit the change
  in the timeline (there's an audit-event precedent in `audit-events.ts`).
- **Backfill / default** — existing tasks: assignee defaults to creator.
- **Endpoints + frontend** — assignee picker on the task/activity UI (identity users list, the
  same `GET /api/identity/users` path the deals board uses for assignment), and the ability to
  filter "my tasks" vs a colleague's.

Resolution builds the model change, migration, service/controller, and the assignee UI on the
existing activity surfaces.
