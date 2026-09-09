# Research — Raising the Marketing module from 5.5 to 8.4+ (+53%)

Type: research
Status: resolved

## Question

How do we improve **the build** (engineering) by at least 53%, and **the design**, from the
baseline established in the module review?

Baseline **5.5/10**. Target **8.4/10** (5.5 × 1.53).

## Scoring model

Reviews drift when the scale is vibes. This is the scale, and it is the one the follow-up
tickets get graded against.

| Axis | Weight | Now | Target |
|---|---|---|---|
| Scope & feature completeness | 10% | 8.0 | 8.0 |
| Architecture & seams | 12% | 7.5 | 8.5 |
| UI craft | 10% | 7.0 | 8.5 |
| Functionality (works end to end) | 15% | 3.0 | 9.0 |
| Logic & correctness | 13% | 5.0 | 8.5 |
| Security | 13% | 3.5 | 8.5 |
| UX | 9% | 5.0 | 8.5 |
| Accessibility | 5% | 2.0 | 8.0 |
| Testing | 9% | 4.0 | 8.0 |
| Process honesty | 4% | 4.0 | 9.0 |
| **Weighted** | | **~5.1** | **8.48** |

The model computes to 5.05 today; the headline 5.5 in the review rounded up for scope
delivered. Either way the target of 8.4 clears +53%.

Two axes carry the increase: **Functionality 3.0 → 9.0** and **Security 3.5 → 8.5**. Everything
else is secondary. Do not start with the design work.

---

# Track A — The Build

## A1. Fix the route contract  (0.5d)  [functionality 3.0 → 8.0]

The single highest-leverage change in the module.

`MarketingController` is registered first in `marketing.module.ts:57` and declares
`@Get(':id')` on `@Controller('api/marketing')`. Nest matches in registration order, so `:id`
swallows every single-segment sibling route added by tickets 02-10:
`/brands`, `/posts`, `/campaigns`, `/jobs`, `/autolists`, `/smart-links`, `/ad-syncs`,
`/tracking-sites` — eight list endpoints, all returning 500.

Research confirms this is the known NestJS failure mode: NestJS matches routes in definition
order and a dynamic `:id` will match any single segment, including static route names.
Prescribed fix is to declare static routes before dynamic ones.

**Do:**
1. Move `MarketingController` to **last** in the `controllers` array. One line, unblocks
   all eight endpoints.
2. Better, and what stops it recurring: give the scaffold's generic CRUD its own segment
   (`api/marketing/records`) so no controller in the module owns a bare `:id` at depth 1.
3. Add a conformance rule — `no-bare-id-at-module-root` — so the next module cannot
   reintroduce it. This repo already enforces boundaries this way (ADR 0005); the pack is
   the right home for it.

**Why it survived:** all 389 frontend tests run against MSW mocks and never touch the real
router. Ship a smoke test that boots the Nest app and asserts 200 on each list route. That
one test is worth more than the 60 label-presence assertions currently in the module.

## A2. Harden the public surface  (2d)  [security 3.5 → 7.5]

Three `@Public()` endpoints and a server-rendered HTML page, none of them defended.

### A2.1 Stored XSS in the bio page
`smart-links.service.ts:380-383` interpolates theme values raw into `<style>`. `theme` is
validated as `optional(jsonObject(...))` — no per-key checking. A payload in `primaryColor`
executes on `/b/:slug`, same origin as the ERP app.

- Validate the theme object per key: colors against `/^#[0-9a-f]{3,8}$/i`, `fontFamily`
  against an allowlist of stack names, `cardStyle` against a union. Reject, don't sanitise.
- Serve the bio page under a strict CSP. OWASP and web.dev both prescribe nonce-based CSP
  for server-rendered pages; the `<style>` block gets a per-response nonce and every other
  inline style is refused. Defence in depth behind the validation, not instead of it.
- Consider moving public pages to a separate origin (`links.<host>`) so a miss can never
  reach an ERP session cookie. Cheapest real mitigation available.

### A2.2 `javascript:` URLs
`escapeHtml` covers `<>&"'` but not URL schemes, and `buttonLinks` is an unvalidated
`jsonArray`. OWASP's DOM XSS guidance is explicit that an escaped `href` bound to user data
still executes `javascript:`.

- Allowlist schemes (`https:`, `http:`, `mailto:`, `tel:`) with `new URL()` parsing at write
  time, in the schema, not at render time.
