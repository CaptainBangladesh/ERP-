# 01 — IMAP reply ingestion onto the lead Timeline

Status: Todo
Model: (set by classify-ticket.sh)

## What

An authenticated, externally-triggered poll that reads the company mailbox over IMAP and
records each new reply as an `email` Activity on the matching lead, once.

## Public / unauthenticated surface

`POST /api/crm/mailboxes/poll` is `@Public()` — an external cron holds no session. It carries
**no body from a user**; it authenticates with an `x-poll-secret` header compared in constant
time against `INBOUND_POLL_SECRET` (fallback `SESSION_SECRET`). When neither is set the route
**refuses every request** rather than running open. Returns counts only — no addresses, bodies,
or secrets.

## Credentials & secrets

Reuses the company mailbox's stored, encrypted SMTP password for the IMAP login (Private Email
shares one credential across SMTP/IMAP). Decrypts with `MAILBOX_SECRET`/`SESSION_SECRET` via the
existing `decryptSmtpPassword`. No new secret is stored.

## PII / untrusted content

Reply bodies are attacker-controlled PII. Convert to plain text (`htmlToPlainText`), store a
truncated preview only, never persist or render raw HTML. Sender addresses are matched, not
trusted to name a person.

## Idempotency / hard reasoning

`LeadEmailReceipt` has `@@unique([companyId, messageId])`; recording is idempotent under
overlapping cron runs and retries. A per-company `InboundMailCursor.lastSeenUid` bounds each
fetch (UID-greater-than, capped 100/run) so re-polls don't re-read the mailbox and a large
mailbox can't exceed the request deadline.

## Tenancy

Enumerate mailboxes under `withoutCompanyScope`; do each company's work inside
`runInCompany({ companyId, grants: 'all' })` — the `trackOpen` pattern. No hand-written
`companyId`; writes via `companyApplied<…>()`. New models classified in `company-owned.ts`.

## Migration

Adds `lead_email_receipts` and `inbound_mail_cursors`.

## The IMAP client is a seam

`InboundMailReader` (abstract) with a live `imapflow` implementation and a `RecordingInboundMailReader`
fake for tests, mirroring `MailboxSender` / `RecordingMailboxSender`. Adds deps `imapflow`,
`mailparser`.

## Acceptance

- Unset/mismatched secret ⇒ 401, nothing read.
- A reply whose `From` matches a lead ⇒ exactly one `email` Activity ("Reply received: …"),
  one `LeadEmailReceipt`, one `Notification` to the lead's owner.
- Unmatched sender ⇒ skipped and counted, no writes.
- Same `Message-ID` twice ⇒ second run is a no-op.
- A company never sees another company's replies.
- An HTML body is stored as text.

## Open question resolved in spec

Render/993 reachability is verified post-deploy via a new `outboundImap` diagnostics probe
(ticket 02); if blocked, an IMAP-fetch relay is a follow-up. Direct IMAP is v1.
