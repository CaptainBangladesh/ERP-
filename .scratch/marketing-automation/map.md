# Map — Marketing Automation

Label: wayfinder:map

## Destination

A complete, enterprise-grade **Marketing Automation** module (`marketing`, Core/Growth tier, `dependsOn: ['crm', 'parties']`) delivering:
1. **Multi-Network Social Media Suite (Metricool-style)**: Visual drag-and-drop calendar, single multi-network composer (Instagram, Facebook, TikTok, LinkedIn, YouTube, X, Pinterest, Threads, Bluesky, Google Business Profile), platform-specific formatting, autolists/evergreen recycling queues, centralized social inbox for comments & DMs, and keyword-triggered DM automation flows.
2. **Campaign Management & Attribution**: Campaign budgeting, target audience segmentation, UTM link generation, SmartLinks (Link-in-Bio pages with shoppable grid mirrors), and cross-network paid ad performance sync (Meta, Google, TikTok Ads).
3. **Inbound Lead Generation & Nurturing**: Custom web forms, ad lead sync webhooks, drip email sequences, and automated lead scoring that emits `marketing.lead.captured` / `marketing.lead.qualified` to seamlessly create and promote `Lead` records in the `crm` module.
4. **Web Tracking & Analytics**: Proprietary JavaScript tracking pixel for real-time page views, visitor attribution, and campaign conversion reporting.
5. **Brand Multi-Tenancy & Governance**: Brand workspace isolation, AES-256 encrypted OAuth token vault, client review/approval links, and white-label automated PDF/PPT reporting.

Settled architecture decisions locked during chartering:
- **Dedicated Module Boundary**: Lives in `backend/src/modules/marketing`, preserving `crm`'s focus on sales pipelines and emitting decoupled domain events for lead conversion.
- **Postgres-Backed Queue with Swappable Adapter**: Uses an `IJobQueue` port implemented with Prisma and partial indexes for zero new infrastructure dependencies, swappable for BullMQ/Redis if high scale requires it. *(Chartering said `FOR UPDATE SKIP LOCKED`; the shipped implementation is a fetch-then-conditional-update claim loop, which is atomic but not the same thing. Ticket 15 resolves the discrepancy in one direction or the other.)*
- **Direct Cloud Media Uploads**: Client uploads media directly to object storage via pre-signed URLs, preventing video/asset transcoding from exhausting application server memory.
- **Brand-Scoped Encrypted OAuth Vault**: Tokens for connected networks are encrypted at rest with AES-256 and scoped to Brands, allowing multiple team members to manage accounts safely.

## Status — audited 2026-09-07

The per-ticket claims in "Decisions so far" record what was believed at the time each ticket
closed. They are **superseded by this block**, which was produced by running the checks rather
than by reading the notes.

| Check | Ticket notes claim | Verified |
|---|---|---|
| `npm run typecheck` | pass | ✅ pass |
| `npm run check:modules` | pass | ✅ pass |
| `npm run check:tenancy` | pass | ✅ pass |
| `npm run check:conformance` | pass (tickets 01-06) | ❌ **fails — 16 violations, all in `marketing`** |
| `npm run test:backend` | "9/9", "10/10", "11/11" | ❌ **7 failed / 711**, 3 suites red |
| `npm run test:app` | 377/377 | ✅ 389/389 pass |

Tickets 01-06 claim `check:conformance` passed. From ticket 07 onward the phrase quietly
disappears from the map entries rather than the failure being fixed. **That is the process
defect that produced most of the findings below** — a ticket cannot be marked resolved while
the checks it claims fail.

**Functional state: the module does not work end to end.** `MarketingController`'s bare
`@Get(':id')` is registered first and shadows eight sibling list routes (`/brands`, `/posts`,
`/campaigns`, `/jobs`, `/autolists`, `/smart-links`, `/ad-syncs`, `/tracking-sites`), all of
which return 500. The Brand Switcher therefore loads nothing and every tab falls through to an
empty state. All 389 frontend tests pass because they run against MSW mocks and never reach
the real router.

