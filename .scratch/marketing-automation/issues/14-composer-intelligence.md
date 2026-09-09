# 14 — Composer intelligence

Type: task
Status: ready-for-agent
Blocked by: 13

Everything that makes the composer smarter, from the free deterministic work through to metered
generation. Originally scoped as "AI Social Media Assistant"; the research behind it found most
of the perceived value needs no model at all, so the model-free work leads.

Decisions: **14a, 14a-bis, 14b, 14c, 14d, 14e, 14f, 14g, 14h** in `map.md`. Cost research,
provider comparison and disqualifications: the Appendix in `hardening-and-design-research.md`.

**Phase 1 ships without Phase 2.** This matters more than the file boundary: Phase 1 has no
blockers, while Phase 2 waits on a pricing figure and a quality A/B. **Do not hold Phase 1
behind Phase 2** — they are one ticket for bookkeeping, not one deliverable. Phase 1 is
Sonnet-mechanical; Phase 2's design pass is done and its decisions are below.

> `classify-ticket.sh` flags this ticket OPUS on Phase 2's credentials and PII signals, which is
> correct. Note the script greps keywords and cannot see negation, so sentences *denying* a risk
> trip the same rules — do not read its output as a per-phase verdict.

---

# Phase 1 — no model, no marginal cost

## 14.1 — Per-platform limit validation

The composer has character meters. Extend them to everything else that makes a publish fail.

**Do:** a lookup table per network — character cap, media count, aspect ratios, mention and
hashtag caps, link handling, video length — and one validator the composer runs against the
selected channels before enabling publish.

**Rule (14f):** a pure data table plus a validator. It never calls a model, and never calls a
network to ask. A network whose limits change is a table edit.

## 14.2 — Best time to post, from the tenant's own data

**Highest-value item in the whole composer**, and it needs no model. Ticket 09 already ships the
tracking pixel and per-campaign aggregation; ticket 05 renders an engagement heatmap fed by
placeholder data.

**Do:** compute posting-time recommendations from this tenant's own engagement history per brand
and per network. Fall back to a cohort or global median when a brand has too little data to be
honest — and **say which one is being shown**, rather than presenting a global median as if it
were the tenant's own.

**Why it leads:** Metricool's 2026 survey of 700+ professionals found analytics use rose from
32% to 59% year over year, and the stated want is a tool that suggests strong posting times. The
data is already yours.

## 14.3 — Composer linting

**Do:** readability scoring (Flesch–Kincaid), spam-word flagging, emoji density, ALL-CAPS
detection, and a per-network warning when a link will be stripped or de-prioritised.

Reads as the tool paying attention. Costs nothing. Cannot hallucinate.

## 14.4 — Hook formulas, templates, and a snippet library

**Do:** a picker of proven public hook frameworks (AIDA, PAS, listicle, contrarian,
curiosity-gap) that fills a skeleton with the user's own subject line; a per-tenant saved snippet
library for first comments and CTAs, with a starter set.

**This is the ticket's one real assumption.** Whether a template-filled hook feels as valuable to
a user as a generated one is unsourced — no evidence either way was found. It is load-bearing
for the whole zero-inference argument, so **put it in front of real users before Phase 2's
allowance is finalised.** If it fails, Phase 2 absorbs more volume than 14d assumes.

## 14.5 — Hashtag suggestion is cut

Do not build it. Instagram removed hashtag-following in December 2024 and Meta has stated
publicly that hashtags do not drive reach. Building the engine in 2026 is building the feature
social managers were told to stop caring about.

Recorded here so it is not silently re-added by the next person reading the original map entry.

---

# Phase 2 — metered generation and alt-text

