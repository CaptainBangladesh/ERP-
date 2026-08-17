# 05 — Email-gateway receipt capture: feasibility & shape

Type: research

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