Full audit and the scoring model behind the remediation plan:
[hardening-and-design-research.md](hardening-and-design-research.md).

## Hardening pass — tickets 11-13

Baseline **5.5/10**, target **8.4/10** (+53%). Two axes carry the increase: functionality
(3.0 → 9.0) and security (3.5 → 8.5). Three tickets, one per phase, each shipping its own tests
rather than deferring them.

| # | Ticket | Covers | Blocked by |
|---|---|---|---|
| 11 | [Unblock the module and harden the public surface](issues/11-unblock-the-module-and-harden-the-public-surface.md) | route contract · bio-page XSS · rate limiting · publishing correctness | — · **done** |
| 12 | [Reliability, conformance, and the vault](issues/12-reliability-conformance-and-the-vault.md) | queue lease/reaper/fencing · 16 conformance violations · CRM boundary · secrets, rotation, retention | 11 |
| 13 | [Design system, navigation, and accessibility](issues/13-design-system-navigation-and-accessibility.md) | `@erp/shared/ui` adoption · URL-driven nav · brand context · APG tabs · keyboard rescheduling | 11, 12 |

**11 is done** (see its Resolution section). Start with 12.

Within 11 the route contract went first — half a day, and it moves the
weighted score more than the entire design phase, because nothing in the UI is reachable until
it lands.

Ticket 13 is sequenced last on purpose: it rewrites nine components, and doing that before 11
means doing it twice.

Two decisions worth settling before writing code, since they change the work rather than the
order: whether public pages move to a separate origin (11.2), and whether the queue adopts real
`SKIP LOCKED` or the map is corrected to match the code (12.1).

Do **not** start the "Not yet specified" items below until 11-13 are done. Adding a sixth
feature area to a module whose list endpoints return 500 moves the score down.

## Notes

**This map carries execution, not just decisions** — overriding wayfinder's plan-only default, matching the precedent set by `crm-sales` and `reporting-analytics`.

- Module generation: `npm run new:module -- --name marketing --tier core --depends-on crm parties`
- Multi-tenancy & conformance: Must pass `npm run check:tenancy` and `npm run check:modules`.
- Skills to use during resolution:
  - `/research` for research tickets (API limits, OAuth nuances).
  - `/prototype` for visual surfaces (Calendar, Composer, Bio-link builder, Social Inbox).
  - `/domain-modeling` and `/grilling` for data model refinements.

