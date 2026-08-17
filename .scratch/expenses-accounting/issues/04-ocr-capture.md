# 04 — OCR receipt capture: provider & integration shape

Type: research

## Question

Investigate what it takes to extract date, vendor, total, and tax from a photographed or
uploaded receipt/PDF into a draft expense record.

- What third-party document-extraction services exist for this, what they cost, and what
  accuracy/latency looks like for receipts specifically, not general-purpose OCR.
- Whether a self-hosted/open-source option is realistic given this platform has no existing
  image-processing or file-upload infrastructure — check `backend/src/platform/` for anything
  already usable before assuming a greenfield build.
- What a "draft" expense record needs to hold — extracted fields, a confidence signal, the
  original image/file — before a human confirms or corrects it, and roughly where that review
  step would sit in the flow.

Report findings and a recommendation. This ticket does not pick the category or payee model —
just the capture mechanism.

## Comments

**2026-08-16 — ticket 05 (email-gateway) resolved first and found a coupling worth carrying
here.** It argues capture should split into three layers, only the first of which is
channel-specific: (1) capture — getting bytes + MIME type in, which differs by channel (an
authenticated multipart upload here vs. an unauthenticated verified webhook there); (2)
extraction — turning a file buffer into `{ vendor, date, total, tax, confidence }`, channel-
agnostic; (3) draft-record creation — same shape regardless of intake channel. Its recommendation
is that this ticket define extraction as its own small service/interface (mirroring how `Mailer`
is one abstract seam with one binding today) that both the upload path and ticket 05's inbound
path can call, rather than either ticket owning it outright. See
`.scratch/expenses-accounting/issues/05-email-gateway.md` for the full reasoning.
