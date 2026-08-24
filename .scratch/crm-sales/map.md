# Map — CRM: Sales

Label: wayfinder:map

## Destination

A working **Sales** module (`crm`, Core tier, `dependsOn: ['parties']`) covering the full sales
cycle from lead capture to deal closure — Lead Management, Communication Tracking, a configurable
Deal Pipeline, Automated (no-code, recipe-based) Workflows, and built-in pipeline dashboards.
`crm` is the first of a future multi-pillar CRM (marketing, commerce, service, IT already named by
the brief); this map also settles the boundary/naming convention those future pillars will follow,
even though only Sales gets built now — see ticket 07.

Settled shape, decided during chartering rather than left to a ticket:

- **Lead is its own record, not a Party.** A `Lead` (name, company, source, status) lives entirely
  in `crm`. Qualifying it creates or links a `Party` (tagged via Parties' own
  `POST /parties/:id/roles`, matching Expenses' Payee precedent) — mirrors "roles are added by
  choice, not assumed at creation." A `Deal` always references a `Party`, never a bare `Lead`.
- **Deal carries an aggregate value only** (`amount`, `currency`, `stage`) — no line items against
  Products. `crm` does **not** `dependsOn: products`. Itemized quoting is fog (see below).
- **Pipeline stages are configurable per company** — a company defines, reorders, and relabels its
  own stage list from the deals board ("edit labels"), industry terminology and all. No seed data:
  first company sees an empty stage list and creates its own, same discipline as Expenses'
  Category.
- **Communication tracking covers both manual logging and live sync** — a user can always
  hand-log an Activity (call/email/meeting/note) against a Lead, Deal, or Party, *and* the module
  aims to auto-capture real email/calendar activity via a third-party integration. The live-sync
  side is genuine greenfield (this platform's only prior email work is Expenses' outbound logging
  stub) and is research ticket 05, not assumed solved.
- **Automated Workflows are recipe-based, not a general engine**: a no-code trigger → action rule
  a company configures (e.g. "when deal enters stage X, notify user Y" / "when a field changes,
  update another field") — flexible within sales-cycle concepts, deliberately not an open-ended
  workflow builder.
- **Reporting is built-in, not deferred**: `crm` ships its own basic pipeline dashboards
  (pipeline value by stage, win/loss rate, activity counts) *and* emits domain events
  (`crm.lead.qualified`, `crm.deal.won`, `crm.deal.lost`, etc.), the same dual approach Inventory
  established, so the separate Reporting & Analytics map's future phase-2 fog can consume them
  without `crm` depending on it.
- **Ownership is a platform User, not an HRM Employee.** `crm` is Core tier; `hrm` is Enterprise —
  a Core module can't depend upward, so "assigned to" a Lead/Deal is a User reference via the
  identity seam, same as actor-tracking elsewhere. Whether that User also happens to be an HRM
  employee is incidental.

## Notes

**This map carries execution, not just decisions** — overriding wayfinder's plan-only default,
same override Reporting & Analytics already uses. Each ticket here is expected to result in
working code once resolved.

Modular monolith ERP — see `README.md`, `docs/modules.md`, `docs/tenancy.md`. `crm` is generated
via `npm run new:module -- --name crm --tier core --depends-on parties`, then built out — see
"Adding a module" in `docs/modules.md`. A module reads Parties only through its public surface
(`PartyDirectory`) and tags roles only via Parties' own `/parties/:id/roles` endpoint, never by
writing Parties' tables directly.

Prior art worth checking before assuming greenfield: Expenses & Accounting's ticket 01 (Payee
model) is the precedent for referencing Parties and tagging roles from another module's frontend;
its ticket 05/06 (`email-gateway`, `recurring-scheduler`) found this platform has no real
scheduler and no live inbound-email vendor yet — read both before ticket 05 (live sync research)
and ticket 06 (automation rules, which may want time-based triggers) here. Reporting & Analytics'
map is the destination for `crm`'s emitted events once its phase-2 fog clears — don't build a
second dashboard system there; extend this one's events.

Use `/grilling` and `/domain-modeling` for grilling tickets; `/research` for research tickets,
each fired as its own subagent per the usual protocol; `/prototype` for the no-code workflow
builder UI and the deals board once their tickets unblock.

## Decisions so far

<!-- one line per closed ticket, appended on resolution -->

- [02 — Lead management](issues/02-lead-management.md) — built directly on ticket 01's scaffold
  in the same session. Full lifecycle (`new` → `contacted` → `qualified`/`disqualified`, with
  `reopen` restoring the stored prior status rather than guessing), `qualify` accepting
  `create`/`link` and setting `partyId` + `status: 'qualified'` in one request, and the
  frontend composing both the Party creation/lookup and the `prospect` role tag as separate
  calls — `crm`'s backend never writes `PartyRole`. `leads.controller.ts`/`leads.service.ts`
  (named after the resource, per `docs/modules.md`'s multi-resource convention, anticipating
  Deal/Activity/WorkflowRule later) rather than `crm.controller.ts`.
- [01 — CRM module scaffold](issues/01-crm-module-scaffold.md) — module generated and landed.
  Found and fixed a real generator bug along the way: `npm run new:module` produced a broken
  `_PATHS` object (two properties both named `crm`, since an acronym module name has no plural
  distinct from its own singular record delegate) for any module name shaped like this one —
  fixed in `backend/src/platform/generator/module-name.ts`/`templates.ts`, with a regression
  test, so every future module with the same shape is unaffected. The placeholder scaffold was
  superseded within the hour by ticket 02 landing on top of it, so there was never a separate
  "empty placeholder" screen to see in practice.
- [Spec — Sales CRM: leads, pipeline, activities, automation & dashboards](spec.md) —
  (`Status: ready-for-agent`) consolidates every resolved shape decision — Lead model and
  conversion, Deal & pipeline model, Activity logging, workflow automation rules, and pipeline
  dashboards & events — into one implementable PRD, now the single source of truth for that
  detail: `Lead` converts to `Party` on qualify (never auto-creating a Deal), a
  company-configurable `Stage` pipeline with aggregate-value `Deal`s (`MoneyValue`, no line
  items), append-only `Activity` logging, event-triggered-only `WorkflowRule` automation
  (deliberately no time-based triggers — same scheduler gap the live-sync research below found),
  and built-in dashboards plus emitted events for Reporting & Analytics. Also settled in-repo:
  `assignedToUserId` resolves via the frontend calling identity's `GET /api/identity/users`
  directly, since identity's public surface is deliberately empty
  (`backend/src/modules/identity/index.ts`) and no module may depend on it. Broken into six build
  tickets at `issues/01`–`06` (module scaffold → Lead → Deal/pipeline → Activity → automation →
  dashboards/events), each `Status: ready-for-agent`.
- **Live communication sync** — integrate via a unified
  provider (Nylas over Unipile, on cost/scope fit) rather than direct Gmail API + Microsoft Graph.
  Exact-address matching only (never display-name). Refresh tokens stay scoped to the connecting
  User; the Activity rows they produce are company-visible and durable independent of the
  connection's live status. **Push is not optional** — both providers' webhook subscriptions
  expire and must be proactively renewed, so this is the first CRM feature that genuinely needs a
  real background scheduler rather than the lazy/on-request pattern Expenses ticket 06 used;
  flagged against ADR 0009 rather than built quietly as a side effect. Full findings:
  `research/05-live-communication-sync.md` (branch `research/crm-live-communication-sync`, not
  merged).

## Not yet specified

- **CRM boundary for future pillars** — when Marketing/Service/Commerce eventually get built, do
  they join `crm` as additional resources (a `marketing.controller.ts` beside
  `leads.controller.ts`, mirroring how `inventory` holds both `locations` and `movements`), or
  become their own modules each `dependsOn: parties` independently? What concretely is the
  "360-degree view" — a screen reading across each pillar's public surface, or a capability
  Parties itself grows (careful: Parties currently has `dependsOn: []` and must stay at or below
  the tier of anything reaching into it)? Does each pillar emit a `<pillar>.customer.*`-style
  event a shared timeline could consume? Is Sales' Core tier precedent for the others, or does
  each pillar get its own tier call when it's actually built (recommend the latter)? Nothing to
  build until a second pillar exists — this settles naming/boundary, not code.
- **Itemized quoting** — Deal line items against the Products catalogue, list vs. negotiated
  pricing. Deliberately deferred (see Destination) in favor of aggregate deal value; revisit once
  a Quotes/Orders concept exists. Not sharp enough to ticket now.
- **Deal → Order/Invoice handoff** — what happens when a Deal is won: does it hand off to a future
  Sales Order module, or to Accounting directly? Blocked on both a Sales Order module and
  Accounting's ledger model (itself still fog on the Expenses & Accounting map). Not ticketable
  yet.
- **Sales forecasting / quotas** — target-setting and forecast-vs-actual, beyond the basic
  dashboards the spec covers. Depends on real usage against those dashboards showing what's
  actually missing.
- **Territory / team hierarchy** — routing leads or deals by territory or sales-team structure,
  rather than to an individual User. Not requested for this cut; would sharpen once the spec's
  `assignedToUserId` model is live and a real multi-rep company hits its limits.
- **Lead scoring** — ranking leads by fit/engagement before qualification. The Lead shape now
  exists (the spec); not sharp enough to ticket until real usage shows what "fit" should mean.

## Out of scope

- **Marketing, Commerce, Service, and IT pillars** (the other four legs of the full CRM vision
  the brief names) — this map builds Sales only. Ticket 07 settles how future pillars will *join*
  the CRM boundary; it does not build them. Each becomes its own future map when prioritized.
