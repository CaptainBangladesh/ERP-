# 15 — External content sources

Type: task
Status: ready-for-agent
Blocked by: 13

Everything in the module that reaches outside it: RSS feed ingestion, competitor benchmarking,
and the Canva / Adobe Express editor integrations. One ticket because all three depend on the
same fetch guard, which 15.1 builds and the rest consume.

Decisions: **14-17.0** (the fetch guard), **16a-16d** (RSS), **15a-15c** (competitors),
**17a-17d** (editor embeds) in `map.md`. Decision IDs are deliberately not renumbered — the
`16x` and `17x` IDs live in this ticket and stay valid in the map.

**Phases ship independently, and 15.1 goes first.** 15.4 is blocked on two vendor OAuth apps
being registered, which is not engineering work; do not let it hold up 15.2 or 15.3.

**Model routing:** `classify-ticket.sh` returns strong signals on all three of external links,
credentials, and concurrency. The Opus design pass is done — the rules below are its output, and
execution against them is Sonnet-mechanical.

---

## 15.1 — `OutboundFetchService` — build this first, everything else consumes it

Three features here fetch a URL an operator supplied, and grepping
`ssrf|127\.0\.0\.1|169\.254|localhost` across `backend/src/modules/marketing` returns
**nothing**. The module has no such guard: the four existing adapters only ever call fixed vendor
hosts, so nobody needed one. A scheduled server-side fetch of a user-supplied URL is the classic
SSRF pivot, and this backend sits next to Postgres.

**Rule (14-17.0):** one service, and nothing else in the module calls `fetch()` with a
non-constant host.

- `https:` only — **not** `http:`, despite `readLinkUrl` permitting it for *rendered* links.
  Rendering and fetching are different trust decisions.
- Resolve the hostname and refuse loopback, link-local `169.254.0.0/16`, RFC1918, ULA
  `fc00::/7`, `0.0.0.0` and `::`.
- Re-run that check after **every** redirect; follow at most 3; never follow a cross-scheme or
  cross-host hop without re-validating.
- No cookies, no `Authorization` header.
- Cap at 10s total and 2 MB of body.
- The check runs **at fetch time on every poll**, not once at save time — a hostname that
  resolved publicly yesterday can resolve to `127.0.0.1` today.
- Every call runs inside a queue worker, never a request handler, so a slow host cannot occupy an
  HTTP thread.

## 15.2 — RSS feed ingest

**Validate feed URLs twice (16a).** Through `readLinkUrl` (`schemas.ts`) narrowed to `https:` at
save time, and through `OutboundFetchService` on every poll. Neither substitutes for the other:
the first gives the operator an immediate error, the second is the one that holds, because the
DNS answer is what changes between them.

**Idempotent ingest, producing drafts (16b).** A unique index on `(brandId, feedId, entryKey)`,
where `entryKey` is the feed's `<guid>` when present and `sha256(link + '\n' + title)` when not.
Ingest is create-if-absent against that key, so a re-poll, a retry after the 12.1b fence rejects
a stale worker, or a feed that renumbers its items can never produce a second `ScheduledPost`
for the same entry. "Auto-enqueue into scheduling queues" plus at-least-once delivery is a
double-publish generator, and this module has shipped that bug once already (11.4b). Entries land
as **`DRAFT`** — auto-publishing from a feed is out of scope, not a config flag.

**One poll job per feed (16c).** Follow `RetentionService`'s enqueue pattern exactly: before
scheduling, check for a live `PENDING`/`PROCESSING` job of that type for that feed and skip if
one exists, so N deploys do not create N pollers. The lease reaper and `attempts` fence from
12.1a/12.1b are what make a worker dying mid-ingest safe. No cron, no `setInterval` beside the
queue.

**Feed content is untrusted text on a rendering path (16d).** Titles and descriptions are stored
and rendered as **text**, never HTML — no feed markup reaches `dangerouslySetInnerHTML` or the
server-rendered bio page. Every link and enclosure URL passes `readLinkUrl` before storage; an
entry whose link fails is dropped rather than stored with a broken href. If an entry later
reaches ticket 14's generation path it is untrusted data under 14c.

## 15.3 — Competitor benchmarking

**Official APIs only; the scraper option is closed (15a).** The map framed this as "public
profile scraping **vs.** official graph APIs" — settled as APIs. Scraping adds an
operator-supplied-URL fetch path, breaks on every markup change, sits against the platforms'
terms, and provides nothing the connected account's own endpoints do not. Metrics are read
through `ISocialNetworkAdapter`, which gains `fetchPublicProfileMetrics(handle)` per network.
**No HTML-parsing fallback anywhere in the module.** A network whose API exposes no public
profile metrics stores the competitor row and renders "not supported on this network" — an
honest empty state, which this module already does well, rather than a scraper behind a flag.

