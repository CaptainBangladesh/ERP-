# 06 — Mailbox connection, templates & 1-on-1 send

**What to build:** A salesperson connects their Gmail or Outlook mailbox, writes a reusable email
template with dynamic tags, and sends a personalized 1-on-1 email to a lead directly from its
screen — delivered through the platform's existing `Mailer` seam (still `DevMailer` everywhere;
real provider delivery is a platform-wide decision, not this ticket's), with the send logged to
the lead's timeline automatically.

**Blocked by:** 02 (Custom lead fields — feeds the `custom.*` tag namespace).

**Status:** ready-for-agent

- [ ] `MailboxConnection` (`provider`, `emailAddress`, `displayName`, `status`) is created via a
      `@Public()` OAuth callback correlated by a short-lived state token; connection status
      (`connected`/`expired`/`revoked`) is visible, and disconnecting is one action.
- [ ] Sending is refused with a plain message when the mailbox connection is expired or revoked.
- [ ] `EmailTemplate` (`name`, `subject`, HTML `body`) can be created and saved for reuse.
- [ ] Dynamic tags resolve per recipient across three namespaces — `lead.*`, `custom.*` (by
      definition key), `sender.*` — with a per-tag fallback for a missing value; an unknown
      namespace or field is refused at template save time, not at send time.
- [ ] `MailMessage` gains an optional `html` body (`body` stays required); `DevMailer` records
      both.
- [ ] A template can be previewed rendered against a real lead before sending.
- [ ] Sending a 1-on-1 email from a lead's screen delivers through `Mailer` (verifiable via
      `DevMailer.sent` in tests) and automatically writes an `Activity` of type `email` against
      that lead.
- [ ] Tenant isolation holds for `MailboxConnection` and `EmailTemplate`.
