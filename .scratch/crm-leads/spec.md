# Spec — CRM Leads: capture, organization, outreach & conversion

Status: ready-for-agent

Builds on the shipped Sales CRM (`.scratch/crm-sales/spec.md`), which established the `crm`
module, the `Lead` record and its `new → contacted → qualified/disqualified` lifecycle, the
`Stage`/`Deal` pipeline, `Activity` logging, `WorkflowRule` automation and the pipeline
dashboards. That spec remains the source of truth for everything it settled; this one is
additive and covers only the Leads board's own four pillars: **capture & ingestion**, **data
organization**, **email & outreach**, and **qualification & conversion**.

**Precondition — the in-flight `LeadGroup` work must be finished first.** At the time of
writing, `LeadGroup` exists on disk (Prisma model, `lead-groups.service.ts`,
`lead-groups.controller.ts`, migration `20260824030000_lead_groups`, a `company-owned.ts`
classification) as uncommitted work, but `crm.manifest.ts` claims neither the `LeadGroup` model
nor that migration, so `check:modules` does not currently pass on it. Whoever picks this spec up
lands those manifest entries first; the grouping stories below assume `LeadGroup` is real and
declared.

## Problem Statement

The Leads board only accepts leads one at a time, typed in by hand, by somebody already signed
in. Every other way a lead actually arrives has nowhere to land: a conference badge-scan export
sitting in a spreadsheet, a "contact us" form on the company's own website, a lead handed over by
whatever tool marketing happens to use. Each of those is re-keyed by a person, or it never
arrives at all — and re-keying is where the source gets lost, so the one question the board
should be able to answer ("which channel is actually producing customers?") stays unanswerable.

The board is also fixed in shape. Every company tracks something about a lead that this schema
does not have a column for — industry, budget, campaign, which trade show, the referrer's name —
and today that means either abusing the notes field or asking a developer for a migration. The
same is true of arrangement: a company that thinks about its leads by region, by campaign, or by
rep has to hold that grouping in its head.

And once a lead is on the board, reaching them is somebody else's job entirely. Chasing a lead
means leaving this application, opening Gmail or Outlook, re-typing the same message with the
same paragraph pasted in for the fifth time that week, and coming back to log an `Activity`
saying it happened — which either does not happen, or happens from memory. Nobody can send to a
segment at all, and nobody can tell whether anything sent was ever opened, so "follow up with the
ones who read it" is not a thing anyone can do.

## Solution

Give the Leads board every door a lead can walk through, and everything needed to work them once
they are on it.

**Capture.** Beside manual entry, three new intakes. A **spreadsheet import** uploads a CSV or
XLSX to the backend, maps its columns onto Lead fields (including the company's own custom
fields), and shows exactly what would be created and what would be rejected before anything is
written. A **`CaptureSource`** — a row named by an unguessable token, the same shape ADR 0002
gives sessions — is the single public door: a company publishes a customizable **web form**
whose submissions post to it, or hands the same token's URL to a third-party tool (Zapier, Make,
a vendor webhook) so its payload posts there too. Both land as ordinary `Lead` rows in the
token's company, attributed to that source, through one `@Public()` endpoint that resolves
tenancy with `withoutCompanyScope` → `runInCompany`, exactly as identity sign-up already does.

**Organization.** `LeadGroup` (already in flight) gives the board its swimlanes, and a company
defines its own **custom fields** without code: `LeadFieldDefinition` rows per company (label,
type, options, order) drive both the no-code field editor and server-side validation, with the
values themselves living in one JSON column on `Lead`. `source` stops being a fixed five-value
list and becomes a company-owned vocabulary of `LeadSource` rows, so "which channel is working"
is answered in the company's own words.