## Decisions so far
- [01 — Marketing module scaffold](issues/01-marketing-module-scaffold.md) — generated via `npm run new:module -- --name marketing --tier core --depends-on crm parties`. Enhanced generator `readRequest` to accept space-delimited flag values. Manifest registered in `backend/src/app.module.ts` (`tier: 'core'`, `dependsOn: ['crm', 'parties']`, `order: 50`). Initial routing (`/marketing`) and navigation tab wired in `application/` and verified with tests. Passed `check:modules`, `check:tenancy`, `check:conformance`, and `typecheck`.
- [02 — Brand and encrypted OAuth vault](issues/02-brand-and-encrypted-oauth-vault.md) — added `MarketingBrand`, `BrandMember`, and `SocialAccount` models with migration `20260906130000_marketing_brands_social_accounts`. Implemented AES-256-GCM `CryptoService`, `SocialOAuth` provider seam with `StubSocialOAuth`, `BrandsService` with workspace isolation & member roles, and `SocialAccountsService` with HMAC-signed OAuth state, encrypted storage, safe masked retrieval, token refresh, and 7-day expiration monitor. Added `BrandSwitcher` and `SocialAccountsVault` frontend components in `application/`. Passed `check:modules`, `check:tenancy`, `check:conformance`, `typecheck`, and tests.
- [03 — Postgres job queue adapter](issues/03-postgres-job-queue-adapter.md) — added `MarketingJob` model with migration `20260906140000_marketing_jobs_queue` and partial index on `"marketing_jobs"("scheduled_at") WHERE status = 'PENDING'`. Defined `IJobQueue` interface and implemented `PostgresJobQueueService` using atomic row-locking conditional updates (`UPDATE ... WHERE id = $id AND status = 'PENDING'`) guaranteeing zero worker collisions while strictly adhering to `check:tenancy` (ADR 0003 & ADR 0009). Implemented `JobQueueWorkerService` with tenant-scoped execution (`tenancy.runInCompany`) and exponential backoff retries. Built `JobsController` and frontend `JobQueueMonitor` component under "Queue & Tasks" tab in `MarketingPage.tsx`. Passed `check:modules`, `check:tenancy`, `check:conformance`, `typecheck`, 7/7 backend unit tests, 7/7 frontend tests, and 371/371 full app tests.
- [04 — Social publishing engine](issues/04-social-publishing-engine.md) — added `ScheduledPost`, `Autolist`, and `AutolistItem` models with migration `20260906150000_social_publishing_engine`. Defined `ISocialNetworkAdapter` interface and implemented network adapters for Meta Graph API (Instagram/Facebook), LinkedIn REST API, X API v2, TikTok Content Posting API v2, and deterministic `StubSocialNetworkAdapter` via `SocialAdapterResolver`. Implemented `SocialPublisherService` (token decryption from vault, job queue scheduling, immediate publishing, metrics sync) and `AutolistsService` (FIFO & permutation shuffle recycling, 90-minute collision window avoidance). Exposed endpoints via `PostsController` and `AutolistsController`. Built `PublishingManager` frontend component integrated into `MarketingPage.tsx`. Passed `check:modules`, `check:tenancy`, `check:conformance`, `typecheck`, 9/9 backend unit tests, and 8/8 frontend tests.
- [05 — Social composer and calendar UI](issues/05-social-composer-and-calendar-ui.md) — implemented visual drag-and-drop publishing calendar `SocialCalendarPage` (Month, Week, Day views with HTML5 drag-and-drop rescheduling calling `PATCH /api/marketing/posts/:id` and optimal engagement heatmap indicators), unified multi-account `PostComposerModal` (checkbox channel selector across 10 platforms, platform customization tabs, live character meters, format guides, first-comment input, curated media library, and best-time heatmap recommendations), and `InstagramGridPreviewModal` (3x3 grid aesthetic simulator with drag reordering and mobile feed frame). Registered `/marketing/calendar` in `manifest.ts` and added "🗓️ Calendar & Planner" tab in `MarketingPage.tsx`. Passed `check:modules`, `check:tenancy`, `check:conformance`, `typecheck`, 9/9 tests in `MarketingPage.test.tsx`, and 4/4 tests in `SocialCalendar.test.tsx` (377/377 total app tests passing).
- [06 — Campaigns and attribution engine](issues/06-campaigns-and-attribution-engine.md) — added `MarketingCampaign`, `SmartLink`, and `AdAccountSync` models with migration `20260906160000_campaigns_and_attribution_engine`. Implemented `UtmService`, `CampaignsService`, `SmartLinksService` with public `GET /b/:slug` bio page rendering, atomic view tracking via `withoutCompanyScope`, click beaconing (`POST /b/:slug/clicks`), and `AdSyncService` for Meta, Google, and TikTok ad sync. Built frontend `CampaignsManager` under "🎯 Campaigns & Attribution" tab in `MarketingPage.tsx`. Passed `check:modules`, `check:tenancy`, `check:conformance`, `typecheck`, 12/12 backend unit tests, and 10/10 frontend tests.
- [07 — Inbound lead gen and CRM handoff](issues/07-inbound-lead-gen-and-crm-handoff.md) — added `LeadCaptureForm`, `LeadCaptureSubmission`, and `NurtureSequence` models with migration `20260906170000_inbound_lead_gen_and_crm_handoff`. Built public submission endpoint `POST /api/marketing/forms/:formId/submit`, ad webhook ingestion `POST /api/marketing/webhooks/ads/:platform` (Meta & Google), `CrmBridgeService` with non-destructive `fillEmptyFields` pattern, CRM `Activity` timeline logging with UTM attribution, `DomainEvents.emit('marketing.lead.captured')`, `NurtureSequencesService`, and frontend `LeadGenManager` under "🧲 Inbound & CRM" tab in `MarketingPage.tsx`. Passed `check:modules`, `check:tenancy`, `typecheck`, 8/8 backend unit tests, and 11/11 frontend tests.
- [08 — Unified social inbox and DM flows](issues/08-unified-social-inbox-and-dm-flows.md) — added `SocialMessage` and `DmAutomationFlow` models with migration `20260906180000_unified_social_inbox_and_dm_flows`. Built multi-channel inbox thread aggregation, inbound webhook receiver `POST /api/marketing/webhooks/social-inbox/:platform` with Meta challenge handshake & X DM support, `DmFlowsService` keyword matching engine (EXACT & CONTAINS with lead magnet template interpolation), `CrmBridgeService` lead conversion with conversation transcript timeline attachment, and frontend `SocialInboxManager` component under "💬 Social Inbox & DMs" tab in `MarketingPage.tsx`. Passed `check:modules`, `check:tenancy`, `typecheck`, 9/9 backend unit tests, and 12/12 frontend tests.
- [09 — Tracking pixel and visitor analytics](issues/09-tracking-pixel-and-visitor-analytics.md) — added `TrackingSite` and `PageViewEvent` models with migration `20260906190000_tracking_pixel_and_visitor_analytics`. Built `TrackingService` serving lightweight client snippet `<script src="/api/marketing/pixel.js" data-site="..." defer>` (< 2.2 KB), high-throughput CORS-enabled beacon collector `POST /api/marketing/collect` (HTTP 204) with bot filtering and cookieless GDPR hash, daily visitor/session/pageview aggregations per Brand and Campaign (`utmCampaign`), and `TrackingManager` frontend component under "📊 Tracking & Analytics" tab in `MarketingPage.tsx`. Passed `check:modules`, `check:tenancy`, `typecheck`, 10/10 backend unit tests, and 13/13 frontend tests.
- [Spec — Marketing Automation](spec.md) — (`Status: ready-for-agent`) consolidates all 10 core feature workflows, architecture decisions, research fact sheets, data models, and HTTP integration test seams into one comprehensive, implementable PRD.
- [10 — Social API rate limits & permissions](issues/10-social-api-rate-limits-and-permissions.md) — verified post-Jan 2025 Meta scopes (`instagram_business_*`), 50-post/day quota, container polling flow; LinkedIn PDF document URN upload sequence; X API v2 OAuth PKCE and polling fallback for non-enterprise DMs. Implemented publishing rate limits in `SocialPublisherService` (Meta 50/24h, X 100/15m), Meta 24h & 7-day human agent DM window in `InboxService`, quota status endpoint `GET /api/marketing/social-accounts/:id/rate-limits`, modern Meta scopes in `LiveSocialOAuth`, and verified with 11/11 tests in `social-rate-limits.spec.ts`.




