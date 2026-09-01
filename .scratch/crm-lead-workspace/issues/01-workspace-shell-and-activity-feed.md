# 01 — Lead Workspace shell + unified Activity feed + Details

**What to build:** A salesperson clicks a lead in the Leads table and lands on a full-page
**Lead Workspace** at its own route (`/crm/leads/:id`) — deep-linkable and bookmarkable, with
browser back/forward working. The rich Leads table stays the index and simply navigates here on
row click, replacing the old `selectedId` modal (which is removed along with its redundant
sidebar status control and its hardcoded fake stages).

The workspace is three columns beside a narrow **module-nav rail** (Dashboard, Leads, Deals,
Contacts, Campaigns, Forms, Workflows) pinned to the far left:

- A persistent, collapsible **worklist** down the left — each entry showing the lead's name,
  organisation, Status and Priority at a glance, searchable by name, so a salesperson moves
  lead-to-lead without returning to the table. Ordered by an existing sortable field (not
  Priority — see ADR 0010). Collapsing it lets the centre fill the space.
- A **Status pipeline stepper** across the top: the single control for advancing a lead through
  its Status. It renders the company's own `LeadStatusLabel` set (settable statuses in order,
  with their colours, including custom ones), advances Status by clicking the next step (via the
  existing `PATCH /crm/leads/:id`), and presents **Qualify** / **Disqualify** as visibly distinct
  terminal actions wired to the existing qualify/disqualify endpoints.
- The centre column is the **Timeline**, labelled **Activity**, as one filterable feed
  (all / email / notes / system) with a composer pinned to the top. It reads the existing
  `ACTIVITY_PATHS.leadActivities(id)` endpoint, which already returns person-authored Activities
  and emoji-tagged system Audit events, and interleaves them chronologically — notes, calls,
  meetings, tasks, sent emails (as Correspondence) and status changes. No separate "audit log"
  endpoint is used.
- A **Next-step rail** on the right surfacing the single next action (Qualify, or the pending
  follow-up task with one-tap complete) and a condensed "what we know" block (source, priority).
- A **Details** view gathering every lead field — name, organisation, email, phone, source,
  owner, custom fields — in one place.
- **Quick contact actions** (email, call, note, task, attach) as friendly icon buttons in the
  header. A Hot/Warm/Cold **Priority** badge on worklist cards and the header, read from the
  conventional `priority` custom field per ADR 0010 (display-only, never a sort key).

Ships in the app's existing light theme only. Viewing a lead in another company returns the same
not-found as a lead that does not exist.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] The Leads table row click navigates to `/crm/leads/:id`; the URL is deep-linkable and back/forward work; the old detail modal is gone.
- [x] Three-column workspace renders beside the module-nav rail; the worklist is searchable by name, each card shows name/organisation/Status/Priority, and the worklist collapses to let the centre expand.
- [x] The Status stepper renders the company's `LeadStatusLabel` labels/colours in order (custom statuses included); clicking a settable step issues the status `PATCH`; Qualify and Disqualify are presented as distinct terminal actions on the existing endpoints.
- [x] The centre Activity feed interleaves person Activities and system Audit events from `leadActivities`, filterable (all/email/notes/system), with a working pinned composer for logging a note/call.
- [x] The Next-step rail shows the single next action (Qualify, or a pending task with one-tap complete) plus the condensed "what we know" block; the Details view gathers every field in one place.
- [x] A Hot/Warm/Cold Priority badge appears on worklist cards and the header, derived from the `priority` custom field and used for display only (no priority sorting).
- [x] Light theme only; a cross-tenant lead id yields the standard not-found.
- [x] Frontend tests render the workspace against a mocked API and assert the rendered behaviour and user interactions above (prior art: `LeadsPage.test.tsx`, `CaptureSourcesPage.test.tsx`).
