# 01 — Task assignee on Activity

Type: grilling
Status: resolved

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

## Answer

Built. `Activity.assignedToUserId` (single owner, no FK, no cached name — a live reference the
frontend resolves against identity's user list, exactly like `Lead`/`Deal.assignedToUserId`). Null
on every non-task activity; a task defaults to its creator. Migration `20260906000000_activity_assignee`
backfills existing tasks' assignee = creator and indexes `(company, assignee, dueAt)`.

- **Single assignee**, not multiple: a task is one rep's to do (the default the ticket set).
- **Gate**: `POST /activities/:id/assign` is the one write path after creation. Self-service (take
  a task, release your own) is every rep's right on `crm:activities:write`; handing work to a
  *colleague* — at creation or after — needs `crm:team:manage`, checked in the service against the
  session's permissions (the endpoint decorator can't express "self OR manage"). The change audits
  on the parent timeline (`🎯`, a new audit kind).
- **Permissions**: declared `crm:team:read` (gates ticket 02's team views) and `crm:team:manage`
  (the assignment gate) — RBAC strings, no new role model.
- **Frontend**: the lead task composer schedules (due date) and assigns; task entries show the
  owner with a manager picker, or Take it / Release for a rep.

Tests: `crm.spec.ts` "assigning a task" (4), plus `LeadActivityFeed` fixtures. Full crm suite green.