- Type the JSON columns properly — `buttonLinks`, `shoppableGrid`, `socialLinks`, `theme`
  are all `jsonArray`/`jsonObject` today, which means the render path trusts shapes nothing
  validated. `escapeHtml` will also throw on a non-string, which is a 500 on a public page.

### A2.3 No rate limiting anywhere
`@nestjs/throttler` is not in the project. `POST /forms/:formId/submit` is public,
unthrottled, uncaptcha'd, and writes into the CRM through `CrmBridgeService`.

- Add `ThrottlerModule`; `@Throttle` the three public write endpoints; `@SkipThrottle` on
  authenticated internal routes.
- Default storage is in-memory and does not hold across instances — use the Redis storage
  adapter if you run more than one node, or accept per-instance limits knowingly.
- Add a honeypot field and a per-form daily cap. Validate submissions against the form's own
  `schemaFields`, which `forms.service.ts:221` currently ignores entirely.

## A3. Queue reliability  (1.5d)  [logic 5.0 → 7.5]

`lockedAt` is written in `poll()` and never read back. There is no reaper. A worker that
dies mid-publish leaves the job `PROCESSING` forever — the post never goes out and the
dashboard stays green.

The standard production pattern from the research is a **lease**: the claim stamps a
`started_at`/`visible_at`, and a janitor query returns rows older than the timeout to
`PENDING`, or to `FAILED` once attempts are spent.

- Add the reaper on the existing poll tick: `status = 'PROCESSING' AND lockedAt < now - lease`.
- Add a **fencing guard** on completion. The research names the exact race SKIP LOCKED does
  not solve: a slow-but-alive worker outlives its lease, the job is re-claimed, and both run.
  `complete()`/`fail()` must carry the `attempts` value the worker claimed, so a stale worker
  cannot overwrite a re-claimed job.
- `processNextBatch` awaits jobs one at a time. Ten posts to Meta go out serially. Use
  `Promise.allSettled` with a concurrency cap.
- The map claims `FOR UPDATE SKIP LOCKED`; the code is a fetch-then-conditional-update loop
  at `batchSize * 2` round-trips per poll. Correctness holds — either fix the map, or adopt
  real `SKIP LOCKED` and grant the queue the raw-SQL exemption that ADR 0003 would otherwise
  forbid. Do not leave the map asserting something the code does not do.

## A4. Publishing correctness  (1d)  [logic 7.5 → 8.5]

- **Double publish.** `publishPost` reads status then writes `PUBLISHING` in a separate
  statement. Two concurrent calls both pass and both post to the network. Use the same
  conditional `updateMany` + `count === 1` the queue already uses in `poll()`.
- **Rate limits measure the wrong column.** `social-publisher.service.ts:492` counts by
  `createdAt` with status `IN ('PUBLISHED','SCHEDULED')`. Bulk-schedule 60 posts for next
  month and you are blocked today having published nothing; schedule 50 last week that all
  fire today and Meta's real 50/24h quota is blown with no guard. Count actual publish time,
  and count `FAILED` — a failed call still spent quota.
- Delete `if (typeof this.prisma.scheduledPost?.count !== 'function') return;`. A test shim
  that silently disables a production rate limit is worse than no rate limit.
- Fix `maskToken(row.encryptedAccessToken)` — it masks the ciphertext, so the UI shows the
  last 4 characters of a GCM auth tag. Two of the four failing vault tests are exactly this.

## A5. Conformance and the CRM boundary  (2d)  [architecture 7.5 → 8.5, process 4.0 → 9.0]

`check:conformance` fails with 16 violations, all in `marketing`. It also takes
`generator.spec.ts` and `conformance.spec.ts` down with it — this module is breaking
repo-wide tests.

- 6 × `cross-module-tables` — `crm-bridge.service.ts` and `inbox.service.ts` write `Lead`,
  `LeadSubmission` and `Activity` directly. The map's headline decision was "decoupled domain
  events for lead conversion". Events are emitted, but the writes bypass `crm`'s public
  surface anyway, so the stated architecture and the code disagree. Add the write methods to
  `crm`'s `index.ts` and call through them.
- 8 × `list-parameters` in `tracking.controller.ts` — take `@Query()` whole into
  `listQuery(query, SPEC)` per ADR 0004.