### Ticket 11 — design pass (2026-09-07, decisions only; no code written)

Classifier (`./scripts/classify-ticket.sh`) returned 3 strong signals — public/unauthenticated
surface, credentials & secrets, redirect/external link — and recommended an Opus design pass
before implementation. These are the rules implementation must follow. Where a rule conflicts
with an existing test, the code is wrong, not the test.

- **11.1 Route contract — the fix is the segment, not the ordering.** Move the ticket-01 scaffold CRUD to `@Controller('api/marketing/records')` and update `MARKETING_ROUTE` / `MARKETING_PATHS` in `packages/src/modules/marketing/contract.ts` plus the "Campaign Records" tab; do not merely reorder `marketing.module.ts:57`. Reason: reordering makes the eight list routes work today while leaving the next sibling route added to the module silently shadowed. **Rule:** no controller mounted at a module root may declare a bare `:id` parameter at path depth 1 — dynamic segments must sit under a literal noun segment (`/records/:id`, `/brands/:id`). Enforce as conformance rule `no-bare-id-at-module-root` in the pack (ADR 0005: boundaries are enforced mechanically, not by discipline), and ship the eight-route HTTP smoke test in the same commit so the router is exercised for real rather than through MSW.

- **11.2a Bio-page theme — validate per key, reject, never sanitise.** `theme` stops being `optional(jsonObject(...))` and becomes a closed typed schema. Reason: the `<style>` interpolation at `smart-links.service.ts:380-383` is only safe if the value could not have contained a delimiter in the first place; escaping inside a CSS context is a second-class defence and was already forgotten once. **Rule:** `primaryColor` and every other colour key must match `/^#[0-9a-f]{3,8}$/i`; `fontFamily` must be one of a hard-coded allowlist of font-stack identifiers (never a free string, never interpolated as a quoted CSS string); `cardStyle` must be a member of its existing union. Unknown keys are rejected. A failing theme returns **400 at write time** — never a stripped/coerced value, never a fallback render. No user-controlled value is ever interpolated into a `<style>` block, an inline `style=` attribute, or a `<script>` block anywhere on the public page.

