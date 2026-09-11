# Sending email from a hosted deployment

Mail works on a laptop and fails on the server, with a message like:

```
Could not reach mail.privateemail.com:465 from this server (Connection timeout).
```

Nothing is wrong with the mailbox, the password, or the code. **The hosting platform is
dropping the connection before it reaches the mail host.**

[Render blocks outbound traffic on ports 25, 465 and 587 for free web services][render-smtp],
rolled out across all regions in September 2025. Port 25 stays blocked on every plan. A
blocked port does not answer with a refusal — the packets are dropped and the connection hangs
until it times out, which is why the error says "timeout" rather than "denied", and why
retyping the password never helps.

Two things fix it. Either move the API to a plan that permits outbound SMTP, or send over
HTTPS on port 443, which nothing blocks. This document covers the second.

[render-smtp]: https://render.com/changelog/free-web-services-will-no-longer-allow-outbound-traffic-to-smtp-ports

## What the relay is

`api/smtp-relay.mjs` is a single serverless function. The API sends it the mailbox's own host,
username, password and message over HTTPS; it opens the SMTP connection from somewhere that
is allowed to, and reports back what the mail host said.

It holds no credentials of its own and no mailbox is configured on it. That is deliberate:
mail still leaves through the company's own account, from the company's own address, so
replies come back to the company — the relay only moves *where the socket is opened from*.

```
browser ──HTTPS──▶ API (Render)  ──HTTPS──▶ relay (Vercel) ──SMTP──▶ mail.privateemail.com
                   port 443 out            port 443 out            port 465 out
                   ✓ allowed               ✓ allowed               ✓ allowed there,
                                                                   ✗ blocked on Render
```

## Deploying it

1. **Create a Vercel project from this repository.** The relay is `api/smtp-relay.mjs`; the
   committed `vercel.json` already builds nothing else and gives the function a 30-second
   limit, which it needs — the default of 10 seconds kills it mid-SMTP and the API sees an
   opaque gateway error rather than the mail host's answer.

2. **Generate a shared secret**, used by both halves so nobody else can drive your relay:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

3. **Set it on the Vercel project** as `SMTP_RELAY_SECRET`. The relay refuses every request
   when this is unset — an open relay is worse than a broken one, because nothing about it
   looks broken.

4. **Set both variables on the Render service**, then redeploy:

   | Variable | Value |
   | --- | --- |
   | `SMTP_RELAY_URL` | `https://<your-project>.vercel.app/api/smtp-relay` — the **full path**, not just the origin |
   | `SMTP_RELAY_SECRET` | the same value as step 3, character for character |

5. **Check it before sending anything.** Open the relay URL in a browser: it answers

   ```json
   { "status": "ok", "service": "ERP SMTP Relay", "secretConfigured": true }
   ```

   `secretConfigured: false` means step 3 did not take.

## When it still does not work

`GET /api/crm/mailboxes/diagnostics`, signed in, asks the running API what it can actually do.
It sends nothing, returns no secrets, and answers the three questions that otherwise cost a
redeploy each:

- **`transport`** — `relay`, `resend` or `direct-smtp`. If this says `direct-smtp` after step 4,
  `SMTP_RELAY_URL` is not reaching the process; the service did not pick up the new variable.
- **`relay.ok`** — whether the relay is deployed, answering, and has its secret set. The
  `detail` says which of those failed.
- **`outboundSmtp.ok`** — whether this server can open a socket to the mail host at all. On
  Render's free tier this is `false`, and that is the finding, not a fault.
- **`storedPassword.ok`** — whether the saved password opens under the secret *this* server
  holds. See below.

### "The stored password could not be read on this server"

A different failure with a similar symptom. SMTP passwords are encrypted with `MAILBOX_SECRET`,
or `SESSION_SECRET` when that is unset. A mailbox configured on a laptop and read by a hosted
server **sharing the same database** cannot be decrypted unless both hold the same value —
which they usually do not, since the committed development secret is not the deployment's.

Either set the same `MAILBOX_SECRET` on every server sharing a database, or reconnect the
mailbox from the hosted application, which re-encrypts it under that server's key.

### The company mailbox, and who can use it

One SMTP mailbox is shared across the whole company: it is listed for every employee, not only
the person who added it, and any of them can select it and send from it. Adding it in
**Settings → Company mail** and connecting it in **CRM → Mailboxes** write the same
credentials, so it only has to be set up once.

## Other environment variables mail depends on

| Variable | Why it matters |
| --- | --- |
| `PUBLIC_API_URL` | The API's own public origin. Without it (and without `BACKEND_URL` or Render's `RENDER_EXTERNAL_URL`) open-tracking pixels are left out of outgoing mail, since a relative or `localhost` URL in somebody's inbox is never fetched. Sends still work; opens are never recorded. |
| `FRONTEND_URL` | Where links in invitations and password resets point. Unset, they fall back to the request headers or `localhost`. |
| `MAILBOX_SECRET` | Encrypts stored SMTP passwords. Must be identical on every server sharing a database. |
| `RESEND_API_KEY` | An alternative HTTPS transport, used only when no relay is configured. Resend refuses any sender on a domain not verified in its dashboard, so it suits a company sending from a domain it owns and cannot send from a plain Gmail address. |

## Reading replies back (inbound)

Everything above is about mail *leaving*. Replies come *back* to the company mailbox itself —
they land in Private Email / Gmail, not in the CRM. To show a reply on the lead it answers, the
server reads the mailbox over IMAP and records each new reply on the Timeline, beside the message
that was sent.

Nothing on the mail side changes: it reuses the same company mailbox, over IMAP (port 993)
instead of SMTP. Two things make it run.

### 1. A secret, so the poll is not open to the world

The poll is triggered over `POST /api/crm/mailboxes/poll`. That route is public — the scheduler
that drives it holds no session — so it is gated by a shared secret instead. Generate one:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Set it on the API as `INBOUND_POLL_SECRET`, and redeploy. With it unset the poll refuses every
request rather than running open.

### 2. A scheduler, because the server sleeps

Free hosting sleeps when idle, so a timer inside the server cannot be relied on. Point a free
external scheduler (e.g. [cron-job.org](https://cron-job.org)) at the poll, every 5–15 minutes:

- **Method**: `POST`
- **URL**: `https://<your-api>/api/crm/mailboxes/poll`
- **Header**: `x-poll-secret: <the value from step 1>`

Each call wakes the server and reads anything new. A reply then appears on its lead within one
polling interval — matched to the lead whose email address it came from. It is read-only: replies
are shown, not answered from inside the app.

The poll answers with counts only — `{ companiesPolled, messagesSeen, repliesRecorded, errors }`
— never an address or a body, so it is safe to read from a scheduler's logs.

### Does this host allow IMAP?

Sending is blocked on some hosts (the whole reason for the relay above); reading can be blocked
independently. `GET /api/crm/mailboxes/diagnostics`, signed in, now also answers `outboundImap` —
whether this server can open an IMAP socket to the mail host at all. If that is `false`, replies
cannot be read here and the API needs a host that permits outbound IMAP (993), the same way a
blocked SMTP port needs the relay.

| Variable | Why it matters |
| --- | --- |
| `INBOUND_POLL_SECRET` | Gates the public poll endpoint. Unset, the poll refuses every request. The scheduler sends the same value as `x-poll-secret`. |