**Outreach.** A user connects their Gmail or Outlook mailbox — a `MailboxConnection` record
established through a `@Public()` OAuth callback — and can send a 1-on-1 email to a lead from
the lead's own screen, or a **campaign** to a selected segment. Both render a reusable
`EmailTemplate` with **dynamic tags** (`{{lead.name}}`, `{{lead.organisationName}}`, a custom
field, the sender's own name) resolved per recipient. Every send is delivered through the
platform's existing `Mailer` seam, writes an `Activity` of type `email` against the lead
automatically, and embeds a tracking pixel addressed by its own token, so an **open** is a
public `GET` that stamps one row — giving the campaign an open rate without a scheduler, a job
queue, or a webhook from anyone.

**Conversion.** The lead's stage stays the shipped `new → contacted → qualified/disqualified`
lifecycle, now visible and settable as a column on the board. **Convert** becomes one button:
one click searches or creates the `Party`, qualifies the `Lead` against it, and tags the Party
with the `prospect` role — three calls the frontend composes, because `crm`'s backend must never
write a `Party` or a `PartyRole` — and drops the user on the Contacts board with the new record
selected, ready for a `Deal`.

## User Stories

### Capture & ingestion

1. As a salesperson, I want to add a lead by hand from the board, so that a name I just heard on
   a call is captured before I forget it.
2. As a sales manager, I want to upload a spreadsheet of leads, so that a conference badge-scan
   export becomes two hundred board rows instead of two hundred typing jobs.
3. As a sales manager importing a spreadsheet, I want to map its columns onto our fields myself,
   so that a file exported by somebody else's tool does not have to be reshaped first.
4. As a sales manager importing a spreadsheet, I want the mapping to offer my company's custom
   fields alongside the built-in ones, so that the column I actually care about is not the one
   column that has to be dropped.
5. As a sales manager importing a spreadsheet, I want to see what would be created and what
   would be rejected — and why, row by row — before anything is written, so that I am never
   cleaning up a bad import afterwards.
6. As a sales manager importing a spreadsheet, I want rows that fail validation to be reported
   without stopping the good rows, so that one malformed email address does not cost me the
   other hundred and ninety-nine.
7. As a sales manager importing a spreadsheet, I want the file rejected clearly if it is too
   large or not a spreadsheet at all, so that the failure is a sentence rather than a stack
   trace.
8. As a sales manager, I want an import to record which import it came from on each lead, so
   that a bad batch can be found again later.
9. As a marketer, I want to build a web form by choosing which fields it asks for, in what
   order, and which are required, so that the form matches the campaign without involving a
   developer.
10. As a marketer, I want to publish that form at a public URL, so that a link in an ad or a page
    on our website feeds this board directly.
11. As a marketer, I want to embed the published form in our own website, so that a visitor never
    leaves our page to fill it in.
12. As a marketer, I want a form submission to become a lead on the board immediately, so that
    nobody re-keys a form fill.
13. As a marketer, I want to set what a submitter sees after submitting (a thank-you message or a
    redirect), so that the form is a finished experience rather than a dead end.
14. As a marketer, I want each form to stamp its own source and, optionally, its own group and
    assignee on the leads it creates, so that routing does not depend on somebody sorting the
    board afterwards.
15. As an operations person, I want to hand a third-party tool a webhook URL that creates leads
    here, so that whatever we already use for ads, chat, or events can feed the same board.
16. As an operations person, I want the webhook to accept the field names I map it to, so that I
    do not have to reshape the sending tool's payload.
17. As an operations person, I want to rotate or revoke a capture source's token, so that a URL
    that leaked stops working without my having to rebuild the form.
18. As an operations person, I want to pause a capture source without deleting it, so that a
    campaign can be stopped and restarted without losing its configuration or its history.
19. As an operations person, I want to see how many leads each capture source has produced, so
    that a form that silently broke is visible as a form that stopped producing.
20. As a company owner, I want a public capture endpoint to be rate limited and size capped, so
    that a published URL cannot be used to flood our board or our database.
21. As a company owner, I want a capture submission naming a field we do not accept to be
    refused rather than silently stored, so that the public door is exactly as wide as we opened
    it.
22. As a salesperson, I want a captured lead to record which source it came from and when, so
    that the first thing I see on the lead is where it came from.

### Data organization

23. As a sales manager, I want to arrange the board into groups I name and colour myself, so that
    it is laid out the way my team already thinks.
24. As a sales manager, I want to reorder groups and move a lead between them, so that the board
    keeps matching the process as it changes.
25. As a sales manager, I want to define our own lead sources rather than pick from a fixed list,
    so that "trade show" or "partner referral" can be named the way we say it.
26. As a sales manager, I want to rename a source without losing which leads already carry it, so
    that fixing a label is not a data migration.
27. As a sales manager, I want to be stopped from deleting a source or a group that leads still
    reference, so that a lead can never end up pointing at something that no longer exists.
28. As a sales manager, I want to add a custom field — text, number, date, single-select,
    multi-select, checkbox — without a developer, so that what we track is our decision.
29. As a sales manager defining a single-select field, I want to define its options, so that the
    column stays a vocabulary rather than free text.
30. As a sales manager, I want to reorder and rename custom fields, so that the lead screen reads
    in the order we think in.
31. As a sales manager, I want to mark a custom field required, so that a lead cannot be saved
    without the one thing we always need.
32. As a sales manager, I want to archive a custom field rather than delete it, so that values
    already captured are not destroyed by a change of mind.
33. As a salesperson, I want custom fields to appear on the lead form, the lead detail, the
    import mapping, and the web-form builder, so that a field defined once is a field available
    everywhere a lead is touched.
34. As a salesperson, I want a custom field's value validated against its type, so that a date
    field never contains "next Tuesday-ish".
35. As a salesperson, I want to search the board by name, organisation, or email, so that finding
    one lead among hundreds is one box, not a scroll.
36. As a salesperson, I want to filter the board by status, source, group, or owner, so that "my
    contacted leads from the webinar" is a view rather than a memory exercise.
37. As anyone viewing the board, I want each group to show how many leads it holds, so that the
    shape of the board is legible before I read a single row.

### Email & outreach

38. As a salesperson, I want to connect my Gmail or Outlook mailbox, so that mail sent from here
    comes from me rather than from a system address my recipient does not recognise.
39. As a salesperson, I want to see whether my mailbox is connected and disconnect it, so that I
    stay in control of an authorisation I granted.
40. As a salesperson whose mailbox connection has expired or been revoked, I want to be told
    plainly the next time I try to send, so that I never believe a message went out when it did
    not.
41. As a salesperson, I want to send a 1-on-1 email to a lead from the lead's own screen, so that
    following up does not mean leaving the application and losing the context.
42. As a salesperson, I want a sent email to be logged as an `Activity` against that lead
    automatically, so that the timeline is a true record without my writing it twice.
43. As a salesperson, I want to write and save reusable email templates, so that the fifth
    follow-up this week is a selection rather than retyping.
44. As a salesperson, I want templates to carry dynamic tags — the lead's name, organisation, a
    custom field, my own name — so that one template is personal to every recipient.
45. As a salesperson, I want to preview a template rendered against a real lead before sending,
    so that a broken tag is caught by me and not by the customer.
46. As a salesperson, I want a tag with no value for a particular lead to fall back to something I
    chose, so that nobody receives an email addressed to "Hi ,".
47. As a sales manager, I want to send a campaign to a segment of the board — a filter, a group, a
    selection — so that reaching fifty leads is one action.
48. As a sales manager, I want to see the exact recipient list, deduplicated by email address,
    before a campaign sends, so that nobody receives the same message twice and nobody
    unintended is on it.
49. As a sales manager, I want a lead with no email address, or one who has unsubscribed, to be
    excluded from a campaign automatically and shown to me as excluded, so that the reason a
    count differs is never a mystery.
50. As a sales manager, I want a campaign to send in bounded batches with visible progress, so
    that a large send is something I can watch finish rather than a request that times out.
51. As a sales manager, I want a campaign that fails partway to be resumable without re-sending
    to anyone who already received it, so that a hiccup does not become a duplicate send.
52. As a sales manager, I want to see per-campaign delivery counts and an open rate, so that I can
    tell a message that landed from one that did not.
53. As a sales manager, I want to see which individual recipients opened, so that follow-up can
    start with the people who showed interest.
54. As a sales manager, I want an open recorded against the lead's timeline as well, so that the
    lead's own history tells the whole story.
55. As a recipient, I want an unsubscribe link in every campaign email, so that I can stop
    receiving them without replying to ask.
56. As a recipient who unsubscribed, I want to stay unsubscribed for every future campaign from
    that company, so that opting out means what it says.
57. As a sales manager, I want to save a campaign as a draft and come back to it, so that writing
    it and sending it can be two different afternoons.
58. As a sales manager, I want a sent campaign to be immutable, so that its recorded results
    always describe what was actually sent.

### Qualification & conversion

59. As a salesperson, I want to see and change a lead's stage from the board, so that keeping the
    board honest is one click rather than a form.
60. As a salesperson, I want to convert a qualified lead into a contact with one click, so that
    the moment a lead becomes real is not a five-screen chore.
61. As a salesperson converting a lead whose organisation already exists as a `Party`, I want the
    existing record offered to me for linking, so that converting never fragments the address
    book.
62. As a salesperson converting a lead, I want the new contact tagged as a `prospect`, so that the
    address book records what this party is to us without claiming they are already a customer.
63. As a salesperson, I want to be taken to the new contact on the Contacts board after
    converting, so that the next step — creating a `Deal` — is right there.
64. As a salesperson, I want the converted lead to keep pointing at the party it became, so that
    the lead's own history stays reachable from the customer record and back.
65. As a salesperson, I want converting to be refused for a lead that is already converted or
    currently disqualified, so that the conversion record can never mean two things.
66. As a sales manager, I want a conversion to emit the same `crm.lead.qualified` event the
    shipped module already emits, so that automation and dashboards see conversions from the new
    button exactly as they see them today.
67. As a sales manager, I want to see how many leads each source converted, not just how many it
    produced, so that channel spend is judged on customers rather than on volume.

### Across all of it

68. As anyone using this platform, I want every new record here — capture sources, field
    definitions, templates, campaigns, mailbox connections — to belong to the company I am signed
    into, so that tenant isolation is never a special case.
69. As a company owner, I want a public capture or tracking request to be able to reach only the
    one company its token names, so that a public door is never a door into somebody else's data.
70. As a company just starting, I want each new screen — capture sources, custom fields,
    templates, campaigns — to say what to do first when it is empty, so that a blank screen never
    reads as broken.

## Implementation Decisions

Everything below lives in the existing `crm` module (Core tier, `dependsOn: ['parties']`). No new
module, no new dependency edge; the platform-level additions are called out explicitly as such.

### Capture: one public door

**`CaptureSource`** — `id`, `companyId`, `kind` (`'form' | 'webhook'`), `name`, `token`
(unguessable, unique, the addressable half — rotatable), `enabled` (boolean, the pause switch),
`config` (JSON: for a form, the ordered field list with per-field required flags, plus submit
behaviour — `{ kind: 'message', text }` or `{ kind: 'redirect', url }`; for a webhook, the
inbound-key → field mapping), `defaultSourceId`, `defaultGroupId`, `defaultAssignedToUserId`
(all nullable), `submissionCount`, `lastSubmissionAt`. Token-addressed rows are ADR 0002's
existing shape (sessions are rows named by tokens) applied to a second thing that has to be
reachable without a session; rotation replaces the token in place, so the source keeps its
identity and its counts.

**One `@Public()` capture endpoint** serves both kinds: `POST /api/crm/capture/:token`. It
resolves the `CaptureSource` with `withoutCompanyScope('…')`, then does every write inside
`runInCompany` — the exact pattern identity sign-in and password recovery already use, and the
one sanctioned escape hatch from tenancy. A form submission and a third-party webhook differ
only in how the payload's keys are mapped onto Lead fields, which is `config`'s job, not the
endpoint's. The response carries only what a public caller may know: accepted or refused, and
the configured submit behaviour. A disabled source, an unknown token, and a token belonging to a
deleted company all answer the same way, so the endpoint cannot be used to enumerate anything.

**Public-door safety is part of this spec, not a follow-up**: a body size cap, a per-token rate
limit with a `429` refusal, a cap on the number of fields, and rejection of any key the source's
`config` does not name. Rate-limit state is in-process (this is a single-node deployment; no
shared store exists to put it in) and that limitation is written down rather than implied.

**Web-form rendering** is a page in the `application` workspace at a public route, reading the
source's `config` through a second `@Public()` read endpoint (`GET /api/crm/capture/:token/form`)
that returns the field list and nothing else about the company. Embedding is an `<iframe>` snippet
the builder shows for copying — no third-party script tag, because a script tag is a promise
about a hosted asset that this platform has no CDN to keep.

**Spreadsheet import uploads the file to the backend** (the user's decision; the alternative was
parsing in the browser). That makes it the **first file upload this platform has ever accepted**,
so the multipart handling is added at the platform level rather than invented inside `crm`, in
the spirit of `platform/mail`: one place, one size cap, one content-type allowlist, reusable by
the next module that needs it. The parsed rows are validated through `crm`'s own field
validators; the uploaded file is parsed in-request and **never persisted** — no blob store is
being invented here, and an import that has already produced rows has nothing left to keep.

The validation pipe does not see a multipart body, so the import endpoint validates after
parsing, in the service, explicitly — the same visible-at-the-point-it-is-made bargain `@Public()`
strikes, and worth a comment saying so where it happens.

Import is two endpoints against one uploaded file: a **dry run** returning `{ accepted, rejected:
[{ row, field, message }] }` with nothing written, and a **commit** that writes the accepted rows
and reports the same shape. Rejected rows never block accepted ones. Each committed row records
its `LeadImport` batch (`id`, `companyId`, `filename`, `rowCount`, `acceptedCount`, actor freeze
pair `importedByUserId`/`importedByName` matching `Activity`'s existing actor discipline), so a
bad batch is findable afterwards.

### Organization: sources, groups, custom fields

**`LeadSource` becomes a company-owned row** (`id`, `companyId`, `name`, `order`) rather than the
shipped fixed `LEAD_SOURCES` list, and `Lead.source` becomes `Lead.sourceId`. This is a
migration with a data step: every existing `Lead.source` string value present in a company
becomes a `LeadSource` row for that company, and each Lead is repointed at it — no company loses
its history and no company is seeded with a vocabulary it did not choose. Deleting a `LeadSource`
still referenced by a Lead is refused, exactly as deleting an occupied `Stage` is; renaming is
unrestricted.

**`LeadGroup`** is the in-flight model, finished: declared in the manifest's `models` and
`migrations`, classified in `company-owned.ts` (already done), reorderable, and refusing deletion
while it holds leads. Its current auto-provision of a default "New Leads" group on an empty list
read is a write on a read and contradicts this platform's stated empty-state discipline ("the
running application seeds nothing, ever") — remove it; an empty group list is an empty state
that says "create your first group", the same as `Stage`'s.

**Custom fields are definition rows plus a JSON value column** (the user's decision).
`LeadFieldDefinition`: `id`, `companyId`, `key` (stable, generated from the label at creation and
never changed afterwards — a rename changes the label, not the key, so stored values never
orphan), `label`, `type` (`'text' | 'number' | 'date' | 'select' | 'multiselect' | 'checkbox'`),
`options` (JSON string array, `select`/`multiselect` only), `required` (boolean), `order`,
`archivedAt` (nullable — archive, never delete, so captured values survive a change of mind).
`Lead.customValues` is one JSON column keyed by definition `key`.

A stated consequence, not an oversight: custom fields do not participate in the platform's
`ListSpec` sort/filter grammar in this cut. `ListSpec` declares fields statically and a JSON
column has no static fields; making per-field filtering work would mean either the EAV shape
that was rejected or a new generated-column mechanism. Built-in fields (`status`, `sourceId`,
`groupId`, `assignedToUserId`, `name`, `email`, `createdAt`) get the full grammar — that is what
story 36 asks for — and custom fields are displayed, set, validated, imported, and capturable,
but not filtered on. If that hurts in practice, a targeted follow-up adds it.

Server-side validation of `customValues` against the definitions happens on every write path that
can set them — manual create/update, import commit, and public capture — in one shared validator,
so the public door is never the lenient one.

### Outreach

**`MailboxConnection`** — `id`, `companyId`, `userId`, `provider` (`'gmail' | 'outlook'`),
`emailAddress`, `displayName`, `status` (`'connected' | 'expired' | 'revoked'`), token material,
`connectedAt`. One connection per user per provider. The OAuth authorisation-code callback is a
`@Public()` route (the provider redirects a browser that carries no session of ours), correlated
by a short-lived state token — a token-named row again, same as everything else here.

**Delivery goes through the existing platform `Mailer`** (the user's decision), which is
`DevMailer` everywhere today. `MailboxConnection` therefore determines the *from* identity and
the "am I allowed to send" check, and the message itself is handed to the one seam this platform
already has. Two consequences, stated plainly rather than discovered later:

- Real delivery through a recipient's actual Gmail/Outlook mailbox is not what ships here.
  Binding a real provider is a platform-wide change (`Mailer` has exactly one implementation, by
  design, and the outbound seam has never been wired to a vendor — see the Expenses email-gateway
  research). Everything in this spec is built and tested against `Mailer`; when a real provider
  is bound, this feature sends for real with no change to `crm`.
- `MailMessage` gains an optional `html` body. It is plain-text-only today, and an open pixel and
  an unsubscribe link have nowhere to live in plain text. This is a small, additive platform
  change: `body` stays required, `html` is optional, and `DevMailer` records both.

**`EmailTemplate`** — `id`, `companyId`, `name`, `subject`, `body` (HTML), `createdByUserId`.
Dynamic tags are `{{namespace.field}}` resolved per recipient against a fixed namespace set —
`lead.*` (built-in fields), `custom.*` (by definition key), `sender.*` (the connected mailbox's
display name and address) — with a per-tag fallback (`{{lead.name|there}}`). One renderer
resolves tags for both 1-on-1 and campaign sends, and it is the single most test-worthy pure unit
in this feature. An unknown namespace or field is a refusal at save time, not a silent empty
string at send time.

**`Campaign`** — `id`, `companyId`, `name`, `templateId`, `segment` (JSON: the saved filter,
group ids, or explicit lead ids the recipient list was built from), `status` (`'draft' |
'sending' | 'sent' | 'failed'`), `createdByUserId`, `sentAt`. **`CampaignRecipient`** — `id`,
`companyId`, `campaignId`, `leadId`, `emailAddress`, `status` (`'pending' | 'sent' | 'failed' |
'skipped'`), `skipReason`, `sentAt`, `openToken` (unique), `openedAt`, `openCount`.

**Sending is request-driven and batched, never scheduled.** This platform has no scheduler and no
job queue (ADR 0009; confirmed again for this spec), and the CRM map has already resolved once
that a scheduler is not something to invent as a side effect of a feature ticket. So: one
endpoint materialises the recipient list (`draft → sending`, one `CampaignRecipient` row per
deduplicated, non-unsubscribed, email-bearing lead, with skips recorded and their reasons kept),
and a second endpoint sends one bounded batch of pending recipients and returns progress. The
frontend drives batches to completion and shows the bar. Resuming is free and idempotent — the
next batch is by definition the rows still `pending` — which is what makes story 51 true rather
than aspirational. A campaign leaves `draft` exactly once and is immutable afterwards.

Each successful send writes an `Activity` (`type: 'email'`) against the lead through the existing
activities path, so the timeline stays the one place a relationship's history lives.

**Open tracking** is a `@Public()` `GET /api/crm/e/:openToken.gif` returning a 1x1 transparent
GIF and stamping `openedAt`/`openCount` on that recipient row via `withoutCompanyScope` →
`runInCompany`. First open stamps `openedAt` and also writes one `Activity` against the lead;
later opens increment the count only, so the timeline records the event rather than the noise. A
campaign's open rate is `opened / sent`, computed on read — never stored, so it can never drift.
The known limitation goes in the docs and on the screen: an image-blocking client never fires the
pixel, so an open rate is a floor, not a measurement.

**`Unsubscribe`** — `id`, `companyId`, `emailAddress`, `unsubscribedAt`, `campaignId` (nullable,
the campaign it came from). Keyed by address rather than by lead, because the same person may be
two lead rows and opting out means opting out. A `@Public()` unsubscribe endpoint, token-addressed
like everything else public here, and a recipient-list build that excludes any address present.

### Conversion

**No backend change to the conversion rules** — the shipped `qualify` endpoint already refuses a
lead that is already qualified or currently disqualified, sets `partyId` and `status`, evaluates
`WorkflowRule`s and emits `crm.lead.qualified`. The one-click convert is a frontend composition
over three calls, exactly as the shipped spec settled: search-or-create the `Party` through
Parties' own endpoints, call `crm`'s `qualify` with the resulting `partyId`, then tag the Party
`prospect` through Parties' `POST /parties/:id/roles`. `crm`'s backend still never writes a
`Party` or a `PartyRole`, and this spec does not weaken that — "one click" is a property of the
button, not a reason to collapse a module boundary.

The convert flow does add a duplicate check before creating: search `PartyDirectory` by the
lead's email and organisation name, and offer any match for linking before offering creation, so
story 61 is the default path rather than the careful path. Afterwards the user lands on the
Contacts board with the new party selected.

**Source conversion reporting** (story 67) extends the existing `crm` dashboard rather than
starting a second one: leads produced and leads converted, grouped by `sourceId`, over a date
range — an ordinary `groupBy` through the scoped Prisma client, like every other dashboard query
already there.

### Manifest, permissions, events

New models claimed in `crm.manifest.ts`: `LeadGroup` (outstanding), `LeadSource`,
`LeadFieldDefinition`, `LeadImport`, `CaptureSource`, `MailboxConnection`, `EmailTemplate`,
`Campaign`, `CampaignRecipient`, `Unsubscribe` — each also classified in `company-owned.ts`, and
each new migration declared. New permissions in `crm`'s own namespace:
`crm:capture-sources:read|write`, `crm:lead-fields:read|write`, `crm:templates:read|write`,
`crm:campaigns:read|write`, `crm:mailbox:write`. Public endpoints carry `@Public()` and no
permission, which is the third of the three mutually exclusive access decorators conformance
already enforces.

New events emitted (declared only once something emits them): `crm.lead.captured` (payload
carries `captureSourceId` and `kind`), `crm.lead.imported`, `crm.campaign.sent`,
`crm.email.opened`. Emitted after commit, never inside the write's transaction. `crm` consumes
nothing, as today.

## Testing Decisions

A good test here asserts what a caller can observe — a response body, a row, a message in
`DevMailer.sent` — and never how the service reached it. Nothing below mocks anything inside the
application: `PartyDirectory`, the scoped Prisma client, and `Mailer` are all exercised for real,
the same discipline `crm.spec.ts` and `inventory.spec.ts` already hold.

**Primary seam: HTTP integration tests against a real Postgres test database**, via
`createTestApp`/`resetDatabase` (`backend/test/harness/test-app.ts`). Prior art to follow
closely: `backend/test/crm.spec.ts` (leads, two-company isolation), `backend/test/crm-deals.spec.ts`,
`backend/test/crm-dashboard-events.spec.ts` (asserting emitted events), `backend/test/inventory.spec.ts`
(money round-tripping and public-surface use), `backend/test/identity.spec.ts` and
`password-reset.spec.ts` (the existing prior art for `@Public()` routes and token-named rows —
read these before writing the capture tests, because the shape is already settled there).

Given the surface, split the new backend tests by pillar rather than growing one file: capture
(`crm-capture.spec.ts`), organization (`crm-lead-fields.spec.ts`), outreach
(`crm-outreach.spec.ts`), matching how `crm-deals` and `crm-dashboard-events` were already split
out.

What each pillar must cover:

- **Capture.** A form-kind and a webhook-kind source both creating a lead in the token's company;
  the source's default source/group/assignee applied; a submission naming an unconfigured field
  refused; a disabled source, an unknown token, and a rotated-away token all refused identically;
  the rate limit refusing with `429` and the size cap refusing an oversized body;
  `submissionCount`/`lastSubmissionAt` advancing; and — the one that matters most — a token from
  company A never producing a row in company B. The public form-read endpoint returning the field
  list and nothing else about the company.
- **Import.** Upload of a small CSV and a small XLSX fixture; dry run writing nothing and
  reporting per-row rejections with row numbers; commit writing the accepted rows only; a
  malformed row not blocking its neighbours; a non-spreadsheet upload and an oversized upload
  each refused with a message; custom-field columns mapped and validated; the `LeadImport` batch
  recorded with its actor freeze pair. Fixture files live beside the spec's other test data and
  stay deliberately tiny.
- **Organization.** `LeadSource` and `LeadGroup` CRUD, reorder, rename; deletion refused while
  referenced, allowed once not; the migration's data step covered by a test that a lead created
  before the change still resolves its source. `LeadFieldDefinition` CRUD; a value validated
  against each type; a required field refused when absent; an archived field's stored values
  still readable; a `select` value outside its options refused; the same validation applying on
  the manual, import, and public-capture write paths (this is the one worth asserting three
  times — a lenient public door is exactly the bug this catches).
- **Outreach.** Template save/render, including every namespace, a fallback firing for a missing
  value, and an unknown tag refused at save time. A 1-on-1 send appearing in `DevMailer.sent`
  with the rendered subject and body and writing an `Activity` against the lead. Campaign
  materialisation deduplicating by address, skipping leads with no email and unsubscribed
  addresses with reasons recorded; batch sending advancing `pending → sent` and being resumable
  without re-sending; a sent campaign refusing edits; the open pixel returning a GIF, stamping
  `openedAt` once and `openCount` repeatedly, writing exactly one `Activity`; open rate computed
  from rows; unsubscribe excluding an address from the next campaign. Send-time failure of one
  recipient leaving the others sendable.
- **Conversion.** The existing `qualify` behaviour still holding (regression against
  `crm.spec.ts`), `crm.lead.qualified` still emitted, and the dashboard's per-source
  produced-vs-converted counts reading back correctly against seeded data.
- **Tenant isolation for every new model**, two companies signed up, the same way `crm.spec.ts`
  already does it for `Lead` — and specifically for the three public paths (capture, open pixel,
  unsubscribe), because those are the only endpoints in this feature that reach the database
  without a session to scope them.

**Secondary seam: frontend component tests** (vitest + Testing Library + msw), prior art
`application/src/modules/crm/pages/LeadsPage.test.tsx` and `DealsPage.test.tsx`. Worth testing at
this seam and not the HTTP one: the import wizard's mapping and preview steps, the form builder's
field configuration, the campaign recipient preview and batch progress, and the one-click convert
composing its three calls in order and landing on Contacts. Test these through the rendered page
against mocked endpoints — no assertions on component internals.

**Structural seam: `backend/test/conformance.spec.ts` and `check:modules`** already cover what
matters and need no new tests, only compliance: every new model claimed by exactly one manifest,
every migration declared and ordered, every handler carrying exactly one of `@Public()`,
`@RequirePermission(...)` or `@NoPermissionRequired()`, and no import across a module boundary.
Run `check:modules`, `check:tenancy` and `check:conformance` before the suites — between them
they name what is wrong without needing a database.

## Out of Scope

- **Real Gmail/Outlook delivery.** Everything sends through the platform `Mailer`, which is
  `DevMailer` everywhere. Binding a real provider is a platform decision affecting invitations
  and password resets too, and is not made inside a CRM feature.
- **Inbound email and calendar sync** — auto-capturing replies and meetings onto the timeline.
  Already resolved on the CRM map as needing a real background scheduler for webhook-subscription
  renewal (`.scratch/crm-sales/research/05-live-communication-sync.md`), and still blocked on
  ADR 0009.
- **Scheduled or drip campaigns** — "send this on Tuesday", "send three days after the last one".
  Same scheduler gap. The `Campaign` shape here is additive, so this is a later extension rather
  than a rewrite.
- **Bounce, spam-complaint and delivery-receipt handling.** These arrive as provider webhooks; no
  provider is bound. `CampaignRecipient.status` has room for them when one is.
- **Click tracking.** Open tracking ships; rewriting links to count clicks is a second mechanism
  with its own redirect surface, and one public tracking endpoint is enough for this cut.
- **A/B testing, send-time optimisation, and deliverability tooling** (SPF/DKIM guidance, warm-up).
- **Lead scoring and automatic routing/assignment rules** beyond a capture source's fixed default
  assignee. Round-robin and territory routing stay where the map left them.
- **Custom fields on `Party`, `Deal`, or anything other than `Lead`.** The mechanism is
  deliberately built for one record first; generalising it is a later, better-informed decision.
- **Filtering and sorting the board by custom field** — stated above as a known consequence of
  the JSON-value shape, not an omission.
- **Deduplicating leads against each other on capture.** A duplicate check runs at conversion
  (against `Party`); merging two `Lead` rows is its own feature.
- **A hosted-script embed** for web forms. An `<iframe>` snippet ships; a script tag implies a CDN
  this platform does not have.
- **File storage.** Imports are parsed in-request and discarded. No blob store, no attachments on
  emails.
- **Shared-store rate limiting.** In-process only, stated as a single-node limitation.

## Further Notes

- **Read `.scratch/crm-sales/spec.md` first.** It settles the `Lead` lifecycle, the
  `assignedToUserId`-resolves-via-the-frontend rule (identity's public surface is deliberately
  empty — `backend/src/modules/identity/index.ts` exports `{}`), and the "`crm` never writes a
  `Party` or a `PartyRole`" boundary. All three constrain this spec and none of them is
  re-litigated here.
- **The in-flight `LeadGroup` work is the first thing to land**, manifest entries included, and
  its auto-provisioning read should go with it (see Organization). It is uncommitted at the time
  of writing, so check whether it has landed before assuming either way.
- **Two platform-level changes are in this spec**, both small, both additive, both deliberately
  placed at the platform rather than inside `crm`: multipart upload handling (first upload this
  platform has accepted) and an optional `html` body on `MailMessage`. Neither should be
  discovered halfway through a ticket; both are named here so they can be reviewed as platform
  changes.
- **Three public endpoints** (capture, open pixel, unsubscribe) plus the OAuth callback are the
  entire unauthenticated surface this feature adds. Identity's existing `@Public()` handlers and
  its token-named rows are the pattern to copy, and ADR 0002 is the reasoning behind it.
- **The scheduler question is deliberately not reopened.** Batch-on-request sending is the same
  "user's request drives the work" shape the Expenses recurring-scheduler research recommended
  for the same reason. When ADR 0009 is resolved, scheduled campaigns are the obvious extension.
