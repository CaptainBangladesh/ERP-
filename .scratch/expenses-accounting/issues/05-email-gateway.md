# 05 — Email-gateway receipt capture: feasibility & shape

Type: research
Status: resolved

## Question

Investigate what it would take for an employee to forward a receipt email to a company alias
(e.g. `expenses@company.com`) and have it become a draft expense record.

- What inbound-email options exist that a NestJS backend could actually receive from — this
  platform currently only has an *outbound* email seam (foundation ticket 07, for invitations
  and password reset); nothing receives mail today.
- Per-company addressing: tenancy is established from a session on every other path into this
  system, and an inbound email has none — how does an email get attributed to the right company?
- Whether this reuses the OCR pipeline from ticket 04 (the email's attachment still needs
  extraction) or is a genuinely separate concern worth keeping apart.

## Answer

**Confirmed in-repo:** there is no inbound seam, and the outbound seam isn't even wired to a real
provider yet — `DevMailer` (a logging stub) is bound everywhere, including production, per its
own doc comment. Building this ticket is the platform's first real transactional-email vendor
relationship in either direction, not an addition to an existing one.

**Inbound options surveyed against their own docs** — SendGrid Inbound Parse, Mailgun Routes,
Postmark Inbound, AWS SES receiving, Cloudflare Email Workers. Four of five reduce to the same
shape: the vendor receives the SMTP conversation and POSTs one authenticated HTTPS request to an
ordinary NestJS controller (form-encoded, multipart, or JSON depending on vendor; 25–40 MB size
ceilings, plenty for receipts). Cloudflare Email Workers is architecturally different — your
parsing logic runs as a Worker, not on this backend — and only makes sense if DNS is already on
Cloudflare.

**Per-company attribution — recommend Option A, sender-lookup, not a per-company alias.** Attribute
the inbound email by looking up the verified `From` address against `User.email` (already
globally unique in this schema, specifically so sign-in can resolve a company with no selector),
using the same `withoutCompanyScope` → `runInCompany` pattern sign-in already uses as tenancy's
one sanctioned escape hatch. This is exactly what Expensify and Ramp ship in production (their
own help docs, cited in the research file) — one memorable address for every customer, matched by
sender identity, no per-company token or schema change needed. A per-company alias/token (Option
B) is a reasonable later extension once a concrete need appears (shared department inbox, a
delegate forwarding on someone else's behalf) — not something to build up front. A literal
customer-owned domain (Option C, `expenses@company.com` on *their* DNS) is disproportionate scope
for this ticket — that's a per-customer domain-verification onboarding feature in its own right.

**Capture, extraction, and draft-creation are three concerns, not two — split cleanly along this
platform's own module-boundary discipline (public surface / everything else):**

1. **Capture is channel-specific and stays separate from ticket 04.** An authenticated multipart
   upload inside a session (ticket 04) and an unauthenticated webhook verified by signature with
   no session at all (this ticket) share almost no mechanics.
2. **Extraction is channel-agnostic and shared with ticket 04.** Once either path has a file
   buffer + MIME type, turning it into `{ vendor, date, total, tax, confidence }` should be one
   service both capture paths call — whichever provider/shape ticket 04 lands on.
3. **Draft-record creation is shared too** — same kind of row regardless of intake channel.

One sequencing note for whoever builds this: the inbound path must resolve a company (via sender
lookup) *before* it can call extraction, since extraction runs inside `runInCompany` like every
other company-owned write. The upload path doesn't have that ordering constraint — its session
already carries a company before any file is touched.

Full findings, provider citations, and the Expensify/Ramp sourcing:
`.scratch/expenses-accounting/research/05-email-gateway.md` (merged from branch
`research/email-gateway`).
