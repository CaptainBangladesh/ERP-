# 04 — OCR receipt capture: provider & integration shape

Type: research
Status: resolved

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

## Answer

**Confirmed greenfield:** read all of `backend/src/platform/` and grepped the whole repo for
upload/storage/image/OCR terms — no file upload, object storage, or image-processing
infrastructure exists anywhere today. Multer ships transitively via `@nestjs/platform-express`
but nothing invokes it. This shapes the self-hosting answer below.

**Recommend a third-party receipt-specific extraction API, not self-hosting.** AWS Textract
`AnalyzeExpense`, Azure AI Document Intelligence `prebuilt-receipt`, and Google Document AI's
Expense Parser converge on nearly identical pricing (~$0.01/page, AWS confirmed directly from its
own pricing page; Azure/Google corroborated across secondary sources since their pricing pages
render via JS) and all return per-field confidence scores. That convergence means the real choice
among the three is operational — whichever cloud this platform's object storage ends up on — not
capability or cost. Mindee is a credible cheaper alternative ($44–116/month, the only vendor
publishing a concrete field-accuracy figure — >95% — on its own product page); Veryfi's richer
field set isn't worth its ~$500/month floor for a first build. Self-hosting (Tesseract, docTR,
invoice2data) was ruled out on two independent grounds: this platform has none of the
upload/storage/image plumbing self-hosting would still require on top of the OCR engine itself,
and open-source OCR only yields raw text/layout — not receipt-field semantics — meaning a
hand-built extraction layer would still be needed even after standing up the infrastructure a
vendor API makes unnecessary.

**Draft record shape:** the original file (retained indefinitely — this is money leaving the
company, and "why does this say $84.20" must stay answerable from the receipt itself), the four
fields as typed values using this platform's existing exact-decimal money type (not the OCR
provider's raw currency string), a **confidence score per field** (not one per document — vendor
and date can be clean while the total is ambiguous, a common failure mode), a capture-status
marker so downstream code can treat OCR/email/mileage/manual capture uniformly, and the raw
provider response kept but not surfaced (cheap to keep, useful later for ticket 02's
categorization or line-item detail). A **mandatory human review/correction gate** sits between
extraction and the point the expense becomes real — no vendor surveyed publishes accuracy high
enough to justify posting unattended, so confidence scores make confirmation fast, not skippable.

**Confirms ticket 05's shared-extraction-layer recommendation:** the flow described here
(upload → extraction call → draft created → review/correction → confirmation) treats extraction
as a distinct, swappable step between capture and draft-creation — consistent with defining it as
its own small interface both the upload path and the email-gateway's inbound path can call.

Full findings, provider citations, and pricing detail:
`.scratch/expenses-accounting/research/04-ocr-capture.md` (merged from branch
`research/ocr-capture`).
