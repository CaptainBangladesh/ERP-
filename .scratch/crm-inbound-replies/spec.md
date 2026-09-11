# Inbound reply capture (see replies in the CRM)

Status: Design (Opus pass)

## Problem

Outbound 1:1 email works end to end: a send is recorded as a `LeadEmailSend`, shown on the
lead Timeline as an `email` Activity ("Email sent: …"), and opens are tracked. But when the
recipient **replies**, the reply goes back to the company mailbox itself (that is the design —
see `lead-outreach.service.ts:98`), so it lands in Private Email / Gmail and the CRM never sees
it. The user wants replies visible **inside the system**, on the lead they belong to.

## Goal (v1)

A reply from a lead appears on that lead's Timeline, directly alongside the message that was
sent — read-only. Nothing is deleted from the mailbox; the human's own inbox is untouched.

## Non-goals (v1, deliberately deferred)

- Replying from inside the app (this is *visibility*, not a two-way inbox).
- Threading by `Message-ID`/`References` — we match by sender address (we do not store outgoing
  Message-IDs today, and sender-match covers the ordinary case).
- Attachments, creating leads from unknown senders, and real-time push.

## Approach: IMAP polling, triggered externally

The backend reads the company mailbox over IMAP and records new replies. Because the backend
runs on Render's **free tier — which sleeps when idle** — nothing inside the process can be a
reliable timer. Instead an **external scheduler** (cron-job.org or a GitHub Actions cron) does
one authenticated `POST` every few minutes; that request both wakes the service and drives one
poll cycle. This is the same shape as the SMTP relay: the hard part lives off Render, the app
stays simple.

```
external cron ──HTTPS POST /api/crm/mailboxes/poll (x-poll-secret)──▶ Render backend
                                                                        │ IMAP 993
                                                                        ▼
                                                              mail.privateemail.com
```

## Design decisions (the parts that need care)

### Credentials — reuse, don't re-ask
Private Email uses the **same login for IMAP as for SMTP**. The company mailbox already stores
host / username / encrypted password (via the platform `CompanyDirectory` seam CRM already
reads). IMAP host = same host, port **993**, TLS. Password decrypts with the same
`MAILBOX_SECRET`/`SESSION_SECRET`. No new secret to store, no new screen.

### Trigger endpoint — public route, fail-closed secret
`POST /api/crm/mailboxes/poll` is `@Public()` (an external cron holds no session) and refuses
every request unless `x-poll-secret` matches `INBOUND_POLL_SECRET` (falling back to
`SESSION_SECRET`). **Unset ⇒ refuse**, never run open — an unauthenticated poller is a way to
make the server dial arbitrary mailboxes on a schedule. Constant-time compare, like the relay.
It returns a counts-only summary (`companiesPolled`, `messagesSeen`, `repliesRecorded`,
`errors[]`) — no addresses, no bodies, no secrets.

### Tenancy — the `trackOpen` pattern
The poll runs outside any company, so enumeration happens under `withoutCompanyScope`, and each
company's work runs inside `runInCompany({ companyId, grants: 'all' })` — exactly what
`trackOpen` already does for the unauthenticated open-pixel. No hand-written `companyId`
filters; writes go through `companyApplied<…>()`.

### Matching — by sender, conservatively
Normalise the reply's `From` address and find a lead in that company whose `email` matches
(case-insensitive). No match ⇒ skip and count it (v1 does **not** invent leads from strangers).
Multiple matches ⇒ most recently active lead.

### Untrusted content — store text, never render HTML
A reply body is attacker-controlled. We convert it to plain text with the existing
`htmlToPlainText`, store a truncated preview in the Activity `notes` (mirroring "Email sent:"),
and **never** persist or render raw HTML. That closes the stored-XSS path before it opens; the
Timeline already renders `notes` as text.

### Idempotency — a unique Message-ID
Each recorded reply writes a `LeadEmailReceipt` with `@@unique([companyId, messageId])`. A
re-run (crons overlap, retries happen) hits the constraint and skips. A per-company
`InboundMailCursor.lastSeenUid` advances so each poll fetches only UIDs above the last, capped
at 100 messages/run so a large mailbox can't stall a request past Render's timeout.

### The one real unknown — does Render allow IMAP (993)?
Render documents blocking **SMTP** ports only (25/465/587); 993 is not mentioned and their
block is scoped to SMTP, so IMAP *should* work. But it isn't proven, and a blocked port hangs
rather than refuses. So: the mail diagnostics endpoint gains an `outboundImap` probe (a bare
socket test, like `outboundSmtp`), and the **first deploy verifies it**. If 993 is blocked, the
fallback is an IMAP-fetch serverless function on Vercel returning parsed messages as JSON over
443 — the mirror of the SMTP relay — filed as a follow-up, not built now.

## Data model (both company-owned; classified in `company-owned.ts`)

```prisma
model LeadEmailReceipt {          // one recorded inbound reply (also the dedup key)
  id, companyId, leadId,
  activityId?, messageId,          // @@unique([companyId, messageId])
  fromAddress, subject, receivedAt, createdAt
}
model InboundMailCursor {          // per-company IMAP position
  id, companyId (unique), lastSeenUid, lastPolledAt
}
```

## What shows in the UI

Nothing new to build for v1: a reply becomes an `email` Activity ("Reply received: …") on the
lead Timeline, next to the send. A follow-up can style inbound vs outbound distinctly and add a
"you have a reply" `Notification` to the lead's owner (included here — it reuses the exact
`Notification` path `trackOpen` uses).

## Setup the user does (documented in docs/deployment/hosted-email.md)

1. Set `INBOUND_POLL_SECRET` on Render (or rely on `SESSION_SECRET`).
2. Point a free scheduler (cron-job.org) at `POST https://erp-c5im.onrender.com/api/crm/mailboxes/poll`
   every 5–15 min with header `x-poll-secret: <the secret>`.
3. After first run, check `/api/crm/mailboxes/diagnostics` → `outboundImap.ok`.

## Test plan

Unit/integration (no real IMAP): the IMAP client is a seam with a recording fake, like
`RecordingMailboxSender`. Prove: secret gating (401 unset/mismatch), sender-match creates one
Activity + one receipt + one notification, an unmatched sender is skipped, a duplicate
Message-ID is a no-op, tenancy never crosses companies, HTML body is stored as text.
```