- **11.2b Link fields — allowlist the URL scheme at write time.** `buttonLinks`, `shoppableGrid` and `socialLinks` become properly typed arrays instead of `jsonArray(...)`, and every URL-bearing field is validated on the write path. Reason: `escapeHtml` (`:588`) makes a `javascript:` href *inert-looking* and still fully executable, which is exactly the case OWASP calls out. **Rule:** parse with `new URL(value)` and accept only `https:`, `http:`, `mailto:`, `tel:` — anything else (including `javascript:`, `data:`, `vbscript:`, protocol-relative `//host`, and any value that fails to parse) is a 400. Validation lives in the schema at the write boundary, not in the renderer; the renderer may assume validated input but must still escape. Re-validate on the read path only as an assertion that throws in dev and drops the single link in prod — never as the primary control.

- **11.2c The public renderer must not be able to 500.** Reason: `escapeHtml` throws on a non-string, so one legacy JSON row makes `/b/:slug` unavailable, and legacy rows exist precisely because these columns were never typed. **Rule:** `escapeHtml` coerces defensively (`String(value ?? '')`) and never throws; the bio-page render path treats every persisted JSON value as untrusted and unshaped, skipping any entry that does not match the expected shape rather than aborting the page. A malformed row degrades one card; it never takes down the page. Cover with a test that seeds a row containing a number, a nested object and a `null` in each JSON array and asserts 200.

- **11.2d Origin isolation — same origin for ticket 11, with a recorded trigger.** Decision: **do not** move `/b/:slug` to `links.<host>` in this ticket; land the validation and CSP now, and treat the origin split as a required prerequisite before bio pages are advertised on a customer-facing custom domain. Reason: the split is the only mitigation that survives a future renderer mistake, but it needs DNS, hosting config and an absolute-URL contract for every asset the page emits — that is an infra change, and blocking the module's only unblocking ticket on it trades a certain functional win for an uncertain infra one. **Rule:** (i) the ERP session cookie must be `HttpOnly`, `Secure`, `SameSite=Lax` and **host-only** (no `Domain=` attribute) — verify this before shipping, because a parent-domain cookie would make the future split worthless; (ii) the bio page renders no ERP session state and issues no authenticated fetches; (iii) the split is carried as an open infra decision under ticket 12's secrets/infra scope, triggered by either a custom domain or the first bio-page feature that needs to embed third-party content.

- **11.2e CSP is defence in depth, ordered behind validation.** Serve `/b/:slug` and `POST /b/:slug/clicks` under a per-response nonce CSP. Reason: it converts a future escaping miss from stored XSS into a blocked console error, but it must never be the reason a bad value is considered acceptable. **Rule:** `default-src 'none'; style-src 'nonce-<n>'; img-src https: data:; script-src 'nonce-<n>'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`. No `unsafe-inline`, no `unsafe-eval`, no wildcard `script-src`. The nonce is generated per request from a CSPRNG. A test must assert the header is present and contains no `unsafe-` token.

