# 05 — Email-gateway receipt capture: feasibility & shape

Research notes for `.scratch/expenses-accounting/issues/05-email-gateway.md`. Every claim below
is sourced to the provider's own documentation or to this repository's own source.

## 0. What this platform has today (checked in-repo, not assumed)

The only mail-related code in the backend is `backend/src/platform/mail/`:

- `mailer.ts` declares one abstract seam, `Mailer.send(message)`, taking a `to`/`subject`/`body`
  triple. The class comment says plainly: "the one way anything in this system sends email."
- `dev-mailer.ts` is the **only implementation that exists**, `DevMailer`. Its own comment states
  it is bound "everywhere, including production," because the foundation spec "defers email and
  notifications beyond what authentication requires." It logs each message and keeps it in an
  in-process array (`sent`) — there is no real outbound provider wired up at all yet, only
  invitations/password-reset composing messages that a test can read back from memory.
- `mail.module.ts` binds `Mailer` to `DevMailer` globally, with no alternate provider binding
  anywhere in the codebase (confirmed by grep across `backend/src` for `nodemailer`, `sendgrid`,
  `mailgun`, `postmark`, `ses`, `smtp`, `webhook`, `inbound` — zero hits outside this note).
- `backend/package.json` has no email SDK dependency at all (`@sendgrid/mail`, `mailgun.js`,
  `postmark`, `nodemailer`, `@aws-sdk/client-sesv2`, etc. are all absent).

So the premise in the ticket is confirmed directly against the source: **there is no inbound
seam, and the outbound seam is not even connected to a real provider yet** — it's a logging stub.
Building the email-gateway means this platform's first real relationship with a transactional
email vendor, in both directions at once, not just "add inbound to an existing outbound
integration."

There is also no file-upload/object-storage infrastructure under `backend/src/platform/` (no
`multer`, `s3`, `blob`, or `storage` module — grep confirms only unrelated hits for
`storage`-adjacent words in payroll/inventory code). Same gap ticket 04 already names for
photographed receipts.

## 1. Inbound-email options a NestJS backend can actually receive from

None of these require the backend to run its own SMTP server (which would mean holding a public
port 25 open, doing its own spam/virus/DKIM/SPF handling, and being reachable 24/7) — that is the
entire point of using a transactional-email vendor's *inbound* product instead: **the vendor
receives the SMTP conversation and hands your backend a single authenticated HTTPS POST**, which
is a completely ordinary NestJS controller.

### SendGrid Inbound Parse

- Requires an MX record on a **dedicated subdomain** (e.g. `parse.example.com`) pointed at
  `mx.sendgrid.net`, priority 10, with a trailing-period FQDN. Twilio/SendGrid's own docs
  explicitly recommend that hostname be one that "serves no purpose other than parsing your
  incoming email." [Setting up the Inbound Parse webhook](https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/setting-up-the-inbound-parse-webhook)
- Routing is by **subdomain only** — every address at that subdomain lands on the same webhook.
  Per-address distinction is up to your handler parsing the local-part it was sent to (SendGrid
  says the local-part "can be any single word or combination of words," reserving only `abuse`,
  `postmaster`, `unsubscribe`).
- POSTs `multipart/form-data` with `headers`, `from`, `to`, `subject`, `text`, `html`,
  `attachments` (+ per-attachment metadata), `dkim`, `SPF`, `spam_score`; a raw-MIME format is
  also offered.
- Message + attachments capped at **30 MB**; spam scoring only runs on messages ≤2.5 MB.

### Mailgun Routes