- 1 × `hand-rolled-paging` in `social-accounts.service.ts:533`.
- 1 × `body-validated` in `ad-webhooks.controller.ts:28` — an unvalidated body on a webhook.
- Wire `check:conformance` into the ticket definition-of-done. Tickets 01-06 claimed it
  passed; from 07 onward the phrase quietly disappeared from the map rather than the failure
  being fixed. That is the process defect that produced all of the above.

## A6. Secrets, key rotation, retention  (1.5d)  [security 7.5 → 8.5]

- **Hardcoded fallback keys.** `crypto.service.ts:29` falls back to a literal in the repo;
  the OAuth state HMAC does the same at `social-accounts.service.ts:437`. Deploy without the
  env vars and every token is encrypted under a key anyone can read, which makes the
  docstring's "cannot read tokens without the vault secret" false. Refuse to boot in
  production when the secret is absent.
- **No key rotation path.** The ciphertext format is `iv.ct.tag` with no key id, so rotating
  `MARKETING_VAULT_SECRET` bricks every stored token. Research prescribes envelope
  encryption: per-record DEK wrapped by a KEK, key version stored alongside the ciphertext —
  rotating the KEK re-wraps the small keys and never touches bulk ciphertext. Minimum viable
  version here: prefix a key id (`v1.iv.ct.tag`) and keep a map of retired keys so rotation
  is possible at all.
- **IP hashing is half right.** `hashIp` rotates the salt daily, which is the correct
  instinct — but the salt *is* the date, so it is public. IPv4 is 2³²; a DB dump plus a known
  salt de-anonymises every visitor in seconds. Add a secret pepper.
- **No retention anywhere** — `grep deleteMany|retention|purge` returns nothing across the
  module. `PageViewEvent` grows unbounded, which is a cost problem and a GDPR
  storage-limitation problem. Add a retention job on the queue you already built.
- `SmartLink.clicks` is a read-modify-write on a JSON column from an unthrottled public
  endpoint. Pruned to 500 (good), but concurrent clicks lose updates. Move to a rows table.

---

# Track B — The Design

The review scored UI craft 7.0 and it deserves it: the grid simulator, the engagement
heatmap, the character meters and the empty states are real product thinking. The problem is
not taste. It is that **none of it is built from the system this repo already has.**

## B1. Adopt the design system  (2d)  [UI 7.0 → 8.5]

Measured, not asserted:

| | imports `@erp/shared/ui` | total files |
|---|---|---|
| crm | 22 | 62 |
| **marketing** | **1** | **14** |

Nine marketing components hand-roll `fixed inset-0` modal overlays while `@erp/shared/ui`
exports a `Modal`. `Button`, `Field`, `Select`, `FormError` are likewise available and unused
outside `MarketingPage.tsx`.

This is why the module will drift visually from the rest of the app the first time anyone
touches the shared components — nine private copies of a modal do not get the fix.

- Replace the hand-rolled overlays with `Modal`. That alone buys focus trap and Escape
  handling for free across nine surfaces, which is most of B4.
- Replace ad-hoc buttons and inputs with `Button`/`Field`/`Select`.
- Anything genuinely new and reusable (the platform-channel chip, the character meter)
  belongs in the module, not copied between its own components.

## B2. Navigation architecture  (1.5d)  [UX 5.0 → 8.0]

Nine tabs in a plain `flex` at `MarketingPage.tsx:115` with **no `flex-wrap`, no
`overflow-x-auto`, no `shrink-0`** — roughly 1,500px of tabs that will crush or push the page
wide. You have hit this exact class of bug before in the CRM workspace.

And ~250 of that file's 444 lines are the same 12-line tab button pasted nine times plus the
same empty-state block pasted seven times.

**The repo already solved both.** `crm/pages/LeadWorkspace.tsx:342` uses an extracted
`TabButton` with count support; `app/location.ts` provides `navigate` + `useLocationPath`
for URL-driven state, and `LeadWorkspace` uses them.

- Drive tab state from the URL via `app/location.ts`. Today it is `useState` plus a one-shot
  `window.location.pathname` read in the initialiser, so `/marketing/calendar` does not work
  on client-side navigation, you cannot link a colleague to a tab, refresh loses your place,
  and back does nothing.