- **11.3a Rate limiting — add the throttler, and write down what its storage does not do.** Adopt `@nestjs/throttler` and decide storage explicitly rather than inheriting the default silently. Reason: there is no HTTP rate limiting anywhere in this application, and the in-memory store gives per-instance limits that read as global ones in a review. **Rule:** `ThrottlerModule` registered globally with `@SkipThrottle()` on authenticated internal routes and explicit `@Throttle` on the three public writes — `POST /api/marketing/forms/:formId/submit`, `POST /api/marketing/collect`, `POST /b/:slug/clicks`. Storage: **accept the in-memory store knowingly for phase 1**, since the deploy is currently single-instance and adding Redis contradicts the module's zero-new-infrastructure charter; the limits are therefore *per instance*, and that sentence must appear in the module README next to the numbers. Key by client IP plus the path parameter (`formId` / site / slug) so one abusive form cannot consume another's budget. Exceeding a limit returns **429** with `Retry-After` and no body detail. The moment the app runs more than one instance, throttler storage becomes a blocker — that is the recorded trigger, not a nice-to-have.

- **11.3b Form submissions — the declared schema becomes the actual contract.** `forms.service.ts:221` must validate the incoming `fields` against the form's own `schemaFields` before anything is written. Reason: today the declared shape is decorative and `fields.email as string` is a cast, so an object reaches a Prisma string column and returns 500 on a public endpoint — an unauthenticated caller can pick the status code. **Rule:** every submitted key must exist in `schemaFields`; unknown keys are dropped (not rejected — forms get edited and in-flight pages lag); missing required fields and type mismatches return **400** with a field-level message and no stack detail. Contact fields extracted for the CRM (`email`, `phone`, `name`) must be type-checked as strings and format-checked before extraction, never cast. Additionally: a honeypot field that must be empty, and a per-form daily submission cap enforced in the same transaction as the counter. ADR 0012 behaviour — a public submission fills empty fields only, never overwrites — stays exactly as it is.

- **11.3c The submit path is one transaction.** The submission row, the counter increment and the CRM `Lead` create/update move inside a single `prisma.$transaction`. Reason: they are written separately today, so a failure after the lead is created leaves an orphaned lead in the sales pipeline with no submission to explain it. **Rule:** all three writes commit or none do; the `marketing.lead.captured` domain event is emitted **after** the transaction commits, never inside it, so a rollback cannot publish a phantom event. If the CRM bridge fails, the whole submission fails and nothing is persisted.

- **11.4a Credential storage and masking — mask the plaintext, never the ciphertext.** `social-accounts.service.ts:404` currently calls `maskToken(row.encryptedAccessToken)`, so the UI shows the last four characters of a GCM auth tag. Reason: it is meaningless to the user and it leaks a fragment of the authentication tag, and two of the four failing vault tests are reporting exactly this. **Rule:** ciphertext (`encryptedAccessToken`, `encryptedRefreshToken`, IV, auth tag) never leaves the service layer — not in a DTO, not in a log line, not in an error message. Masking is computed by decrypting inside the service and returning `••••` plus the last four characters of the **plaintext** token; the decrypted value exists only within that call frame. The masking assertions in `backend/test/marketing-vault.spec.ts` are correct as written and **must pass without being edited**. Add a test asserting no controller response body carries a field name matching `/^encrypted/`.

- **11.4b Double publish — claim the row conditionally, never read-then-write.** Replace the read-`post.status`-then-write-`PUBLISHING` pair at `social-publisher.service.ts:129` with the conditional claim the job queue already uses. Reason: two concurrent calls both pass the read and both hit the network, which means a duplicate post on a client's real social account — externally visible and not undoable. **Rule:** `updateMany({ where: { id, status: { in: [<publishable states>] } }, data: { status: 'PUBLISHING' } })` and proceed only when `count === 1`; a `count === 0` is a normal no-op, not an error. No network call may be made before the claim succeeds. This is the same pattern as the queue's claim loop and should read identically, so the module has one concurrency story rather than two. Test: two concurrent publishes of one post produce exactly one adapter call.