**Two inputs gate this phase, neither of them engineering:** the allowance figure (14d sets 20
per tenant per month — the owner's to change) and the 14g quality A/B, ~200 real drafts through
the candidate models, under a dollar to run and the only quality evidence that will ever exist.

## 14.6 — The allowance is the product decision

**Rule (14d):** a hard server-side ceiling per tenant per month, denominated in **dollars
computed from `response.usage`**, not request counts, so a model or prompt change cannot quietly
raise it. Resets monthly, no rollover. The category standard is far smaller than instinct
suggests — Later ships 5 caption credits on an $18.75/mo plan; Metricool ships 5 per brand and
counts alt-text against them.

At ~20 tenant companies and a 20/month allowance this is ~400 calls/month, **about $1/month on
Haiku 4.5** — which is what makes the platform key in 14a affordable at all.

The UI shows remaining allowance **before** the user starts generating, not after a refusal.

## 14.7 — Credentials and the provider seam

**Rule (14a):** `ANTHROPIC_API_KEY` becomes a fourth entry in `MARKETING_SECRET_VARS`
(`vault-secrets.ts`), inheriting ticket 12's rule — production boot refuses a missing secret,
development gets an ephemeral value, no hardcoded fallback exists to copy. It is a *platform*
secret, not per-tenant, so it does not go through `CryptoService`.

**Rule (14a-bis):** every call resolves credential and endpoint through
`resolveAiProvider(companyId)`. No call site reads `process.env`.

**Rule (14g):** Haiku 4.5 is the default. If the A/B moves it, it moves only to a provider with a
written retention position — **Mistral Ministral 3 8B** or **Groq gpt-oss-20b** cleared;
DeepInfra, Novita, Together and Fireworks are excluded for tenant business data regardless of
price, because no authoritative retention statement could be found for any of them. **Gemini's
free tier is barred outright**: Google trains on unpaid-tier prompts with human review, and its
terms permit only paid services when the API client serves users in the EEA, Switzerland or the
UK. **Self-hosting is closed** — break-even is ~207,700 calls/month, 29× realistic volume, and
scale-to-zero serverless dies on 15-30s cold starts.

## 14.8 — What goes in, and what comes out

**Rule (14b):** the prompt is assembled server-side from a closed, typed field allowlist — brand
name, tone, product description, target platform, character limit, and the user's draft. Not a
`Record<string, unknown>`. **No query against `crm` tables at all**, which also keeps this on the
right side of the `cross-module-tables` rule that produced six of ticket 12's violations.

**Rule (14c):** text originating outside the tenant — inbox messages, RSS entries, competitor
metadata — is fenced into a delimited data block as data, never instructions. And the
load-bearing half: **no model output takes an action.** It fills an editable draft field a human
must accept. Nothing generated auto-schedules, auto-publishes, or auto-sends an inbox reply.

## 14.9 — Token hygiene

**Rule (14e):** one call returns N variants — never N calls, which pays the ~600-token
brand-voice prefix N times. `max_tokens` capped from the real output shape: a caption is 30-60
tokens, so ~250 for a three-variant response, not a 400+ default. Output is ~77% of the bill.

Two levers this must **not** be built to rely on, both verified rather than assumed:

- **Prompt caching never fires.** Minimum cacheable prefix is 1,024 tokens on Anthropic and
  OpenAI, 2,048-4,096 on Gemini. This prompt is ~600.
- **The Batch API's 50% discount does not apply** to an interactive regenerate loop. It is
  mandatory for bulk paths — an autolist sweep, a media-library alt-text run — which must never
  hit the interactive endpoint.

No extended thinking on this route: it is short-form rewriting, and thinking multiplies the
expensive half of the bill.

## 14.10 — Alt-text

The one feature worth absorbing rather than metering hard, and the only one with a legal driver
rather than a taste one: the European Accessibility Act has applied since 28 June 2025 and
reaches social content via EN 301 549 / WCAG 2.1 AA.

**Do:** one vision call per image, producing an editable text alternative. Do **not** derive
alt-text from EXIF or filenames — it produces garbage users notice immediately. Bulk runs go
through 14.9's batch path.

## 14.11 — BYO key as the escape valve

**Rule (14h):** a tenant needing 500 generations a month brings their own key rather than
churning. Publer does exactly this at a $10/account price point, so it is proven in this category
at these economics.

The tenant key **is** a per-tenant secret, so unlike 14.7's platform key it goes in the existing
encrypted vault (`CryptoService`, `v1.iv.ct.tag`, masked from the **decrypted** value per 11.4a),
resolved through `resolveAiProvider`. It **raises** that tenant's allowance rather than removing
the metering. Expect low single-digit adoption — this is not a cost strategy.

---

## Done when

**Phase 1** (ship independently):
- Publish is refused for a post violating a selected network's limits, naming the limit and the
  network.
- Best-time recommendations use the tenant's own data where it exists and visibly say so when
  falling back to a global median.
- Lint warnings appear for readability, spam words, emoji density and caps.
- A hook template applies to a draft; a saved snippet inserts.
- No hashtag engine exists.
- Phase 1 makes no model call and leaves the module's environment variable list unchanged.

**Phase 2:**
- The allowance is enforced server-side in dollars, shown before generating, and cannot be
  exceeded by any client.
- Production boot refuses to start with the AI secret absent.
- No call site reads `process.env` for a model credential.
- The prompt builder rejects out-of-allowlist fields; the AI path issues zero `crm` queries.
- No generated output can schedule, publish or send without an explicit human accept.
- A three-variant request is one API call, with `max_tokens` reflecting real output size.
- Bulk alt-text goes through the batch path; the interactive endpoint refuses bulk.
- The A/B result is recorded in the resolution entry, whichever way it went.

**Both:** `npm run typecheck`, `check:modules`, `check:tenancy`, `check:conformance`,
`test:backend` and `test:app` pass, with their **actual output quoted** (13.4).

**Tests ship with each phase.** Phase 1: a post over the limit for one selected network but not
another; a brand with no history falling back and labelling it; a template applied to a draft
that already has text. Phase 2: a tenant at their allowance refused *before* the API call is
made; a prompt-injection payload arriving as data whose output still requires an accept; an
out-of-allowlist context field rejected by the schema.