- Collapse the nine repeats into a `TABS` array and one `<EmptyState>`. 444 lines → ~120.
- Nine top-level destinations is past the limit of a tab strip. Research on this product
  category is consistent — Metricool's density is noted as the thing new users struggle with,
  Buffer wins on "clean, at a glance". Group into 4: **Plan** (Calendar, Composer),
  **Engage** (Inbox, DMs), **Grow** (Campaigns, SmartLinks, Inbound), **Settings** (Vault,
  Queue, Records). Sidebar sections beat a nine-item strip at this count.
- Delete or rename "Campaign Records" — it is leftover ticket-01 scaffold CRUD sitting next
  to "Campaigns & Attribution" under a near-identical name.

## B3. Brand context safety  (0.5d)  [UX 8.0 → 8.5]

`activeBrand` falls back to `brands[0]` on every reload and is never persisted.

In a multi-brand tool this is not a papercut, it is a **mis-posting hazard** — the failure
mode the category is explicitly designed around ("a workspace layer around each brand to
prevent posting to the wrong account"). Publishing to the wrong client's Instagram is the
single worst thing this product can do.

- Persist the active brand (`localStorage`, as CRM already does for worklist tabs at
  `LeadWorkspace.tsx:525`), and put it in the URL so a shared link carries its brand.
- Make brand identity loud in the composer — brand colour and avatar on the publish button,
  not a chip in a tab label.
- Confirm on publish when the target brand is not the one last used.

## B4. Accessibility  (2d)  [a11y 2.0 → 8.0]

14 `aria-`/`role` attributes across ~9,000 lines. `CampaignsManager` (1,361 lines): zero.
`SocialInboxManager`, `PublishingManager`, `TrackingManager`, `LeadGenManager`,
`JobQueueMonitor`: zero.

- **Tabs.** The W3C APG Tabs pattern requires `role="tablist"` (with `aria-label`),
  `role="tab"` with `aria-selected` and `aria-controls`, `role="tabpanel"` with
  `aria-labelledby` and `tabindex="0"`, plus Left/Right arrows with wrap and Home/End.
  Today they are nine unrelated `<button>`s.
- **Drag and drop has no keyboard path at all.** The calendar's headline feature — the whole
  point of ticket 05 — is mouse-exclusive. A keyboard-only user cannot reschedule a post.
  Same for the Instagram grid reorder. Every drag needs a non-drag equivalent: a "Reschedule"
  item in a per-post menu with a date/time field, and Move up/down on grid tiles. Ship the
  menu first — it is also faster for mouse users, which is why calendar tools keep both.
- B1 delivers focus trap and Escape across nine modals for free.
- Add `jest-axe` to the module's tests so this cannot regress.

## B5. Test quality  (2d)  [testing 4.0 → 8.0]

389 frontend tests, but the marketing ones assert that static label text exists —
`getByText('Mon')`, `getByText('Today')`. They prove the JSX was not deleted. There is no
test for drag-and-drop rescheduling, the headline feature of ticket 05.

The standard is already set in this repo. From the CRM suite: *"abandons an edit on Escape"*,
*"reports a partial archive rather than swallowing the leads it could not archive"*,
*"puts the old value back and says so when the server refuses"*. Those describe behaviour a
user would notice. Write marketing's to that bar.

- One HTTP smoke test that boots Nest and asserts every list route returns 200 (see A1).
- Behavioural tests for: reschedule by drag, reschedule by keyboard, publish twice
  concurrently, worker dies mid-job and the job is reclaimed, XSS payload in a theme colour
  is rejected, form submission over the rate limit is refused.
- Fix the 7 failing backend tests rather than adjusting them to match the code — two of them
  are correctly reporting the `maskToken` bug in A4.

---

## Sequencing

**Week 1 — make it work and make it safe.** A1, A2, A4. Ends with the module actually usable
in a browser and the public surface defended. This is where most of the +53% is.

**Week 2 — make it correct.** A3, A5, A6, B5. Ends with conformance green, repo-wide tests
green, and the queue trustworthy.

**Week 3 — make it good.** B1, B2, B3, B4. The design track is last on purpose: B1 rewrites
nine components, and doing that before A2/A4 means doing it twice.

Roughly **16-17 dev-days**. A1 alone is half a day and moves the weighted score more than the
entire design track.

## What not to do

Do not start the four "Not yet specified" items on the map — AI assistant, competitor
scraper, RSS ingest, Canva embeds. Adding a sixth feature area to a module whose list
endpoints return 500 moves the score **down**. Ship the eleven work packages above first.

## Sources

- NestJS route ordering: https://github.com/nestjs/nest/issues/13104
- Postgres queue leases and fencing: https://www.prisma.io/blog/you-dont-need-a-job-queue-postgres-already-has-skip-locked
- Strict CSP: https://web.dev/articles/strict-csp
- OWASP DOM XSS (href / `javascript:`): https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html
- NestJS rate limiting: https://docs.nestjs.com/security/rate-limiting
- W3C APG Tabs pattern: https://www.w3.org/WAI/ARIA/apg/patterns/tabs/
- Envelope encryption and key rotation: https://docs.aws.amazon.com/kms/latest/developerguide/rotate-keys.html
- Category IA comparison: https://buffer.com/resources/buffer-vs-metricool/

---

# Appendix — AI assistant cost research (2026-09-07, ticket 14)

Three parallel research agents, run because the owner rejected the initial estimate of $19-104/month
at 200 users as too expensive. Workload priced throughout: ~600 input / ~400 output tokens per call,
200 users across ~20 tenant companies, 7,200 calls/month realistic and 40,000 busy. Baseline Claude
Haiku 4.5 at $1/$5 per MTok = $0.0026/call. Decisions 14a-bis and 14d-14h on the map came out of this.

## Finding 1 — the category meters, it does not optimise

| Vendor | AI allowance | Plan price |
|---|---|---|
| Later | **5 credits/month** (1 credit = 1 caption) | $18.75/mo |
| Metricool | **5 per brand/month**, alt-text counts against it | Free & Starter |
| Vista Social | 1,000/month | $79/mo |
| Hootsuite | uncapped | $99/user/mo |
| Publer | unlimited on Business; **BYO key required below it** | $10/account |
| Planable | no AI in the product at all | $33-49/workspace |

Three strategies, in observed order of frequency: meter it hard with a demo-sized allowance; gate it to
a tier whose ARPU makes it irrelevant; push the key to the customer. Nobody below $79/seat ships
uncapped. Publer is the existence proof for BYO key at this price point. Planable is the existence
proof that the category does not universally require the feature at all.

**Consequence:** a Later-sized cap takes the bill from $19-104/month to roughly $1/month, at which
point the model choice stops mattering. This is decision 14d, and it is the whole answer.

## Finding 2 — self-hosting loses by one to two orders of magnitude

| Option | $/mo @ 7,200 calls |
|---|---|
| DeepInfra Llama 3.1 8B | $0.20 |
| Mistral Ministral 3 8B | $1.08 |
| **Claude Haiku 4.5 (baseline)** | **$18.72** |
| Rented A5000, 24/7 | $197 |
| RTX 4090 24/7 — cheapest card meeting the 1-3s latency budget | $540 |

Break-even for owning a GPU vs Haiku: **~207,700 calls/month (29× realistic volume)**. Against
per-token open-weight APIs it moves out to 1.6-7M calls/month. Scale-to-zero serverless is
disqualified before cost is reached: cold start for a 7B model is 15-30s (Modal) or 10-20s (RunPod)
against traffic arriving once every ~2 minutes, so most requests arrive cold and a 1-3 second wait
becomes thirty. Duty cycle at this volume is 2-5% — paying for a 24-hour GPU to do ~40 minutes of
work a month.

## Finding 3 — two assumed levers do not exist, and one does

- **Prompt caching does not fire.** Minimum cacheable prefix is 1,024 tokens on Anthropic and OpenAI,
  2,048-4,096 on Gemini. This prompt is ~600. Earlier estimates in this session that credited caching
  with a ~14% saving were wrong.
- **The Batch API's 50% discount does not apply** to an interactive regenerate loop. It remains correct,
  and should be mandatory, for bulk paths (autolist sweeps, media-library alt-text).
- **Output is ~77% of the bill** at every provider surveyed, so providers rank on *output* price, not
  blended. One call returning N variants, and an honest `max_tokens` (~250, not 400+), are the real
  levers. This is decision 14e.

## Finding 4 — provider disqualifications

- **Gemini free tier: barred twice.** Google's terms permit training on prompts and responses with
  human review on the unpaid tier, and separately state that only *paid* services may be used when the
  API client is made available to users in the EEA, Switzerland or the UK.
- **DeepInfra, Novita, Together, Fireworks:** cheapest rows in the table ($0.02-0.06/1k calls) but no
  authoritative data-retention statement could be found for any of them. Excluded for tenant business
  data regardless of price.
- **Cleared:** Mistral Ministral 3 8B ($0.15/$0.15, EU-domiciled, first-party); Groq gpt-oss-20b
  (self-serve zero-data-retention toggle); Cloudflare Workers AI (states no training, no prompt or
  output storage; ~10,000 neurons/day free, which by our own arithmetic covers ~33,000 calls/month —
  Cloudflare does not state that conversion, so treat it as indicative).

## Finding 5 — the quality evidence does not exist

No public benchmark evaluates any of these models on short-form marketing copy. EQ-Bench Creative
Writing v3 ranks only frontier models. The available proxies split awkwardly and inconveniently:
Qwen3-8B leads instruction-following (IFEval 83.0 vs Gemma-3-12B's 80.2), which is what platform
rewrites and character limits need, while Gemma-3-12B leads creative writing (79.9 vs 64.5), which is
what hook generation needs. No single small model wins the feature. **Any provider switch is therefore
gated on a blind A/B over ~200 real drafts**, which costs under a dollar to run and is the only
evidence that will exist. Treat the ≤3B tier as unvalidated for tone-following — flattening into
generic LinkedIn-ese is exactly the failure a marketer rejects.

## Finding 6 — most of the perceived value needs no model

Ranked by value ÷ effort: per-platform limit validation; **best-time-to-post from the tenant's own
pixel and engagement data** (highest value — Metricool's 2026 survey of 700+ professionals found
analytics use rose 32% → 59% year over year, and the stated want is exactly this); readability,
spam-word and emoji-density linting; hook-formula and caption templates; first-comment and CTA
snippets. Days of work each, zero marginal cost forever. **Hashtag suggestion is cut** — Instagram
removed hashtag-following in December 2024 and Meta has stated hashtags do not drive reach.
**Alt-text is the one item to absorb** as real inference: metadata-derived alt-text is visibly bad, and
the European Accessibility Act (applying since 28 June 2025, via EN 301 549 / WCAG 2.1 AA) reaches
social content. This is decision 14f.

The weakest assumption in the whole plan: that template-filled hooks feel as valuable to users as
generated ones. Unsourced, and a one-week prototype settles it.

## Sources

Pricing and terms fetched 2026-09-07.
[Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing) ·
[Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) ·
[Gemini API terms](https://ai.google.dev/gemini-api/terms) ·
[OpenAI pricing](https://developers.openai.com/api/docs/pricing) ·
[OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) ·
[Mistral pricing](https://docs.mistral.ai/inference/pricing/) ·
[Groq models](https://console.groq.com/docs/models) ·
[Groq data policy](https://console.groq.com/docs/your-data) ·
[Cloudflare Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) ·
[Cloudflare data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/) ·
[DeepInfra](https://deepinfra.com/pricing) ·
[Together](https://www.together.ai/pricing) ·
[RunPod pricing](https://www.runpod.io/pricing) ·
[Modal pricing](https://modal.com/pricing) ·
[Qwen3 Technical Report](https://arxiv.org/html/2505.09388v1) ·
[Buffer pricing](https://buffer.com/pricing) ·
[Later pricing](https://later.com/pricing/) ·
[Metricool pricing](https://metricool.com/pricing/) ·
[Publer: connect your OpenAI account](https://publer.com/help/en/article/how-to-connect-my-openai-account-1dmawuf/) ·
[Planable pricing](https://planable.io/pricing/) ·
[Metricool AI in Social Media 2026](https://metricool.com/social-media-ai-report/) ·
[EU Accessibility Act 2025](https://baymard.com/blog/european-accessibility-act-2025) ·
[Serverless GPU cold-start benchmarks](https://dev.to/mrzitoun/benchmarking-serverless-gpus-modal-vs-runpod-vs-replicate-cold-starts-2026-a5c)

**Lower-confidence, flagged by the agents:** Groq pricing (docs URL 404'd; third-party trackers only);
Mistral's free-plan retention terms (unverified — check before relying on the $10/mo credit); Sprout
Social's per-tier AI attribution (secondary sources); Hetzner GEX44 pricing and availability;
Vast.ai rates (marketplace, move daily); the Cloudflare neuron→calls conversion (our arithmetic, not
Cloudflare's).
