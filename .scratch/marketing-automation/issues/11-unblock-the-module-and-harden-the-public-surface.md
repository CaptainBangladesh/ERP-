# 11 — Unblock the module and harden the public surface

Type: task
Status: resolved

Phase 1 of 3. Ends with the module actually usable in a browser and the unauthenticated
surface defended. Most of the +53% lands here.

Audit and scoring model: `.scratch/marketing-automation/hardening-and-design-research.md`.

---

## 11.1 — Route contract (do this first)

`MarketingController` is registered first in `marketing.module.ts:57` and declares
`@Get(':id')` on `@Controller('api/marketing')` (`marketing.controller.ts:46`). NestJS matches
in registration order, so the bare `:id` swallows every single-segment sibling route added by
tickets 02-10. Eight list endpoints return **500**:

```
/brands  /posts  /campaigns  /jobs  /autolists  /smart-links  /ad-syncs  /tracking-sites
```

Prisma then fails parsing the literal string as a UUID:
`Inconsistent column data: Error creating UUID ... found 'r' at 2`.

Proven by the failing `backend/test/marketing-vault.spec.ts:160`.

**Consequence:** the Brand Switcher loads nothing, `activeBrand` is null, and all nine tabs in
`MarketingPage.tsx` fall through to "No Brand Selected". The module is unusable.

**Why nothing caught it:** all 389 frontend tests run against MSW mocks and never touch the
real Nest router.

**Do:**
- Give the ticket-01 scaffold CRUD its own segment — `@Controller('api/marketing/records')` —
  so no controller owns a bare `:id` at depth 1. Update `MARKETING_ROUTE` / `MARKETING_PATHS`
  in `packages/src/modules/marketing/contract.ts` and the "Campaign Records" tab's calls.
  (Moving `MarketingController` last in the array is the one-line stopgap, but it leaves the
  trap armed for the next route added.)
- Add a conformance rule `no-bare-id-at-module-root`. ADR 0005 establishes that boundaries
  here are enforced by the pack, not by discipline.

## 11.2 — Stored XSS on the public bio page

`smart-links.service.ts:380-383` interpolates theme values raw into `<style>`:

```js
--primary: ${theme.primaryColor};   --font: ${theme.fontFamily};
```

Every other field on the page is escaped — this block was missed. `theme` is validated only as
`optional(jsonObject(...))` (`schemas.ts:509`), so no key is checked. A `primaryColor` of
`red}</style><script>...</script><style>{` is stored XSS on `/b/:slug`, **same origin as the
ERP app**, so session cookies are in reach.

Related, same root cause — unvalidated JSON columns:
- `escapeHtml` (`:588`) handles `& < > " '` but **not URL schemes**. `buttonLinks` is
  `jsonArray(...)`, so a `javascript:` URL renders as a live `href`. OWASP is explicit that an
  escaped `href` bound to user data still executes.
- `escapeHtml` throws on a non-string, which is a 500 on a public page.

**Do:**
- Validate theme per key: colors `/^#[0-9a-f]{3,8}$/i`, `fontFamily` against an allowlist,
  `cardStyle` against its union. Reject, don't sanitise.
- Type `buttonLinks` / `shoppableGrid` / `socialLinks` properly instead of `jsonArray`.
- Allowlist URL schemes at **write** time via `new URL()`: `https:`, `http:`, `mailto:`, `tel:`.
- Serve `/b/:slug` under a nonce-based CSP — defence in depth *behind* the validation.
- **Decide and record:** move public pages to a separate origin (`links.<host>`)? It is the
  cheapest real mitigation — a miss could then never reach an ERP session cookie. This is an
  infra call worth answering before writing the code.

## 11.3 — Rate limiting and form validation

There is **no HTTP rate limiting anywhere in this application**; `@nestjs/throttler` is not a
dependency. Three `@Public()` endpoints take unauthenticated writes:

| Endpoint | Writes |
|---|---|
| `POST /api/marketing/forms/:formId/submit` | CRM `Lead` + submission row |
| `POST /api/marketing/collect` | `PageViewEvent` |
| `POST /b/:slug/clicks` | `SmartLink.clicks` JSON |

The form endpoint is the worst: no throttle, no captcha, no honeypot, no origin check, writing
straight into the CRM via `CrmBridgeService`. Anyone who learns a form ID can flood the sales
pipeline. (The ticket-10 publishing limits are *platform quota* guards and do not apply here.)

`forms.service.ts:221` also **never validates submissions against the form's own
`schemaFields`** — the declared shape is decorative. `fields.email as string` is a cast, not a
check, so an object reaches a Prisma string column and 500s. And the counter, the CRM lead and
the submission row are written outside a transaction, so a late failure leaves an orphan lead.

**Do:**
- Add `ThrottlerModule`; `@Throttle` the three public writes, `@SkipThrottle` internal routes.
- Default storage is in-memory and does not hold across instances — adopt the Redis adapter or
  accept per-instance limits **knowingly** and write that down.
- Validate submissions against `schemaFields`; type-check extracted contact fields.
- Add a honeypot and a per-form daily cap.
- Wrap the submit path in a transaction.
- Keep ADR 0012 behaviour (a public submission fills empty fields only) intact.

## 11.4 — Publishing correctness

- **Double publish.** `social-publisher.service.ts:129` reads `post.status` then writes
  `PUBLISHING` in a separate statement. Two concurrent calls both pass and both hit the network
  — a duplicate post on a client's real account. Use the conditional
  `updateMany({ where: { id, status: { in: [...] } } })` + `count === 1` the queue already uses.
