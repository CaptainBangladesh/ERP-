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
