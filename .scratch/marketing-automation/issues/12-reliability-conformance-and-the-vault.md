# 12 — Reliability, conformance, and the vault

Type: task
Status: resolved
Blocked by: 11

Phase 2 of 3. Ends with the queue trustworthy, conformance green, repo-wide tests green, and
the vault safe to operate.

Audit and scoring model: `.scratch/marketing-automation/hardening-and-design-research.md`.

---

## 12.1 — Queue lease, reaper, and fencing guard

`lockedAt` is written in `postgres-job-queue.service.ts:200` and **never read back**. There is
no reaper. A worker that dies mid-`executeJob` leaves the job `PROCESSING` forever — it will
never retry and never fail.

For a scheduled-posting product this means **posts silently never go out while the dashboard
stays green.** Worst reliability defect in the module.

**Do:**
- Add a lease + janitor pass on the existing poll tick: return
  `status = 'PROCESSING' AND lockedAt < now() - lease` to `PENDING`, or `FAILED` once attempts
  are spent.
- **Add a fencing guard, and do not ship the reaper without it.** A lease alone is not enough:
  a slow-but-alive worker can outlive its lease, have the job re-claimed, and then *both* run —
  with the stale worker's `complete()`/`fail()` overwriting the re-claimed job's state.
  `complete()`/`fail()` must carry and match on the `attempts` value the worker claimed.
  Without this you trade one bug for a worse one.
- `job-queue-worker.service.ts:82` awaits jobs one at a time, so ten posts to Meta go out
  serially. Use `Promise.allSettled` under a concurrency cap.

**Resolve the map's `SKIP LOCKED` claim, one way or the other.** `map.md` says the queue uses
`FOR UPDATE SKIP LOCKED`; `poll()` actually fetches candidates then issues one conditional
`UPDATE` each, `batchSize * 2` round-trips per poll. Correctness holds (the conditional update
is genuinely atomic under READ COMMITTED), so this is a documentation defect — but either
correct the map, or implement real `SKIP LOCKED`, which needs an explicit exemption from the
raw-SQL prohibition in ADR 0003 / `check-tenancy.mjs`. Do not leave it ambiguous.

## 12.2 — Conformance and the CRM boundary

`npm run check:conformance` **fails with 16 violations, all in `marketing`**, and takes
`backend/test/generator.spec.ts` and `backend/test/conformance.spec.ts` down with it — this
module is breaking repo-wide tests.

| Count | Rule | Where |
|---|---|---|
| 6 | `cross-module-tables` | `crm-bridge.service.ts:70,113,136,157,183`, `inbox.service.ts:462` |
| 8 | `list-parameters` | `tracking.controller.ts:39,61,62,70,71,72,73,74` |
| 1 | `hand-rolled-paging` | `social-accounts.service.ts:533` |
| 1 | `body-validated` | `ad-webhooks.controller.ts:28` |

The `cross-module-tables` ones matter most and are the real work here. `crm-bridge.service.ts`
and `inbox.service.ts` write `Lead`, `LeadSubmission` and `Activity` **directly**. The map's
headline decision was "decoupled domain events for lead conversion" — the events *are* emitted,
but the writes bypass `crm`'s public surface anyway, so the stated architecture and the code
disagree.

**Do:**
- Add the write operations `marketing` needs to `backend/src/modules/crm/index.ts` and call
  through that surface. Budget most of this sub-ticket here.
- `tracking.controller.ts` — take `@Query()` whole into `listQuery(query, SPEC)` per ADR 0004.
- `social-accounts.service.ts:533` — use `listQuery(...).findMany()` so the page-size ceiling
  and identifier tiebreak apply.
- `ad-webhooks.controller.ts:28` — declare a validator; there is no global pipe to fall back on.
- **Wire `check:conformance` into the definition of done for this effort.** Tickets 01-06
  claimed it passed; from 07 onward the phrase quietly disappeared from the map rather than the
  failure being fixed. That process defect produced everything in this section.

## 12.3 — Vault secrets, key rotation, retention

- **Hardcoded fallback keys.** `crypto.service.ts:29` falls back to
  `'erp-marketing-oauth-vault-secret-salt-development-key'`; the OAuth state HMAC does the same
  at `social-accounts.service.ts:437`. Deploy without the env vars and every token is encrypted
  under a key committed to this repo — which makes the service's own docstring ("cannot read
  tokens without the server's vault secret") false. **Refuse to boot in production without it.**
- **No rotation path.** Ciphertext is `iv.ct.tag` with no key id, so rotating
  `MARKETING_VAULT_SECRET` bricks every stored token and the only recovery is re-authorising
  every account. Minimum: prefix a key id (`v1.iv.ct.tag`) + a map of retired keys. Envelope
  encryption (per-record DEK wrapped by a KEK, so rotating the KEK re-wraps small keys and
  never touches bulk ciphertext) is the right end state — record it as the direction.
- **IP hashing is half right.** `tracking.service.ts:450` rotates the salt daily, which is the
  correct instinct, but the salt *is* the date, so it is public. IPv4 is 2^32; a DB dump plus a
  known salt de-anonymises every visitor in seconds. Add a secret pepper.
- **No retention anywhere** — `grep deleteMany|retention|purge` returns nothing across the
  module. `PageViewEvent` grows unbounded: a cost problem and a GDPR storage-limitation
  problem. Add a retention job on the queue this module already has.
- `SmartLink.clicks` is a read-modify-write on a JSON column from an unthrottled public
  endpoint. Pruned to 500 (good), but concurrent clicks lose updates. Move to a rows table.

---

## Done when

- A job whose worker died is reclaimed and retried within the lease window.
- A stale worker returning after its lease expired **cannot** overwrite the re-claimed job.
- A batch of N jobs executes concurrently, not serially.
- `map.md` and the queue code agree about how claims work.
- `npm run check:conformance` passes; `generator.spec.ts` and `conformance.spec.ts` pass.
- `marketing` no longer touches `crm`-owned tables directly.
- `check:modules` and `check:tenancy` still pass.
- The app refuses to start in production without a vault secret.
- A token encrypted under `v1` still decrypts after `v2` becomes active.
- `PageViewEvent` rows past the retention window are removed on a schedule.
- Concurrent clicks on one SmartLink all persist.
- `npm run test:backend` passes — currently **7 failed / 711**.

**Tests ship with this ticket.** The reclaim path and the stale-worker race in particular are
easy to write and impossible to trust without.
