# Spec — Sales CRM: leads, pipeline, activities, automation & dashboards

Status: ready-for-agent

Consolidates the resolved decisions on the CRM: Sales map (`.scratch/crm-sales/map.md`): the
Destination's settled shape, plus the Lead model and conversion, the Deal & pipeline model, the
Activity logging model, workflow automation rules, and pipeline dashboards and events —
see the map's Decisions-so-far for the gist of each; this spec is their consolidated,
implementable form and the source of truth going forward.

**Live communication sync** was investigated and decided on the map (`research/
05-live-communication-sync.md`) but is **not** part of this spec's build: the finding was that
live email/calendar sync needs a real background scheduler (proactive webhook-subscription
renewal, not a one-off request), which this platform doesn't have yet (ADR 0009). Building it
here would mean quietly inventing that scheduler as a side effect. See Out of Scope.

**The CRM boundary for future pillars** (how Marketing/Service/Commerce will eventually join
Sales) remains open on the map's fog — a documentation/boundary decision, not something this
spec builds toward.

## Problem Statement

Nobody can run a sales process on this platform today — there is no CRM or Sales module. A
prospective customer starts as a name and a maybe-real interest, not yet a party the rest of the
system would recognize; today there is nowhere to put that except a spreadsheet, and no path from
"someone emailed us" to "this is a real customer with a deal in motion." Once a prospect is real,
tracking a sale's progress — what stage it's at, what it's worth, who's chasing it, what was said
and when, whether it's stalling — has no home either, and every company's stage vocabulary and
process differs enough that a fixed pipeline would fight half of them on day one. And once deals
exist, nobody can see the shape of the pipeline as a whole — how much is in flight, what's closing,
what's stuck — without exporting to something else.

## Solution

Stand up the `crm` module (Core tier) with two entry points into the sales cycle — a `Lead` for a
not-yet-qualified prospect, and a `Deal` for a `Party` (via the existing address book) that's
actually being sold to — connected by an explicit qualify step rather than assumed to be the same
record from the start. A `Deal` moves through a company-defined, relabelable pipeline of `Stage`s,
carries one aggregate value (using this platform's existing exact `Money` type, so currency is
never a free-text guess), and both Leads and Deals accumulate a manually-logged `Activity` timeline
(call, email, meeting, note, task) alongside anything else pointing at the same `Party`. A small,
sales-scoped no-code automation layer lets a company wire event-based triggers (a Deal enters a
named stage, a Lead's status changes, a tracked field changes) to built-in actions (notify a user,
update a field, create a follow-up task) without touching time — this platform has no scheduler,
so only things that happen *because a request happened* can trigger a rule, not things that happen
because time passed. `crm` ships its own basic pipeline dashboards (value by stage, win/loss rate,
activity counts) and emits domain events the same way Inventory already does, so the Reporting &
Analytics module can build richer views later without `crm` depending on it.