- **11.4c Quota is counted at publish time, on published posts.** `social-publisher.service.ts:492` and `social-accounts.service.ts:469` must both count by actual publish timestamp, not `createdAt`, and must not treat `SCHEDULED` as spent. Reason: counting creation time blocks today when 60 posts are bulk-scheduled for next month, and blows Meta's real 50/24h limit when 50 posts scheduled last week fire today — the guard fires in exactly the wrong two cases, and the number shown in the UI is decorative. **Rule:** the rolling window counts rows with `status = 'PUBLISHED'` and `publishedAt >= now - window`; a `FAILED` attempt that reached the network **does** count (the platform counted it), one that failed before the network call does not — record which rather than inferring. Both call sites read the count from one shared helper so the displayed number and the enforced number cannot diverge again. Delete the shim `if (typeof this.prisma.scheduledPost?.count !== 'function') return;` outright — a production limit must never be disableable by the shape of an injected mock; tests that relied on it get a real stub instead.

- [11 — Unblock the module and harden the public surface](issues/11-unblock-the-module-and-harden-the-public-surface.md) — **done.** Scaffold CRUD moved to `api/marketing/records`, so all eight list endpoints answer 200 and the module is usable in a browser again; conformance rule `no-bare-id-at-module-root` added to the pack (fires on a bare `:param` beneath a prefix two or more controllers share, so single-controller module roots elsewhere are unaffected). Bio-page `theme` / `buttonLinks` / `shoppableGrid` / `socialLinks` are closed typed schemas refusing bad input at write time; `escapeHtml` coerces and the renderer drops malformed entries so a legacy row cannot 500 a public page; `/b/:slug` serves a per-response nonce CSP (`connect-src 'self'` added to the listed policy so the page's own click beacon still works). `@nestjs/throttler` 6.5.0 added as `platform/throttling` — opt-in per handler rather than a blanket default, limiting the three public writes (10/min per form, 120/min per pixel key, 60/min per slug) with 429 + `Retry-After`; in-memory storage and its per-instance caveat documented in `backend/src/modules/marketing/README.md`. Form submissions validated against `schemaFields`, honeypot in the embed code, daily cap, and the counter + CRM lead + submission row committed as one transaction with the domain event emitted after commit. Publishing claims its row conditionally before any network call; quota counted once, by publish time, from a shared helper both the guard and the UI read (new `networkAttemptedAt` column, migration `20260907120000_publishing_quota_network_attempt`); the mock-shaped limit shim deleted; masked tokens now mask the plaintext. Ships `backend/test/marketing-hardening.spec.ts` (19 cases over the real router, including the eight-route smoke test) plus a conformance case; `marketing-vault.spec.ts` 15/15 with its masking assertions unedited. **Verified for 11.2d:** this application has no session cookie at all — the session is a JWT in `localStorage` sent as `Authorization: Bearer` — so the origin split stays deferred with its trigger recorded, and the `localStorage` trade is written down. `typecheck`, `check:modules`, `check:tenancy` pass; `check:conformance` still reports the same 16 pre-existing violations, all `marketing`, which are ticket 12's.

## Not yet specified

- **AI Social Media Assistant Fine-Tuning**: Hooking up the existing `@anthropic-ai/sdk` dependency to generate tailored hooks, alt-text, and platform-specific variations directly in the composer.
- **Competitor Benchmarking Scraper/APIs**: Public profile scraping vs. official graph APIs for tracking competitor follower growth and engagement cadence.
- **RSS Feed Ingest Worker**: Feed parser integration to auto-enqueue podcast and blog RSS items into scheduling queues.
- **Granular Canva & Adobe Express Embed SDKs**: Direct button integrations inside the media library modal to launch external graphic editor iframes.

## Out of scope

- **Native Audio/Video Transcoding Engine**: Transcoding 4K video directly on the NestJS backend host is ruled out; external platform media APIs and cloud upload pipelines handle encoding.
- **Direct Ad Campaign Creation/Bid Bidding API**: Modifying live ad bids and creating ad sets directly via Meta/Google Marketing API is ruled out for MVP; focus is unified cross-channel performance reporting, UTM tracking, and ad lead webhook ingestion.
