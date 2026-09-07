# Marketing — the public surface

Most of this module is ordinary authenticated CRUD. Four endpoints are not, and this file is
about those: what they let an unauthenticated caller do, what stops them doing it too often, and
which of those defences does less than it looks like it does.

## The unauthenticated endpoints

| Endpoint | What it writes | Limit |
|---|---|---|
| `POST /api/marketing/forms/:formId/submit` | a CRM `Lead`, a submission row, the form's counter | **10 per minute** per caller **per form**, and 500 per form per day |
| `POST /api/marketing/collect` | a `PageViewEvent` | **120 per minute** per caller **per pixel key** |
| `POST /b/:slug/clicks` | the SmartLink's `clicks` JSON | **60 per minute** per caller **per slug** |
| `GET /b/:slug` | a view counter | not limited — it is a page, and a read |

The form endpoint is the one that matters. It reaches the CRM, so anyone who learns a form ID
can put rows in somebody's sales pipeline. Three things stand between them and that: the limit
above, a honeypot field (`_hp`, shipped in the embed code and empty for every human being), and
the form's own `schemaFields`, which is now enforced rather than decorative — an unknown key is
dropped, a missing required field or a type mismatch is a 400 naming the field.

The whole submit path — counter, CRM lead, submission row — is one transaction, and
`marketing.lead.captured` is emitted after it commits. A rollback cannot publish an event for a
lead that no longer exists.

## The limits are per instance

Throttler storage is **in memory**. That is a decision, not a default:

- The counters live in one process. Two instances behind a load balancer mean **twice** every
  number in the table above.
- A restart forgets every window.

This is acceptable while the deploy is single-instance, and adding Redis for it would contradict
this module's zero-new-infrastructure charter (the job queue is Postgres-backed for the same
reason). **The moment this application runs on more than one instance, shared throttler storage
is a blocker rather than an improvement.** That is the recorded trigger; it is not a
nice-to-have, and the numbers above stop meaning what they say the day it fires.

## The bio page

`GET /b/:slug` renders HTML from JSON columns, unauthenticated, **on the same origin as the ERP
application**. Three things hold, in this order:

1. **Validation at the write boundary** (`schemas.ts`). Theme colours are hex and nothing else;
   `fontFamily` is an *identifier* the renderer maps to a hard-coded stack, never a font stack
   the caller writes; `cardStyle` is its own union; unknown theme keys are refused. Every
   URL-bearing field is parsed with `new URL()` and must be `https:`, `http:`, `mailto:` or
   `tel:` — an escaped `javascript:` href is still fully executable, which is the case this
   guards. A bad value is a **400 at write time**, never a stripped value or a fallback render.
2. **A renderer that trusts nothing it reads back.** Rows predating those types exist. A
   malformed entry costs its own card; it never takes the page down, and `escapeHtml` coerces
   rather than throwing on a number or a `null`.
3. **A per-response nonce CSP**, generated from a CSPRNG:
   `default-src 'none'; style-src 'nonce-…'; img-src https: data:; script-src 'nonce-…';
   connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`.
   No `unsafe-inline`, no `unsafe-eval`, no wildcard `script-src`. `connect-src 'self'` is there
   because the page's own click beacon needs it and nothing else does. The header is set by
   `BioPageCspMiddleware`, mounted on `/b`, so a new bio-page route cannot ship without it.

The CSP is defence in depth and is ordered **behind** the validation. It must never become the
reason a bad stored value is considered acceptable.

### Origin isolation — deferred, with a trigger

Public pages stay on the ERP's origin for now. The split to `links.<host>` is the only mitigation
that survives a future renderer mistake, but it needs DNS, hosting config and an absolute-URL
contract for every asset the page emits — infra work, and blocking the module's only unblocking
ticket on it would trade a certain functional win for an uncertain one.

What was verified before accepting that:

- **There is no ERP session cookie.** The session is a JWT the SPA holds in `localStorage`
  (`erp.session.token`) and sends as `Authorization: Bearer`. No backend code sets a cookie, so
  there is no `Domain=` attribute to get wrong and nothing that would ride along on a
  cross-subdomain request. That is stronger than the host-only/`HttpOnly`/`Secure`/`SameSite=Lax`
  property the split would have depended on — **but note the trade**: a token in `localStorage`
  is readable by any script that executes on this origin, which is precisely why the validation
  above is the control and the CSP is not.