Ownership of a Lead or Deal is a plain platform User reference, resolved by the *frontend* calling
identity's existing `GET /api/identity/users` directly to populate an assignment picker and to
display a name — `crm`'s backend never resolves it, because identity's public surface is
deliberately empty (`backend/src/modules/identity/index.ts`: `export {}`) and no module may
depend on it. This mirrors the platform's existing pattern of composing a second frontend call
rather than adding a backend cross-module read (Expenses' Payee ticket does the same thing against
Parties' role-write endpoint).

## User Stories

1. As a salesperson, I want to record a Lead as soon as I have a name and a way to reach them, so
   that nothing promising falls through before I know if it's real.
2. As a salesperson, I want to log the Lead's source (referral, inbound form, cold outreach, ...),
   so that I can tell later which channels are actually working.
3. As a salesperson, I want to qualify a Lead into a real customer record, so that everything else
   in the system that already knows about parties — addresses, roles, future modules — recognizes
   them too.
4. As a salesperson qualifying a Lead whose company already has a Party record (e.g. from Products
   or Expenses), I want to link to that existing Party instead of creating a duplicate, so that the
   address book doesn't fragment.
5. As a salesperson, I want a Lead I can't reach or who says no to be marked disqualified rather
   than deleted, so that the record and its history stay if they come back later.
6. As a salesperson, I want to reopen a disqualified Lead, so that a "not now" doesn't have to mean
   starting over from nothing six months later.
7. As a salesperson, I want to create a Deal directly against an existing Party (not only via Lead
   qualification), so that an inbound sales conversation that never went through a Lead still has
   somewhere to live.
8. As a sales manager, I want my company's pipeline stages to use our own terminology and order, so
   that the tool matches how we actually sell rather than a generic template.
9. As a sales manager, I want to add, reorder, and relabel stages from the deals board itself
   ("edit labels"), so that adjusting the process doesn't require anyone outside the sales team.
10. As a sales manager, I want to mark specific stages as meaning "won" or "lost", so that closed
    deals are unambiguous no matter what a company chooses to call that stage.
11. As a sales manager, I want deals in a stage I'm about to delete to be blocked from deletion
    (or explicitly reassigned first), so that closing deals never silently vanish from the pipeline.
12. As a salesperson, I want to see and set a Deal's amount and currency using the same exact-money
    handling the rest of the platform uses, so that pipeline totals are never a rounding surprise.
13. As a salesperson, I want a Deal to optionally show which Lead it came from, so that I can trace
    a win back to the channel that produced it — without that link ever being required.
14. As a salesperson, I want to assign a Lead or Deal to a colleague, so that ownership is clear as
    work gets divided across a team.
15. As anyone viewing a Lead or Deal, I want to see who it's assigned to by name, so that "whose is
    this" never requires guessing from a bare ID.
16. As a salesperson, I want to log a call, email, meeting, or note against a Lead, Deal, or Party,
    so that the history of a relationship lives in one place instead of scattered notebooks.
17. As a salesperson, I want to log a follow-up task the same way, so that "call them back
    Thursday" doesn't depend on my memory.
18. As anyone viewing a Lead, Deal, or Party, I want to see every Activity logged against it in one
    timeline, so that catching up on a relationship takes one screen, not several.
19. As a sales manager, I want to configure a rule like "when a Deal enters Proposal Sent, notify
    its owner" without writing code, so that process reminders don't depend on someone remembering
    manually.
20. As a sales manager, I want a rule that updates a field automatically on a trigger (e.g. stamp a
    "last stage change" timestamp), so that derived bookkeeping doesn't need a person to do it.
21. As a sales manager, I want a rule's action to create a follow-up Activity (task) automatically,
    so that a stage change can hand someone their next step without a separate manual entry.
22. As a sales manager, I want multiple rules to be able to match the same trigger and all fire, so
    that I'm not forced to squeeze unrelated reactions into one rule.
23. As anyone with visibility into sales, I want a dashboard showing pipeline value broken down by
    stage, so that I can see the shape of what's in flight without exporting anything.
24. As anyone with visibility into sales, I want to see a win/loss rate, so that I know whether the
    process is actually converting.
25. As anyone with visibility into sales, I want to see activity counts (e.g. per rep, per period),
    so that I can tell where effort is actually going.
26. As a developer building Reporting & Analytics' future cross-module views, I want `crm` to
    already emit events for qualification, deal-won, deal-lost, and stage changes, so that I don't
    have to add instrumentation to a module that's already shipped.
27. As a company just starting to use Sales, I want an empty Leads list, an empty (but
    stage-creatable) deals board, and empty dashboards to say clearly what to do first, so that a
    blank screen never reads as broken.
28. As anyone using this platform, I want a Lead, Deal, or Activity to always belong to the company
    I'm signed into, exactly like every other record on this platform, so that tenant isolation is
    never a special case for Sales.

## Implementation Decisions

**New module: `crm`.** Tier: `core` (decided on the map — customers and pipeline are as
fundamental as the address book they extend). `dependsOn: ['parties']`. No `dependsOn: hrm`
(Enterprise tier; a Core module can't reach up) and no `dependsOn: identity` (identity's public
surface is deliberately empty — see below).

**`Lead` schema and endpoints** — its own record, not a `Party`:
- Fields: `id`, `companyId`, `name`, `organisationName` (free text — no Party exists yet),
  `email`, `phone` (both nullable), `source` (string, e.g. `'referral' | 'inbound' | 'outbound' |
  'event' | 'other'` — a plain wire-contract value like `Party.kind`, not a Postgres enum, so a
  company's real source vocabulary isn't fixed at ship time), `status` (string: `'new' |
  'contacted' | 'qualified' | 'disqualified'`), `assignedToUserId` (nullable UUID, no FK — see
  ownership below), `partyId` (nullable UUID, no FK constraint, resolved through `PartyDirectory`)
  — set once qualification links or creates a Party.
- Standard CRUD plus a `qualify` endpoint: `{ action: 'create' } | { action: 'link', partyId }`.
  `create` calls `PartyDirectory`... no — `PartyDirectory` is read-only (`party`, `parties`,
  `withRole`); creating a Party is Parties' own `POST /api/parties`. The frontend composes the
  flow: create-or-search Parties directly, then call `crm`'s qualify endpoint with the resulting
  `partyId`, which sets `Lead.partyId` and `Lead.status = 'qualified'` server-side in one request.
  Tagging the new Party with a `prospect` role (a new role string, not `customer` — a qualified
  Lead isn't a paying customer yet) is a second frontend call to Parties' existing
  `POST /parties/:id/roles`, same composition Expenses' Payee ticket already established. `crm`'s
  backend never writes `PartyRole` and never creates a `Party` row.
- `disqualify` and `reopen` endpoints toggle between `disqualified` and the status held before
  disqualification (stored, not inferred, so reopening doesn't guess).
- Qualifying does **not** create a `Deal` automatically — that's always a separate, explicit
  action (create a Deal against the resulting Party), keeping Lead-conversion and Deal-creation
  as two composable steps rather than one that silently does both.

**`Stage` and `Deal` schema and endpoints:**
- `Stage`: `id`, `companyId`, `name`, `order` (integer, unique per company, defines board
  position), `outcome` (nullable string: `'won' | 'lost' | null` — null for every in-flight
  stage; at most one stage may hold each of `'won'`/`'lost'` per company, enforced at the
  application layer since it's a cross-row invariant Postgres can't express as a simple
  constraint here). No seed data: a fresh company has zero stages and must create its own before
  a Deal can exist — the deals board's empty state is "create your first stage," mirroring
  Expenses' Category discipline.
- Deleting a `Stage` that has Deals in it is refused (`ApiException`, named like every other
  module's refusal) — a company must move or close those Deals first. Reordering and renaming
  (`PATCH`) are unrestricted at any time.
- `Deal`: `id`, `companyId`, `partyId` (mandatory, no FK, resolved through `PartyDirectory`),
  `stageId` (mandatory, FK within company), `name`, `amount` (this platform's `MoneyValue` —
  `packages/src/numeric/money.ts` — decimal text over the wire, never a JSON number, currency
  fixed to `DEFAULT_CURRENCY` per ADR 0004 exactly like every other money-carrying record on this
  platform; no per-Deal currency choice, since multi-currency is out of scope platform-wide, not
  just here), `expectedCloseDate` (nullable date), `assignedToUserId` (nullable UUID, no FK),
  `originLeadId` (nullable UUID, no FK — optional, informational only, never required).
  **No line items, no `dependsOn: products`** — an aggregate value only, per the map's Destination.
- Moving a Deal to a stage whose `outcome` is `'won'` or `'lost'` is how a Deal closes — no
  separate close endpoint; the outcome is read off the current stage, not stored redundantly on
  the Deal itself, so "what does closed mean" can never drift between the two.

**Ownership (`assignedToUserId`) resolves through the frontend, not a backend directory.**
Identity's public surface is empty by design (`backend/src/modules/identity/index.ts`), so no
module — `crm` included — may depend on it or resolve a user's name server-side. `crm` stores an
opaque `assignedToUserId` with no FK and no name freeze (this is a *live*, reassignable reference,
unlike `StockMovement`'s frozen `recordedById`/`recordedByName` actor pattern, which records a
historical fact). The frontend populates the assignment picker and resolves display names by
calling identity's existing `GET /api/identity/users` directly and joining client-side — the same
"compose a second call, don't add a backend edge" discipline the Party-role-tagging flow already
uses.

**`Activity` schema and endpoints** — one shared timeline model for manual logging:
- Fields: `id`, `companyId`, `type` (string: `'call' | 'email' | 'meeting' | 'note' | 'task'`),
  `notes` (text), `occurredAt` (timestamp, defaults to now but editable — a call from yesterday
  logged today should sort by when it happened), `dueAt` (nullable, meaningful only for `type =
  'task'`), `completedAt` (nullable, `type = 'task'` only — set/cleared by its own endpoint, not
  general update, so "done" is always an explicit action), `createdByUserId`/`createdByName`
  (frozen pair at write time, same actor-freeze mechanism as `StockMovement.recordedById`/
  `recordedByName` — this *is* a historical fact, unlike assignment above), plus exactly one of
  `leadId`, `dealId`, `partyId` (nullable FKs within company; the API refuses a request setting
  more than one or none).
- Append-only: no update or delete endpoint on a logged Activity in this spec (a `task`'s
  `completedAt` is the one narrow, purpose-built exception, not general editability) — matters
  later if ticket 05's live sync ever writes here, but decided now on its own merits: a call log
  is a record of what happened, not a draft.
- A timeline read endpoint per parent (`GET /api/crm/leads/:id/activities`, etc.) returns activities
  in `occurredAt` order; the same shared list component reads all three.

**Workflow automation — `WorkflowRule`, event-triggered only, no time-based triggers:**
- `WorkflowRule`: `id`, `companyId`, `name`, `triggerType` (string: `'deal.stage_changed' |
  'lead.status_changed'`), `triggerConfig` (JSON: `{ toStageId }` or `{ toStatus }` — the specific
  value the change must land on to match; matching *any* change of that kind is `triggerConfig:
  null`), `actionType` (string: `'notify_user' | 'update_field' | 'create_task'`), `actionConfig`
  (JSON, shaped per `actionType`: `{ userId }` for notify, `{ field, value }` for update — value
  domain restricted to fields this spec exposes for writing, i.e. `Deal.stageId`/`Lead.status`
  themselves are excluded from `update_field` to prevent a rule silently re-triggering its own
  kind of trigger — `{ dueInDays, notes }` for create-task), `enabled` (boolean). Flat list per
  company, no visual canvas — a structured form (trigger dropdown, condition, action dropdown,
  action fields), matching the map's "start with the structured-form version" recommendation.
- **No time-based triggers** (e.g. "no Activity in N days") in this spec. This platform has no
  real scheduler (`.scratch/expenses-accounting/issues/06-recurring-scheduler.md`'s finding), and
  ticket 05's resolution independently found that the *next* thing needing one — live sync — is
  exactly the kind of proactive, unattended work a scheduler is for. Adding a second,
  unrelated feature that also needs one would be deciding the scheduler question by accident,
  inside an automation ticket, rather than on its own. When a scheduler exists (ADR 0009),
  time-based triggers are the obvious next `WorkflowRule` extension — not a rewrite.
- Evaluation: synchronous, inside the same request that caused the trigger (the stage-change or
  status-change endpoint evaluates matching enabled rules after its own write commits, same
  non-transactional, best-effort discipline as `DomainEvents` — "a listener that throws does not
  undo what happened"). All matching rules fire; no declared ordering between them in this spec.
- `notify_user` in this cut means an in-app notification record the assigned/named user can see
  on next login — no email/push delivery infrastructure exists on this platform yet, and inventing
  one is out of scope here.

**Dashboards and events:**
- Dashboard queries: pipeline value by stage (sum of `Deal.amount` grouped by `stageId`, only
  Deals whose stage has `outcome: null` plus each closed bucket separately), win/loss rate
  (count of Deals whose current stage `outcome = 'won'` vs `'lost'`, over a selectable date range
  keyed on when each landed in its closing stage), activity counts (grouped by `type` and by
  `createdByUserId`, over a selectable date range). All are `aggregate`/`groupBy` queries through
  the ordinary Prisma client — Reporting & Analytics' map already verified `check:tenancy`'s
  scoping extension covers both natively, so none of this needs `$queryRaw` or a materialized
  snapshot table.
- Events declared in the manifest: `crm.lead.qualified`, `crm.lead.disqualified`,
  `crm.deal.created`, `crm.deal.stage_changed` (payload includes `fromStageId`, `toStageId`,
  `outcome` of the new stage), `crm.deal.won`, `crm.deal.lost` (the latter two derived from
  `stage_changed` landing on an outcome stage, emitted alongside it so a consumer wanting only
  closes doesn't have to inspect payload). Emitted after commit, never inside the write's own
  transaction, per `DomainEvents`' existing discipline. Nothing in this spec consumes another
  module's events — `crm` is an emitter here, matching Inventory's role for Accounting.

## Testing Decisions

- **Seam: HTTP integration tests against a real Postgres test database**, following
  `test/inventory.spec.ts`'s pattern — `createTestApp`/`resetDatabase` harness, nothing mocked
  below the endpoint, two companies signed up per isolation test.
- Test only external behavior through `crm`'s HTTP surface: request in, response and database
  state out. No assertions against internal service methods.
- `PartyDirectory` is exercised for real (same process, real DB), not mocked — same discipline as
  `test/inventory.spec.ts` exercising `ProductCatalogue` for real.
- Cover Lead lifecycle: create, qualify via `create` (new Party) and `link` (existing Party),
  disqualify/reopen round-trip, and that qualify's Party-role-tagging is a frontend-composed call
  (i.e. the backend test asserts `crm` never writes `PartyRole` — no such write path exists to
  call).
- Cover Stage CRUD: create, reorder, rename: refuse deleting a Stage with Deals in it; refuse a
  second `'won'` or a second `'lost'` stage per company.
- Cover Deal lifecycle: create against a Party, move between stages, closing by landing on a
  `'won'`/`'lost'` stage, and that `amount` round-trips as exact decimal text (prior art:
  Inventory's money-field tests) rather than a JSON number.
- Cover Activity: logging each `type` against each of the three parent kinds, refusing a request
  naming zero or more than one parent, task `completedAt` set/clear, and append-only enforcement
  (no update/delete endpoint exists to call).
- Cover `WorkflowRule`: a `deal.stage_changed` rule firing `notify_user`/`update_field`/
  `create_task` on a matching stage change and *not* firing on a non-matching one; multiple rules
  matching one trigger all firing; a disabled rule never firing; `update_field` refusing a
  `field` value naming `stageId`/`status`.
- Cover dashboards: pipeline-by-stage totals, win/loss counts, and activity counts each read back
  correctly against known seeded-in-test data, and are excluded/zeroed correctly for a company
  with no Deals.
- Cover tenant isolation for every new model (`Lead`, `Stage`, `Deal`, `Activity`,
  `WorkflowRule`) the same way as `ExpenseRecord` — two companies, one company's rows never
  visible or referenceable from the other.
- Prior art: `test/inventory.spec.ts` (HTTP/DB pattern, tenant isolation, money-field handling),
  `test/conformance.spec.ts` (module-boundary structural checks).

## Out of Scope

- **Live email/calendar sync** (ticket 05's subject). Resolved on the map as "use Nylas," but not
  built here: its own resolution found it needs proactive webhook-subscription renewal — real
  background execution this platform doesn't have (ADR 0009) — and this spec deliberately doesn't
  invent that scheduler as a side effect of an unrelated ticket. Revisit once a scheduler exists.
- **Time-based workflow triggers** (e.g. "no activity in N days") — same reason: needs the same
  scheduler live sync does. The `WorkflowRule` shape here is additive, so this is a later
  extension, not a rewrite.
- **Itemized quoting** — Deal line items against Products, list vs. negotiated pricing. Deal
  carries an aggregate `amount` only, per the map's Destination.
- **Deal → Order/Invoice handoff** — what a won Deal hands off to. Blocked on both a future Sales
  Order module and Accounting's ledger model (fog on the Expenses & Accounting map).
- **Sales forecasting / quotas** — target-setting and forecast-vs-actual beyond the dashboards
  built here.
- **Territory / team hierarchy** — routing by territory or sales-team structure rather than to an
  individual User.
- **Lead scoring** — ranking leads by fit/engagement before qualification.
- **The CRM boundary for future pillars** (ticket 07) — a documentation/naming decision for
  Marketing/Service/Commerce, not code this spec builds.
- **Notification delivery beyond an in-app record** — no email/push infrastructure is built for
  `notify_user`; it writes a record the named user sees on next login only.
- **A visual/drag-and-drop no-code builder UI** for `WorkflowRule` — this spec ships a structured
  form (dropdowns and config fields); a visual canvas is a later refinement, per the map's
  `/prototype` recommendation.
- **Marketing, Commerce, Service, and IT pillars** — this spec, like the map, builds Sales only.

## Further Notes

- Ticket 05's research file carries the full vendor comparison and citations behind the
  live-sync recommendation, kept for when the scheduler prerequisite is resolved and that ticket
  is picked back up: `.scratch/crm-sales/research/05-live-communication-sync.md` (branch
  `research/crm-live-communication-sync`, not merged).
- `assignedToUserId`'s no-backend-directory shape (identity's public surface is empty) is worth
  flagging to whoever builds this: it's a real platform constraint, not an oversight in this
  spec — confirmed by reading `backend/src/modules/identity/index.ts` directly.
- This is the first cut of this spec. What's left on the map after this lands: ticket 07's
  boundary decision (no code), and the scheduler-gated pair (live sync, time-based automation)
  once ADR 0009 is resolved.
