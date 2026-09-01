# Spec — CRM Lead Workspace: a single place to work a lead

Status: ready-for-agent

Builds on the shipped Sales CRM (`.scratch/crm-sales/spec.md`) and the Leads board work
(`.scratch/crm-leads/spec.md`), which established the `crm` module, the `Lead` record and its
`new → contacted → qualified/disqualified` lifecycle (`Status`), company-owned `LeadSource`,
`LeadStatusLabel` and `LeadFieldDefinition` vocabularies, `Activity` logging, `CaptureSource`
form/webhook ingestion, `MailboxConnection` 1:1 sending, and `Campaign` open-tracking. Those
specs remain the source of truth for everything they settled; this one is additive.

Vocabulary in this document follows the project glossary at `CONTEXT.md` — in particular the
distinction between **Status** (a Lead's lifecycle position) and the Deal **Stage** pipeline
(post-qualification, and out of scope here); between an **Activity** (person-authored) and an
**Audit event** (system-recorded), both of which appear in the **Timeline**; **Correspondence**
(outbound email, not chat); **Email open** (a *soft* signal, never proof); and a **Survey
submission** (one capture-form response tied to a Lead). It respects `docs/adr/0010` (Lead
priority is a display-only custom field, not a sortable column).

**Current state at spec time (uncommitted WIP to be finished by this spec).** A first cut of
the tabbed lead detail already exists on disk: `LeadDetail.tsx` has Overview/Activity/Files/
Survey tabs, `LeadFilesTab.tsx`, `LeadSurveyTab.tsx`, a `LeadAttachment` Prisma model, a
`company-owned.ts` classification for it, and `LEAD_PATHS.files`/`file`/`auditLogs` +
`LeadAttachmentResponse` in the contract. That work is **incomplete and partly non-functional**:
attachments store no file bytes (a `storageKey` is fabricated and points at nothing, there is no
download route), the `auditLogs` contract path has no controller endpoint and no caller, and the
Survey tab merely dumps `Lead.customValues`. This spec supersedes the WIP layout and completes
the missing behavior.

## Problem Statement

Working a single lead means visiting four disconnected places. To see what has happened to a
lead, a salesperson scrolls a cramped modal until the activity feed comes into view — it sits
below contact pills and a pipeline bar, so the one thing they open the lead to read is the
hardest thing to find. To move between leads they must close the modal and return to the table.
Files "attached" to a lead cannot be opened — only their names are stored, never the file
itself — so a quote or a photo of the customer's lot is listed but lost. A Google Form the
company already uses to qualify leads either has nowhere to land, or lands once and drops every
answer that wasn't pre-defined as a field, and a second response from a known lead is discarded
entirely. And when a salesperson emails a lead, they never learn whether it was read, so
"follow up with the ones who opened it" is not something anyone can do.

The through-line: everything that happens to a lead is an activity *for that lead*, but the
application scatters those activities across tabs, drops some of them, and hides the rest.

## Solution

One full-page **Lead Workspace** at its own route, where everything about a lead lives together:

- A persistent **worklist** down the left, beside a narrow **module nav rail**, so a
  salesperson moves lead-to-lead without leaving — the standard rail-plus-list pattern.
- A **Status pipeline stepper** across the top: the single control for advancing a lead through
  its (company-defined, coloured) statuses, with **Qualify** / **Disqualify** as the terminal
  actions.
- A **Timeline** as the centre column, above the fold, labelled **Activity** because that is
  what users call it. Everything lands here as one filterable feed: notes, calls, meetings,
  tasks, sent emails (as Correspondence), **email opens**, file attachments, survey responses,
  and status changes. A composer is pinned to the top.
- Thin **find-it tabs** beside the feed — **Files** (browse and download real attachments),
  **Survey** (every response, full question-and-answer), **Details** (all fields) — for
  retrieving an artifact without scrolling the whole history.
- A **Next-step rail** on the right: the one thing to do now, then a condensed "what we know"
  (source, priority, top survey answers).

Behind it, three capabilities are completed so the feed is truthful: **real file storage**
(upload and download actual bytes), **email-open tracking with notification** on 1:1 mail, and
**stored survey submissions** that attach to a lead — appending to an existing lead rather than
being dropped, and keeping every answer including the ones no field maps.

## User Stories

1. As a salesperson, I want to open a lead on its own full page, so that I have room to work it
   without a cramped modal.
2. As a salesperson, I want the lead's URL to be its own route, so that I can deep-link, bookmark
   and use browser back/forward.
3. As a salesperson, I want a worklist of leads down the left of the workspace, so that I can move
   from one lead to the next without returning to the table.
4. As a salesperson, I want each worklist entry to show the lead's name, organisation, status and
   priority at a glance, so that I can triage which to open.
5. As a salesperson, I want to search the worklist, so that I can jump to a lead by name.
6. As a salesperson, I want a narrow module-nav rail (Dashboard, Leads, Deals, Contacts,
   Campaigns, Forms, Workflows) pinned to the far left, so that switching modules and working a
   lead share one consistent left edge.
7. As a salesperson, I want to collapse the worklist, so that the activity feed can fill the space
   when I am focused on one lead.
8. As a salesperson, I want the rich Leads table (groups, filters, bulk-select, import) to remain
   the index, so that clicking a lead opens the workspace and I lose none of the board's power.
9. As a salesperson, I want every lead detail — name, organisation, email, phone, source, owner,
   custom fields — gathered in one place, so that I am not hunting across header pills and a
   sidebar.
10. As a salesperson, I want the status pipeline shown as a stepper across the top, so that I can
    see at a glance where the lead is and what comes next.
11. As a salesperson, I want the stepper to render my company's own status labels and colours,
    including custom statuses, so that it speaks my team's vocabulary.
12. As a salesperson, I want to advance a lead's status by clicking the next step, so that
    progressing a lead is one obvious action, not three overlapping controls.
13. As a salesperson, I want Qualify and Disqualify presented as the terminal actions of the
    stepper, so that the one-way, side-effecting steps are visibly different from ordinary status
    changes.
14. As a salesperson, I want a single Activity feed as the centre of the workspace, so that
    everything that happened to the lead is in one chronological place.
15. As a salesperson, I want the feed to include notes, calls, meetings and tasks I log, so that my
    own actions are recorded.
16. As a salesperson, I want the feed to include emails I sent, shown as correspondence, so that I
    can read the thread of outreach in context.
17. As a salesperson, I want the feed to include system audit events — status changed, file
    attached, survey received, lead created — so that the history is complete without me logging
    it by hand.
18. As a salesperson, I want to filter the feed (all / email / notes / system), so that I can find
    the kind of entry I want.
19. As a salesperson, I want a composer pinned to the top of the feed, so that logging a note or
    recording a call is immediate.
20. As a salesperson, I want quick contact actions (email, call, note, task, attach) as icon
    buttons in the header, so that starting an action is one click and reads as friendly, not
    technical.
21. As a salesperson, I want a Files tab that lists every attachment with type, size and date, so
    that I can find a document without scrolling the feed.
22. As a salesperson, I want to upload a file by drag-and-drop or file picker, so that attaching a
    quote, proposal or screenshot is easy.
23. As a salesperson, I want to actually download or open an attachment, so that a stored file is
    usable and not just a name.
24. As a salesperson, I want image attachments to show a thumbnail, so that screenshots are
    recognisable at a glance.
25. As a salesperson, I want every file upload to appear in the Activity feed as an audit event,
    so that the timeline stays complete.
26. As a marketing manager, I want responses to a company Google Form to create or update the
    matching lead automatically, so that form answers reach the CRM without re-keying.
27. As a marketing manager, I want a webhook capture source with a URL and token, so that a Google
    Form (via an Apps Script `onFormSubmit` trigger) can post responses to it.
28. As a marketing manager, I want to map each form question to a lead field, so that the system
    understands which answer means what.
29. As a salesperson, I want a survey response for a known lead to attach to that lead rather than
    create a duplicate, so that repeat submissions build up the lead's picture.
30. As a salesperson, I want every survey answer stored — including ones no field maps — so that
    nothing the lead told us is lost.
31. As a salesperson, I want a Survey tab that lists each submission with its form name and time,
    expandable to the full question-and-answer, so that I can read exactly what the lead answered.
32. As a salesperson, I want mapped answers distinguished from unmapped ones in the survey view, so
    that I can see what fed the lead's fields.
33. As a salesperson, I want to promote an unmapped answer into a custom field, so that a recurring
    useful answer becomes structured going forward.
34. As a salesperson, I want each survey response to appear in the Activity feed as an audit event,
    so that the timeline records when the lead engaged.
35. As a salesperson, I want a per-send tracking pixel on the 1:1 emails I send, so that opens can
    be detected.
36. As a salesperson, I want an in-app notification the first time a lead opens my email, so that I
    can follow up while it is fresh.
37. As a salesperson, I want the email open recorded in the Activity feed with an open count, so
    that the engagement is part of the lead's history.
38. As a salesperson, I want "opened" presented as *probably seen*, never as certainty, so that I
    am not misled by image-blocking or pre-fetching.
39. As a salesperson, I want the Next-step rail to surface the single next action (Qualify, or the
    pending follow-up task with one-tap complete), so that the workspace tells me what to do now.
40. As a salesperson, I want a condensed "what we know" block (source, priority, top survey
    answers) in the rail, so that I have context beside the action without opening a tab.
41. As a sales manager, I want a Hot/Warm/Cold priority badge on worklist cards and the header, so
    that my team can see at a glance which leads are hot.
42. As a salesperson, I want the whole workspace in the app's existing light theme, so that it is
    consistent with the rest of the ERP.
43. As a salesperson viewing a lead in another company, I want the same not-found response as a
    lead that does not exist, so that the workspace leaks nothing across tenants.

## Implementation Decisions

**Modules touched.** All backend work is inside the `crm` module and the `platform` layer; the
frontend work is inside `application/src/modules/crm`. No module boundary is crossed that
`crm-sales` did not already establish (Parties via `PartyDirectory`, users resolved via
identity's public list). Every new table carries a plain `companyId` column and is classified in
`platform/tenancy/company-owned.ts`, as every other `crm` table is.

**Frontend — the Lead Workspace.**
- A new route `/crm/leads/:id` renders the workspace; the existing Leads table becomes the index
  and navigates to it on row click (replacing the current `selectedId` modal). The workspace is
  three columns — worklist rail, centre Activity feed, right Next-step rail — beside a narrow
  module-nav rail; the worklist is collapsible.
- The **Status stepper** is the single status control. It renders from `LeadStatusLabel`
  (settable statuses in order, with colours), advances status via the existing
  `PATCH /crm/leads/:id`, and exposes Qualify/Disqualify via the existing qualify/disqualify
  endpoints. The redundant sidebar status control from the WIP is removed.
- The centre **Activity** feed reads the existing `ACTIVITY_PATHS.leadActivities(id)` endpoint —
  which already returns person-authored Activities and the emoji-tagged system Audit events. No
  separate "audit log" endpoint is introduced; the unused `LEAD_PATHS.auditLogs` contract entry
  is removed as dead surface.
- Tabs: **Activity** (default), **Files**, **Survey**, **Details**. Light theme only.
- **Priority** is a display-only custom field per `docs/adr/0010`. The workspace reads a
  conventional field (key `priority`) from `Lead.customValues` and maps Hot/Warm/Cold to badge
  colours. It is not a sort key; the worklist orders by an existing sortable field.

**Backend — real file storage.**
- Introduce a small `platform/storage` capability: a `StorageProvider` interface
  (`put(companyId, key, bytes, contentType)`, `get(key)`, `remove(key)`) with a local-filesystem
  implementation for development, so the concrete store is swappable without touching `crm`. This
  is the one genuinely new platform seam; it mirrors how `platform/upload` already isolates
  multipart validation.
- `POST /crm/leads/:id/files` becomes a multipart upload (`FileInterceptor`, as
  `lead-imports.controller.ts` already uses) validated by `platform/upload` with an
  attachments-appropriate size cap and type allowlist, and persisted through `StorageProvider`.
  `LeadAttachment.storageKey` holds the real key.
- Add `GET /crm/leads/:id/files/:fileId/download` (contract: `LEAD_PATHS.fileDownload`) that
  streams the bytes with the stored content-type. Attachment delete also removes the stored
  object.

**Backend — 1:1 email open tracking + notification.**
- A new company-owned model records each 1:1 send and its opens: `leadId`, the `Activity` it
  produced, `sentByUserId`, `subject`, a unique `openToken`, `openedAt`, `openCount` — the same
  shape `CampaignRecipient` already uses for campaign opens.
- `sendOneOnOneEmail` embeds a tracking pixel referencing the token before sending, and writes
  the record.
- A public, unauthenticated pixel endpoint (contract under `LEAD_EMAIL_PATHS`, mirroring
  `CAMPAIGN_PATHS.publicOpenPixel`) returns a 1×1 GIF, increments `openCount`, and sets
  `openedAt` on first hit. **On the first open only**, it creates a `Notification` for
  `sentByUserId` and logs a `📬 Email opened` Activity on the lead; subsequent opens only
  increment the count. Open state is always surfaced as likelihood, never certainty.

**Backend — stored survey submissions, append not drop.**
- A new company-owned model `LeadSubmission` stores each capture-form response tied to a lead:
  `leadId`, optional `captureSourceId`, a `formName` snapshot, `rawPayload` (Json — every answer),
  `mappedValues` (Json — the subset mapped to lead fields), `submittedAt`.
- The existing public `submitCapture` (`POST /api/public/capture/:token`) is extended: after
  resolving the mapped values, it finds an existing lead by email/phone/name as today, but
  instead of dropping the submission when a match exists, it **attaches a `LeadSubmission` to the
  matched lead**, logs a `📝 Survey response received` Activity, and — conservatively — fills only
  **empty** built-in and custom fields, never overwriting a value the lead already has (the
  endpoint is public and unauthenticated, so a submission must not be able to overwrite known
  data). When no lead matches, a lead is created as today and the submission attached to it. The
  raw payload is always stored in full, so unmapped answers survive.
- New authenticated read path (contract: `LEAD_SUBMISSION_PATHS.byLead(id)`) lists a lead's
  submissions for the Survey tab. Promoting an unmapped answer to a field reuses the existing
  `LeadFieldDefinition` create + `PATCH /crm/leads/:id` customValues flow; no new endpoint.

**Contract (`@erp/shared`) changes.** Add `LEAD_PATHS.fileDownload`; remove dead
`LEAD_PATHS.auditLogs`. Add `LeadSubmissionSummary` / list types and `LEAD_SUBMISSION_PATHS`. Add
a lead email-open public pixel path and a `LeadEmailSendSummary` (open state) type. File upload
moves from a JSON body to multipart; `LeadAttachmentResponse` is unchanged on the way out.

**Google Forms connection (documented, not built here).** The supported path is a webhook
`CaptureSource` plus a Google Apps Script `onFormSubmit` trigger posting to the token URL, mapping
by stable Google item IDs. No native Forms API / Pub/Sub integration.

## Testing Decisions

Two seams, both the highest existing point in their workspace; nothing new is tested through.

- **Backend — the `crm` HTTP surface.** Assert observable behaviour through requests, never
  internals:
  - `POST /api/public/capture/:token` with a payload matching an existing lead persists a
    `LeadSubmission` on that lead, logs the survey Activity, fills an empty field but leaves a
    non-empty field untouched, and does **not** create a duplicate lead; the raw payload retains
    an unmapped answer. A payload with no match creates the lead and attaches the submission.
  - `POST /crm/leads/:id/send-email` records a send with an `openToken` and embeds the pixel.
    Hitting the public pixel endpoint once sets `openedAt`, increments `openCount`, creates one
    `Notification` for the sender and one `📬` Activity; hitting it again increments the count but
    creates no second notification or Activity.
  - `POST /crm/leads/:id/files` (multipart) stores bytes and logs the attach Activity;
    `GET …/files/:fileId/download` returns those exact bytes with the stored content-type;
    both refuse a lead in another company with the standard not-found.
  - Prior art: the `crm` controller/service specs, `.scratch/crm-leads/issues/05-web-form-webhook-capture.md`
    (capture) and the campaign open-tracking tests.
- **Frontend — the Lead Workspace component.** Render it against a mocked API and assert rendered
  behaviour and user interactions, not state: all lead details appear in the rail; the Activity
  feed interleaves note/email/email-opened/survey/audit entries; switching to Files, Survey and
  Details shows the right pane; the stepper reflects the lead's status and clicking a step issues
  the status `PATCH`. Prior art: `LeadsPage.test.tsx`, `CaptureSourcesPage.test.tsx`.

A good test here fixes on external behaviour — an HTTP response, a database effect observable
through another request, rendered output, a user event — and never on a private method, an
internal field, or a snapshot of implementation. `StorageProvider` is exercised through the file
endpoints, not tested directly.

## Out of Scope

- The Deal **Stage** pipeline (Discovery → Negotiation → Won/Lost) and the Deals board — unchanged.
  Only the hand-off is noted: Qualify creates the Party/Deal as `crm-sales` already specifies.
- Live two-way chat / inbound email threading. Correspondence is outbound email only.
- Native Google Forms API integration (Pub/Sub `responses.watches`); the webhook + Apps Script
  path is the supported one.
- Dark mode. The workspace ships in the existing light theme only.
- Lead priority as a first-class, sortable column (`docs/adr/0010`); it stays a display-only
  custom field. Worklist sorting by priority is therefore not offered.
- Auto-provisioning custom fields from unmapped survey answers; unmapped answers are stored on the
  submission and promoted to fields only by an explicit "save as field" action.

## Further Notes

- **Email opens are a soft signal.** The pixel is defeated by image-blocking and inflated by Apple
  Mail Privacy Protection's pre-fetch. The UI must always phrase opens as likelihood ("probably
  seen"), and the first-open-only notification rule keeps repeated pre-fetches from becoming noise.
- **The capture endpoint is public and unauthenticated**, protected today only by per-token rate
  limiting. Because a submission can now attach to an existing lead, the append is deliberately
  conservative — never overwriting a non-empty field — so a forged submission naming a known
  lead's email cannot poison its data. A shared-secret header on webhook capture sources is a
  recommended hardening and can be a follow-up ticket.
- **Map Google questions by stable item ID, not question title** — titles change and can
  duplicate.
- This spec can be split into implementation issues under `.scratch/crm-lead-workspace/issues/`
  along its natural seams: (01) the workspace shell + route + worklist + stepper, (02) the unified
  Activity feed + tabs, (03) real file storage + download, (04) 1:1 email-open tracking +
  notification, (05) stored survey submissions + append-not-drop + Survey tab.