- Inbound routing is a list of **filter + action** rules evaluated per message. The filter
  supports Python-style regex over the recipient, including this exact pattern straight from
  Mailgun's own reference for **plus-addressing**:
  `match_recipient("^chris\+(.*?)@example.com$")`, and named captures forwarded into the
  webhook URL, e.g. `forward("http://mycallback.com/domains/\g<domain>/users/\g<user>")`.
  [Routes API reference](https://documentation.mailgun.com/docs/mailgun/api-reference/send/mailgun/routes)
- The `forward()` action POSTs the parsed message to your URL as
  `application/x-www-form-urlencoded` or `multipart/form-data` (once attachments are present),
  with `sender`, `recipient`, `subject`, `body-plain`, `body-html`, `message-headers`, an
  HMAC signature/timestamp/token for verification, and `attachment-<n>` fields.
  [Route actions](https://documentation.mailgun.com/docs/mailgun/user-manual/receive-forward-store/receive-http/)
- Max message size is documented at **25 MB** (enforced on the uncompressed body even if the
  POST is gzip-compressed). [Limits](https://documentation.mailgun.com/docs/mailgun/api-reference/send/mailgun/limits)

### Postmark Inbound

- Each **server / inbound message stream** gets one generated address
  (`hash@inbound.postmarkapp.com`); you can also point a custom inbound domain at it. Only one
  webhook URL per stream. [Inbound webhook](https://postmarkapp.com/developer/webhooks/inbound-webhook)
- Natively supports **plus-addressing**: a `MailboxHash` field is parsed out of addresses like
  `you+12345@yourdomain.com` and handed to you separately in the JSON payload — this is a
  first-party, named feature, not something you have to regex out of the `To` header yourself.
- POSTs a single JSON body: `From`/`FromFull`, `To`/`ToFull`, `Cc`, `Subject`, `TextBody`,
  `HtmlBody`, `MessageID`, `MailboxHash`, spam headers, and an `Attachments` array with
  base64 `Content`.
- Inbound size limit is **35 MB** total across all attachments.
  [Attachment and email size limits](https://postmarkapp.com/support/article/1056-what-are-the-attachment-and-email-size-limits)

### AWS SES email receiving

- Requires SES to be usable for receiving in your **region** (it's not available in every SES
  region — check the [endpoint list](https://docs.aws.amazon.com/general/latest/gr/ses.html#ses_inbound_endpoints))
  and the receiving domain/address to be a **verified identity**.
- Control is via **receipt rules** in a **rule set**, matched against the SMTP envelope
  recipient (`RCPT TO`), *not* the `To:`/`Cc:` header — AWS's own docs flag this explicitly
  because BCC'd mail has no visible header match. A rule's actions can: add a header, bounce,
  invoke a **Lambda function**, deliver to an **S3 bucket**, or publish to an **SNS topic**
  (with the full email body).
  [Email receiving concepts](https://docs.aws.amazon.com/ses/latest/dg/receiving-email-concepts.html)
- No polling needed from the NestJS side either: S3-delivered mail can trigger further
  processing via an S3 event → SNS/Lambda; SNS-delivered mail can be consumed directly by
  a subscribed HTTPS endpoint (which could be the NestJS backend itself, or a small Lambda
  that re-POSTs to it).
- Size ceiling is **40 MB via S3 delivery**, but only **150 KB via SNS notification** delivery —
  meaning any real attachment (a receipt PDF/photo) needs the S3 path, not the SNS-body path.
- SES does **not** offer per-recipient routing to different destinations out of the box the way
  Mailgun/Postmark's regex/plus-address model does — you build recipient-based branching
  yourself with multiple receipt rules or in the Lambda.

### Cloudflare Email Workers

- A Worker's `email()` handler receives a `ForwardableEmailMessage` (`from`, `to`, `rawSize`,
  a `headers` map, and a `raw` MIME stream) for mail routed to a Cloudflare-managed domain/zone.
  [Email Workers](https://developers.cloudflare.com/email-routing/email-workers/)
- Routing logic (per-address, catch-all, whatever) is just code in the Worker — e.g. branching
  on `message.to`/`message.from` — rather than a provider-side rule DSL.
- Cloudflare's own docs point to the third-party `postal-mime` library for MIME parsing
  (multipart, transfer-encoding, attachments) since the Worker only hands you the raw stream.
- This one is architecturally different from the other four: it's not "vendor POSTs to your
  NestJS server," it's "your parsing logic runs as a Cloudflare Worker," which would then need
  its own outbound call back into the NestJS backend's API. Only sensible if this platform's
  DNS is already on Cloudflare and a Worker deploy pipeline is acceptable overhead.

### The shape they all share

Every option above reduces to the same integration for a NestJS backend: **one `@Public()`
controller endpoint that accepts a POST** (form-encoded, multipart, or JSON depending on
vendor), verifies it came from the vendor (HMAC/signature check — Mailgun's `signature`/
`token`/`timestamp` triple, Postmark's Basic Auth option, SES's SNS message signature), and
hands the parsed fields + attachment bytes to application code. None of them require SMTP
infrastructure in this codebase. The differences that matter for a decision are: routing
granularity (regex/plus-address vs subdomain-only vs code-it-yourself), payload shape
(form fields vs single JSON blob), size ceiling (25–40 MB, plenty for receipts), and whether
attribution help (plus-addressing) is a named feature or something you must build.

## 2. Per-company addressing: how to attribute a session-less inbound email to a tenant

`docs/tenancy.md` is explicit that tenancy is normally established once per request by
`TenancyMiddleware`/`TenancyGuard` from a live session, and that there is exactly **one escape**:
`withoutCompanyScope(reason, work)`, whose sanctioned use today is identity's own sign-in —
"sign-in has to find a user by email across every company, because until it has found them
there is nothing to scope to." An inbound email handler is the same shape of problem: it arrives
with no session, so it needs the same category of escape, run once to resolve a company and then
`tenancy.runInCompany({ companyId, ... }, ...)` (also documented in tenancy.md, under "Outside a
request") to do the actual write. This isn't a new pattern for the codebase — it's the second
legitimate user of a pattern the platform already has exactly one of.

That still leaves the actual attribution question: **which signal picks the company?** Three
realistic options, in increasing order of how much new plumbing they need:

### Option A — attribute by verified sender address (no per-company alias needed)

This is what production expense tools actually do. Expensify's own help documentation: receipts
go to a single address, `receipts@expensify.com`, and "the sending email must be your primary
login or a verified contact method on your Expensify account" — i.e., attribution is by matching
the `From` address against emails already on file, not by which alias was dialed.
[Expensify: Deep Dive — where to email receipts](https://community.expensify.com/discussion/2714/deep-dive-where-to-email-receipts-to-get-them-into-your-expensify-expenses)
Ramp's support docs describe the identical model: receipts go to `receipts@ramp.com`, matched
against "your Ramp login email" or additional addresses you've explicitly authorized under
"Receipt forwarding" in account settings; a company-wide alias like `ramp-receipts@company.com`
has to be registered too, and Ramp warns it "can be added to only one Ramp account."
[Ramp: How to automatically forward receipts](https://support.ramp.com/hc/en-us/articles/360047979213-How-can-I-automatically-forward-Ramp-my-receipts-)

This maps unusually well onto this codebase specifically. `backend/prisma/schema.prisma`'s
`User` model has `email String @unique` — **globally unique, not per company** — and the schema
comment gives the exact reason: "sign-in is an email and a password with no company selector, so
a shared address would make the account ambiguous." That property (one email → exactly one user
→ exactly one company) is precisely what an inbound handler needs: look up the sender's address
with `withoutCompanyScope`, the same way sign-in does, get back one `User` with one `companyId`,
and `runInCompany` from there. No new per-company identifier has to be invented or exposed to
customers at all — a single literal address (`expenses@<this platform>.com`, matching the
ticket's own example) works for every company, and "which company" falls out of who's sending,
using a uniqueness guarantee the identity module already enforces for an unrelated reason.

Tradeoffs: `From` is trivially spoofable on its own (anyone can put any address in a `From:`
header), so this only holds up if the inbound provider's authentication verdicts are checked —
SES reports SPF/DKIM/DMARC results per message (`Authentication-Results` header / SNS
attributes), Mailgun's forward POST includes signature/token/timestamp for verifying the
*provider* sent it (not the original sender), and none of the providers cryptographically prove
who the *original* sender was — DMARC alignment is the closest available signal. It also breaks
for the cases Expensify and Ramp both had to special-case: mail forwarded through a chain where
the visible `From` becomes a forwarding service, a delegate/assistant forwarding on someone
else's behalf (Expensify built a whole "email receipts as a copilot" feature for this), or a
shared department inbox. And it does not satisfy "email an alias" literally — the ticket's
`expenses@company.com` example implies the customer's *own* domain, which Option A does not
provide (see the framing note below).

### Option B — a per-company token embedded in the address (plus-addressing or subdomain)

`expenses+<company-token>@<platform-domain>` (Mailgun's `match_recipient` regex and Postmark's
`MailboxHash` both parse this natively — see §1) or `<company-token>.expenses@<platform-domain>`
as a subdomain (SendGrid's model, or a dedicated SES receiving domain per tenant). The company
row would need a stable, unique, URL/email-safe identifier to mint this from — today's `Company`
model (`backend/prisma/schema.prisma`) has only `id` (a UUID, unwieldy in an email address) and
`name` (not unique, not address-safe), so this option requires a new column (a slug or opaque
random token) and the machinery to keep it unique and to show it to a company admin somewhere in
settings. Attribution is then a straight lookup — no spoofing concern, since the address itself
(not a header) picks the company, though the local-part is guessable if it's a slugified company
name rather than a random token.

Tradeoffs: needs new schema, a settings screen, and every employee has to be told or shown their
company's specific address rather than a single memorable literal. It also composes with Option A
rather than replacing it — nothing stops using a token *and* checking sender identity for
defense in depth once one exists.

### Option C — the customer's own domain, literally `expenses@company.com`

Closest to the ticket's example text, but the heaviest: it means every customer company
delegates mail for (at minimum) that one address on *their own domain* to the vendor, either by
an MX record on a subdomain they carve out (SendGrid's/AWS SES's model — see §1) or a forwarding
rule they set up in their own mail system pointing at the address from Option A or B. AWS SES
requires the receiving identity to be a **verified** domain/address under the receiving AWS
account, so the platform would need a "verify your domain" flow per customer (DNS TXT record,
polling for verification) before their `expenses@` could work — meaningful onboarding friction
per company, and out of the vendor's control if the customer's own mail admin never gets to it.
[SES: setting up email receiving](https://docs.aws.amazon.com/ses/latest/dg/receiving-email-setting-up.html)

### Realistic recommendation for this platform

Option A (sender-lookup against the identity module's already-unique `User.email`) is the
cheapest to build, needs zero new schema, and gives a single memorable address across every
company — closest in spirit to what the ticket describes, even though the literal domain is the
platform's rather than the customer's (exactly what Expensify and Ramp both ship). Treat Option B
as the natural extension once there's a concrete need it doesn't cover (a shared department
inbox, a delegate forwarding on someone's behalf) rather than building it up front. Option C is
disproportionate scope for this ticket — real per-customer domain delegation is an onboarding
feature in its own right, not a detail of the capture mechanism.

## 3. Shared OCR/extraction pipeline with ticket 04, or separate?

Reasoning from this repo's own module conventions (`docs/modules.md`) rather than a new source:
the platform's whole discipline is "a module's public surface is `index.ts`, everything else is
internal," and modules talk to each other either through that surface or through an event. That
same seam shape answers this cleanly by separating **three** concerns that are easy to conflate
into two:

1. **Capture** — channel-specific. Getting bytes and a MIME type into the system at all: a
   multipart upload endpoint for ticket 04's photographed/uploaded receipts, versus this
   ticket's inbound-webhook controller plus sender/company attribution (§2) plus attachment
   extraction from whichever provider payload shape (§1) arrived. These two intake paths share
   almost nothing mechanically — one is an authenticated multipart POST from the app's own
   frontend inside a session, the other is an unauthenticated webhook from a third party with no
   session at all, verified by a signature instead. They belong in different code.
2. **Extraction** — channel-agnostic. Once *either* path has a file buffer + MIME type in hand,
   turning it into `{ vendor, date, total, tax, confidence }` is the same operation regardless of
   whether the bytes came from a phone camera, a file picker, or an email attachment. This is
   exactly the shape of a reusable service the OCR ticket should define once and both capture
   paths call — same signature, same provider, same confidence semantics, same downstream
   "draft expense" shape ticket 04 is scoping.
3. **Draft-record creation** — shared. Whatever capture path and whatever extraction result,
   the outcome is the same kind of row: a draft expense with extracted fields, a confidence
   signal, and a link back to the original file, awaiting the human-confirms-or-corrects step
   ticket 04 is also scoping. No reason for this to differ by intake channel either.

So: **genuinely separate at the capture layer, shared at the extraction and draft-creation
layers.** Ticket 05's distinctive work is entirely capture-layer — the inbound webhook, signature
verification, and the tenancy-attribution problem in §2, none of which ticket 04 needs to solve
or touch. But it should not re-implement or fork extraction: it should end at "I have a file and
I know which company it belongs to," hand off to whatever service ticket 04 lands on, and pick up
again at "here is a draft expense" to route into the same review/confirm flow every other capture
channel uses. Concretely, that argues for the extraction step living behind its own small
interface (mirroring how `Mailer` is one abstract seam with one binding today) that any capture
path — upload controller or inbound-email controller — can call, rather than either ticket owning
it outright.

One coupling worth flagging for whoever sequences the two tickets: ticket 05's inbound handler
needs a *company* before it can call extraction (extraction presumably runs inside
`runInCompany`, like everything else that writes a company-owned row per `docs/tenancy.md`), so
the attribution step in §2 has to complete first in the inbound path specifically — that ordering
constraint doesn't exist on the upload path, where the session already carries the company before
any file is touched.