**Authorization and metering (15b).** The snapshot job loads the `SocialAccount` by
`(companyId, brandId, network)` — **never by id alone** — decrypts through `CryptoService`, and
refuses if the brand has no connected account for that network rather than falling back to an
app-level token. Competitor reads consume the **same quota ledger as publishing**
(`publishing-quota.ts`), because Meta and X count them against the same limit; a benchmarking
poll that silently eats a brand's 50/24h publish budget is ticket 11's rate-limit bug in a new
place.

**Aggregates, not content (15c).** A snapshot row holds follower count, post count, engagement
rate and capture date for a public business handle. **No post bodies, no commenter names, no
profile photos mirrored into our storage** — competitor content is third-party copyright and its
commenters never dealt with us, so collecting it turns a metrics feature into a personal-data
processor. Snapshots are append-only rows (nothing read-modify-written on a JSON column, 12.3e)
and expire through the existing `RetentionService` job with their own configurable window.

## 15.4 — Canva and Adobe Express embeds

**Blocked on two vendor OAuth apps being registered.** Do this last; do not let it hold 15.2/15.3.

**Popup OAuth redirect, not a vendor iframe (17a).** An iframe of a third-party editor inside an
authenticated ERP page puts vendor script one framing bug away from our session — and this app
keeps its JWT in `localStorage` (12.3f), where a same-origin script can simply read it. So:
`redirect_uri` is a **server-side constant per vendor**, never read from the query string; the
callback verifies the HMAC-signed `state` exactly as `social-accounts.service.ts` does today,
under `MARKETING_OAUTH_STATE_SECRET`, rejecting on mismatch, expiry or reuse; and after the
callback the server redirects **only to a path on our own origin from a closed allowlist** — no
`returnTo`, `next` or `continue` parameter is honoured, which is the entire class of open
redirect flagged here.

**Token storage (17b).** Vendor refresh tokens go through `CryptoService` in the `v1.iv.ct.tag`
format (12.3b), on a row scoped by `companyId` + `brandId` + connecting `userId`. The API returns
a masked handle derived from the **decrypted** value, never a slice of the ciphertext — that was
ticket 11's `maskToken` bug (11.4a), and a second vault implementation is exactly where it comes
back. Tokens never reach the client. Disconnecting **revokes upstream and deletes the row**,
rather than flagging it inactive.

**`postMessage` validation (17c).** Compare `event.origin` against an exact vendor-origin
allowlist by **string equality, not `endsWith`** — `evilcanva.com` ends with `canva.com`.
Validate the payload shape before touching it; ignore anything else silently. Outbound messages
name the vendor origin explicitly, never `'*'`. The returned asset URL is a user-influenced URL
like any other: `readLinkUrl` first, then `OutboundFetchService` to download it under 15.1's caps.

**Brand-level permission (17d).** Only a `BrandMember` with the publishing role may connect or
disconnect an editor account, checked server-side on **both** routes. The connection is scoped to
the brand, so a member removed from a brand loses the editor along with the social accounts —
an editor account can pull assets into any brand's composer, which is the same mis-posting hazard
13.2d is built around.

---

## Done when

**15.1:**
- `OutboundFetchService` exists, and no other code in the module calls `fetch()` with a
  non-constant host.
- A URL resolving to `127.0.0.1`, `169.254.169.254` or an RFC1918 address is refused — at save
  time *and* at fetch time.
- A redirect chain landing on a private address is refused at the hop, not after the body is read.

**15.2:**
- Polling the same feed twice creates one draft per entry, not two.
- Feeds produce `DRAFT` posts; nothing publishes without a human.
- N deploys produce one poller per feed, not N.
- No feed markup renders as HTML anywhere.

**15.3:**
- No HTML parsing exists anywhere in the module.
- A snapshot cannot be taken for a brand with no connected account on that network, or for a
  brand in another company.
- Competitor reads decrement the same quota ledger as publishing.
- Snapshot rows contain aggregates only — verified against the schema, not against intent.
- Snapshots expire via `RetentionService`.

**15.4:**
- No vendor iframe is embedded in an authenticated page.
- `redirect_uri` cannot be influenced by any request parameter; a forged, expired or replayed
  `state` is refused; no redirect target outside our origin's allowlist is reachable.
- Stored tokens are masked from the plaintext and never returned to the client; disconnect
  revokes upstream and deletes the row.
- A `postMessage` from `evilcanva.com` is ignored.
- A non-publishing brand member is refused on both connect and disconnect.

**All:** `npm run typecheck`, `check:modules`, `check:tenancy`, `check:conformance`,
`test:backend` and `test:app` pass, with their **actual output quoted** (13.4).

**Tests ship with each phase:** a feed host resolving to a private address is refused; the same
feed polled twice yields one post; a feed entry with `<script>` in its title renders as text; a
worker killed mid-ingest is reclaimed without duplicating; a cross-company snapshot request is
refused; a snapshot consumes publish quota; a replayed `state` is refused; a `returnTo` parameter
is ignored; a `postMessage` from a lookalike origin is dropped.