- The bio page renders no ERP session state and issues no authenticated fetches.

**Trigger for revisiting:** either a customer-facing custom domain for bio pages, or the first
bio-page feature that needs to embed third-party content. Carried as an open infra decision under
ticket 12's secrets and infra scope.

## Publishing quotas

One helper — `publishing-quota.ts` — answers both "may this publish go ahead" and "what does the
UI show", so the enforced number and the displayed number cannot drift apart. A quota is spent
when a post reaches the platform: `PUBLISHED` rows by `publishedAt`, plus `FAILED` rows whose
`networkAttemptedAt` is set, because the platform counted those too. Scheduling a hundred posts
for next month spends nothing today.

Publishing claims its row conditionally (`updateMany` with the publishable states in the `where`,
proceeding only on `count === 1`) before any network call — the same claim the job queue makes.
Two concurrent publishes of one post produce one post on the client's account.

## Secrets (ticket 12)

Three environment variables, no defaults, checked once at boot in `CryptoService.onModuleInit`
via `vault-secrets.ts`:

| Variable | What it protects |
|---|---|
| `MARKETING_VAULT_SECRET` | Derives the key that encrypts stored OAuth access/refresh tokens |
| `MARKETING_OAUTH_STATE_SECRET` | Signs the OAuth `state` parameter |
| `MARKETING_ANALYTICS_PEPPER` | Peppers the daily visitor IP hash |

In production a missing or shorter-than-32-character value **refuses the boot**. Outside
production a missing one gets an ephemeral key generated per process, so development tokens do
not survive a restart — intended, because it makes the production failure mode unreachable by
accident. Each previously fell back to a constant committed to this repository, which made the
vault's own promise ("cannot read tokens without the server's vault secret") false.
`SESSION_SECRET` is deliberately not a fallback for any of them: reusing the session signing key
as an encryption key couples two rotations that have to stay independent.

**Key rotation.** Ciphertext is `<kid>.<iv>.<ct>.<tag>`. To rotate: set
`MARKETING_VAULT_KEY_ID=v2` with a new `MARKETING_VAULT_SECRET`, and move the old secret into
`MARKETING_VAULT_RETIRED_KEYS` as `v1:<old secret>` (comma- or semicolon-separated `kid:secret`
pairs; a secret may not contain those separators). New writes use v2; v1 rows keep opening. A
three-part string with no key id is read as `v1` for one release. A ciphertext naming a key id
we do not hold fails as `vault_key_unknown`, distinct from `vault_decryption_failed`, so a
configuration mistake is not investigated as tampering. Envelope encryption — a per-record data
key wrapped by a KEK — is the recorded end state; its trigger is a second secret store or a
scheduled-rotation compliance requirement.

**The IP pepper is not rotated on a schedule**, and that is a trade rather than an oversight:
rotating it makes one visitor look like two, so unique-visitor counts break across the boundary.

## Retention

`RetentionService` registers a `marketing.retention.purge` handler on this module's own queue —
no cron, no new infrastructure. It deletes `PageViewEvent` rows older than
`MARKETING_ANALYTICS_RETENTION_DAYS` (default **180**) in batches of 10,000, re-enqueuing itself
immediately while a batch comes back full and otherwise a day later, so one tick can never hold a
long lock on the table the public pixel is writing to. Raw event rows only; aggregates already
computed stay. At module init a purge is queued per tenant **only when one is not already
pending**, so a restart cannot fan out duplicates.

## Bio page clicks

`SmartLinkClick` is one insert-only row per click — no upsert, no counter on the row, nothing for
two concurrent clicks to contend on. Reads aggregate with `count`/`groupBy`. The pruned-to-500
`SmartLink.clicks` JSON array it replaces is kept read-only for one release so existing pages keep
rendering their history, and is dropped in a follow-up migration. Click writes happen outside any
user-facing transaction and are swallowed on failure: a click that cannot be recorded must never
break the redirect the visitor is waiting on.