- **Quota measured on the wrong column.** `:492` counts by `createdAt` with status
  `IN ('PUBLISHED','SCHEDULED')`. Bulk-schedule 60 posts for next month → blocked today having
  published nothing; schedule 50 last week that fire today → Meta's real 50/24h quota blown
  with no guard. `FAILED` is excluded but still spent quota. `social-accounts.service.ts:469`
  has the same bug, so the number in the UI is decorative. Count actual publish time.
- **A test shim disables the limit in production.** Delete
  `if (typeof this.prisma.scheduledPost?.count !== 'function') return;`.
- **Masked token masks the ciphertext.** `social-accounts.service.ts:404` calls
  `maskToken(row.encryptedAccessToken)`, so the UI shows the last 4 chars of a GCM auth tag.
  Two of the four failing vault tests report exactly this. **Fix the code, not the test.**

---

## Done when

- All eight list endpoints return 200; `marketing-vault.spec.ts` multi-tenancy test passes.
- A theme colour containing `</style><script>` and a `javascript:` button URL are both refused
  with 400; a non-string in a JSON array cannot 500 the public page.
- Exceeding the limit on each public endpoint returns 429; a submission not matching the form's
  schema is refused; a non-string `email` returns 400 not 500.
- Two concurrent publishes of one post produce exactly one network call.
- Far-future scheduling does not consume today's quota.
- `marketing-vault.spec.ts` masking assertions pass **without being edited**.

**Tests ship with this ticket, not later.** Minimum: an HTTP smoke test that boots Nest and
asserts 200 on all eight list routes (worth more than the ~60 label-presence assertions
currently in the module), plus one test per bullet above that fails if the fix is reverted.
Write them to the bar the CRM suite already sets in this repo — *"abandons an edit on Escape"*,
*"reports a partial archive rather than swallowing the leads it could not archive"* — behaviour
a user would notice, not label presence.

---

## Resolution

All four sections landed together with their tests — `backend/test/marketing-hardening.spec.ts`,
19 cases over HTTP against the real router and the real database, plus one new conformance rule
case in `conformance.spec.ts`.

**11.1** `MarketingController` moved to `@Controller(MARKETING_RECORDS_ROUTE)` —
`api/marketing/records` — and `MARKETING_PATHS.marketings` / `.marketing(id)` followed, so the
frontend's "Campaign Records" tab needed no edit of its own. All eight list endpoints answer 200;
`marketing-vault.spec.ts` is fully green (15/15). Conformance rule `no-bare-id-at-module-root`
refuses the shape rather than the instance: it fires when two or more controllers share a route
prefix and one of them claims a bare `:param` directly beneath it. Scoped to *shared* prefixes
because a prefix one controller owns outright has nothing to shadow — `api/parties/:id` and
friends are unaffected, and the rule adds zero violations across the repo today.

**11.2** `theme`, `buttonLinks`, `shoppableGrid` and `socialLinks` are closed typed schemas in
`schemas.ts`; colours are hex, `fontFamily` is an identifier the renderer maps to a hard-coded
stack, URLs are parsed with `new URL()` and limited to `https:`/`http:`/`mailto:`/`tel:`. Bad
input is refused at write time (422 from the platform validator, which is this repo's shape for
a field-level refusal). `escapeHtml` coerces instead of throwing and the renderer drops
individual malformed entries, so a legacy row degrades one card. `/b/:slug` carries a
per-response CSPRNG nonce CSP with no `unsafe-` token. `connect-src 'self'` was added to the
policy the design pass listed — without it the page's own click beacon is blocked, and it grants
nothing the listed directives were protecting.

**11.2d** verified and recorded in `src/modules/marketing/README.md`: there is **no ERP session
cookie at all**. The session is a JWT held in `localStorage` and sent as `Authorization: Bearer`,
so no `Domain=` attribute exists to get wrong — stronger than the host-only property the rule
asked for, but with the trade written down, since `localStorage` is readable by any script that
runs on this origin. Origin split stays deferred with its trigger recorded.

**11.3** `@nestjs/throttler` 6.5.0 added, wired as a global `ThrottlingModule` in
`platform/throttling`. The guard is opt-in — it skips any handler that has not declared
`@Throttle(...)` — rather than applying a blanket default to forty modules of authenticated CRUD
that nobody chose a number for. The observable contract the design pass asked for is unchanged:
the three public writes are limited (10/min per form, 120/min per pixel key, 60/min per slug),
everything else is not, and exceeding one is a 429 with `Retry-After` and no body detail. Storage
is in-memory and the per-instance caveat sits next to the numbers in the module README.
Submissions are validated against `schemaFields`, a honeypot ships in the embed code, a per-form
daily cap is enforced inside the transaction, and the counter, CRM lead and submission row are
one `$transaction` with `marketing.lead.captured` emitted after commit.

**11.4** Publishing claims its row with a conditional `updateMany` before any network call. Quota
counting moved to one shared helper (`publishing-quota.ts`) that both the guard and the UI read,
counting `PUBLISHED` by `publishedAt` plus `FAILED` by a new recorded `networkAttemptedAt` column
(migration `20260907120000_publishing_quota_network_attempt`). The
`typeof this.prisma.scheduledPost?.count !== 'function'` shim is gone; the two specs that relied
on it carry real stubs. `describeAccount` masks the decrypted plaintext, so the vault's masking
assertions pass unedited, and a test walks every field name in four account-bearing responses
asserting none matches `/^encrypted/`.

Left for ticket 12: the 16 pre-existing conformance violations (`list-parameters` and friends,
all in `marketing`), which are that ticket's scope and are why `conformance.spec.ts` still has
its two repo-wide failures.
