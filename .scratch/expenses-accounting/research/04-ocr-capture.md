# 04 — OCR receipt capture: provider & integration shape

Type: research findings
Ticket: `.scratch/expenses-accounting/issues/04-ocr-capture.md`

## Scope

What it takes to turn a photographed or uploaded receipt/PDF into a **draft** expense record
holding date, vendor, total, and tax, for a human to confirm or correct. Not in scope: category
assignment (ticket 02) or payee/payment model (ticket 01) — the extracted fields land on a draft
regardless of how those tickets resolve.

## 0. Confirmed: no existing infrastructure to build on

Before assuming a greenfield build, I read `backend/src/platform/` in full (every file under
`auth/`, `authorization/`, `conformance/`, `events/`, `generator/`, `list/`, `mail/`, `modules/`,
`navigation/`, `tenancy/`, `validation/` — the complete platform surface per `README.md`'s own
description of that directory). None of it touches files, images, or binary payloads. There is
no `platform/files`, `platform/storage`, or `platform/uploads` area.

`backend/package.json` confirms this at the dependency level: no `multer` (NestJS's official file
upload package — it ships bundled inside `@nestjs/platform-express`, which *is* a dependency, but
nothing in the codebase invokes `FileInterceptor`/`@UploadedFile()`), no S3 or blob-storage
client, no image-processing library (`sharp` etc.), no OCR package (`tesseract.js`, etc.). A
repo-wide grep for `multer|FileInterceptor|upload|s3|sharp|tesseract|ocr` (case-insensitive)
across `backend/` turns up only two incidental matches — the word "sharp**er**" in prose comments
in `inventory/index.ts` and `tenancy/company-owned.ts`. `application/package.json` and the root
and `packages/` manifests are equally clean.

**Conclusion:** this is a genuine greenfield capability. Multipart file upload
(`@nestjs/platform-express`'s Multer integration, already installed transitively), object storage,
and the OCR/extraction call itself all need to be built or wired up from nothing. This shapes the
"self-hosted realistic?" answer in §2 below.

## 1. Third-party receipt/document-extraction services

All five below expose a receipt- or expense-specific endpoint (structured fields, not just raw
text) — general-purpose OCR (plain Tesseract, Google Vision `TEXT_DETECTION`, etc.) is excluded
per the ticket's own instruction, and is covered separately in §2 as a DIY building block.

### AWS Textract — `AnalyzeExpense`

- **What it returns:** `SummaryFields` (vendor, receipt date, total, etc., each with a `Type`,
  optional `LabelDetection`, and `ValueDetection` — every detected value carries a `Confidence`
  score, e.g. `VENDOR_NAME` at 87.9% in AWS's own worked example) plus `LineItemGroups` for
  per-item detail (`ITEM`, `QUANTITY`, `PRICE` normalized; anything else on the row falls back to
  raw `EXPENSE_ROW` text).
  Source: [AWS Textract docs — Invoice and Receipt Response Objects](https://docs.aws.amazon.com/textract/latest/dg/expensedocuments.html).
- **Pricing:** $0.01/page for the first 1M pages/month, $0.008/page above that (US West Oregon
  rate; AWS notes pricing varies by region). Free tier: 100 pages/month for new AWS customers,
  for their first three months.
  Source: [AWS Textract Pricing](https://aws.amazon.com/textract/pricing/) (official pricing page, fetched directly).
- **Latency/throughput:** the pricing/docs pages don't publish a latency SLA; third-party
  benchmarking reports ~2–4 seconds per page for the synchronous API, and AWS's own service-quota
  docs cap synchronous `AnalyzeExpense` at 5 transactions/second in US East/US West, 1 TPS in some
  other regions (quota, not a latency number — treat the per-page timing as indicative, not
  contractual).
  Source: [AWS Textract service quotas](https://aws.amazon.com/about-aws/whats-new/2020/10/amazon-textract-announces-improvements-to-reduce-average-api-processing-times) and general benchmarking (secondary; flagged as such).

### Azure AI Document Intelligence — `prebuilt-receipt` model

- **What it returns:** merchant name/phone/address, transaction date/time, subtotal, `TotalTax`,
  tip, total, and itemized line items (description, quantity, unit price, line total). The
  current v4.0 GA model adds `ReceiptType`, `TaxDetails.NetAmount/Description/Rate`,
  `CountryRegion`, and VAT-table extraction for hotel receipts.
  Source: [Receipt data extraction — Document Intelligence docs](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/receipt).
  Per-field confidence is part of the API shape (`DocumentField.confidence`), confirmed against
  Microsoft's own SDK/REST reference examples (e.g. `vendorNameField.Confidence`), though it
  isn't called out on the receipt-model conceptual page itself.
  Source: [Document Intelligence SDK/REST usage docs](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/how-to-guides/use-sdk-rest-api).
- **Input limits:** PDF/JPEG/PNG/BMP/TIFF/HEIF, up to 500 MB (paid tier) or 4 MB (free tier), up
  to 2,000 pages per PDF/TIFF (free tier only processes the first 2 pages). Minimum readable text
  height ~12px at 1024×768 (~8pt at 150dpi) — relevant for phone-camera photos of receipts, which
  frequently fall below this on small thermal-print text.
  Source: [Receipt data extraction docs, "Input requirements"](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/receipt).
- **Pricing:** the official pricing page ([Azure AI Document Intelligence pricing](https://azure.microsoft.com/en-us/pricing/details/document-intelligence/))
  renders its dollar figures via client-side JS that this research's fetch tooling could not
  execute, so the table came back as blanks on direct fetch. The free tier is stated in plain
  text on that same page: **500 pages/month** on the F0 tier. The paid per-page rate is
  consistently reported at **$10/1,000 pages** (i.e. $0.01/page) across multiple independent
  secondary sources cross-checked against each other — matching AWS's rate almost exactly — but
  I could not pull that number from Microsoft's own rendered table, so treat it as corroborated
  rather than primary-confirmed and re-verify in the Azure pricing calculator before committing
  budget.

### Google Cloud Document AI — Expense Parser

- **What it returns:** expense date, supplier name, total amount, currency, tax amount, net
  amount, payment type, and line items (description, amount, quantity). Status: **General
  Availability**. Supports English, German, Spanish, French, Japanese, Dutch.
  Source: [Document AI processors list](https://docs.cloud.google.com/document-ai/docs/processors-list).
- **Confidence:** every extracted entity carries `entity.confidence`, a 0–1 float, on the shared
  `Document` object all Document AI processors return.
  Source: [Document AI — Evaluate performance / custom extractor docs](https://docs.cloud.google.com/document-ai/docs/evaluate).
- **Pricing:** billed in 10-page blocks per document — a 1–10 page document costs $0.10
  regardless of whether it's 1 page or 10 (rounds up), i.e. $0.01/page equivalent, same rate as
  AWS and the reported Azure rate. Same caveat as Azure: [Google's own pricing page](https://cloud.google.com/document-ai/pricing)
  renders the table via JS and returned blank on direct fetch; the $0.10/10-pages figure is
  corroborated across independent sources rather than pulled verbatim from Google's table.

### Veryfi — Receipts OCR API

- **What it returns:** a much broader field set than the cloud generalists — 150+ fields
  including vendor name/address/logo/phone/VAT number/category, multiple date types, full line
  items with SKU/UPC/discount, subtotal/tax/tip/total/currency/exchange rate, barcode data, and
  fraud signals (tampering/duplicate/AI-generation detection).
  Source: [Veryfi Receipts OCR API product page](https://www.veryfi.com/receipt-ocr-api/).
- **Confidence:** the product page confirms confidence scoring is available ("assess the data
  extraction prediction and make informed decisions on how to handle it") but doesn't publish a
  numeric accuracy figure on that page itself, only marketing language ("enterprise-grade
  accuracy," "99%+" claimed elsewhere on Veryfi's site without a cited methodology).
- **Pricing:** Veryfi's own pricing/product pages do not expose numeric plan pricing to
  unauthenticated fetches (gated behind a "start free trial" / contact-sales flow — 14-day free
  trial, no card required). Independent reporting puts the entry paid tier around a **$500/month
  minimum**, with per-document rates near **$0.08/receipt** and **$0.16/invoice** — this is
  secondary-sourced (not pulled from Veryfi's own rate card) and should be re-verified directly
  with Veryfi before budgeting; it is meaningfully more expensive per page than the cloud
  generalists at any volume below the minimum.

### Mindee — Receipt OCR API

- **What it returns:** receipt number/date, total amount, currency, merchant name/address/phone,
  tax total and rate, line items, payment type, tip. Confirmed against the official product page.
  Source: [Mindee Receipt OCR API](https://www.mindee.com/product/receipt-ocr-api).
- **Accuracy:** Mindee states, on its own product page, "**accuracy of our receipt API is
  generally above 95% for most fields**," computed weekly across datasets spanning 50+ countries
  and varied receipt quality/format/language. This is the only vendor in this list that publishes
  a specific accuracy figure on its own product page rather than only in marketing copy — worth
  noting as the strongest primary-source accuracy claim found.
- **Pricing (official pricing page, fetched directly):** credit-based, 1 credit = 1 page
  regardless of document type. Starter: **$44/month** billed annually ($529/yr), selectable
  6,000–300,000 credits/month, ~$0.044/extra credit, 1 seat, community support. Pro:
  **$116/month** billed annually ($1,393/yr), same credit range, unlimited seats, live chat
  support, data-residency option. Enterprise: custom, 500,000+ credits/year minimum, dedicated
  support. 14-day free trial.
  Source: [Mindee Pricing](https://www.mindee.com/pricing).

### Summary table

| Provider | Receipt-specific? | Confidence per field | Free tier | Rough cost/page |
| --- | --- | --- | --- | --- |
| AWS Textract `AnalyzeExpense` | Yes | Yes (0–100) | 100 pages/mo × 3 mo | $0.01 (→$0.008 at 1M+) |
| Azure Doc Intelligence `prebuilt-receipt` | Yes | Yes (0–1) | 500 pages/mo | ~$0.01 (corroborated, not primary-confirmed) |
| Google Document AI Expense Parser | Yes | Yes (0–1) | none published/found | ~$0.01 (corroborated, not primary-confirmed) |
| Veryfi Receipts API | Yes, receipt-native | Yes | 14-day trial | ~$0.08/receipt (secondary) + $500/mo minimum |
| Mindee Receipt OCR API | Yes, receipt-native | Not confirmed on product page | 14-day trial | ~$0.044–0.073/page-equiv (from plan math) |

**Reading this table:** the three general-cloud platforms (AWS/Azure/Google) converge on almost
identical per-page pricing (~$0.01) and all return calibrated per-field confidence — that
convergence is itself informative, since it means the choice between them is really about which
cloud the rest of the platform's infrastructure will live in, not about cost or accuracy. The two
receipt-native specialists (Veryfi, Mindee) charge a premium (Veryfi noticeably more, gated by a
$500/month floor; Mindee's floor is far lower at $44–116/month) in exchange for a richer field set
tuned specifically to receipts/invoices (SKU-level line items, fraud detection, more locales) and,
in Mindee's case, a directly-published accuracy figure the generalists don't offer on their own
marketing pages. For date/vendor/total/tax specifically — the four fields this ticket cares
about — all five options extract all four natively; none is a blocker on that count.

## 2. Is a self-hosted/open-source alternative realistic right now?

**No, not as a first build.** Two independent reasons converge:

**a) The platform has zero of the supporting infrastructure.** §0 confirmed there is no file
upload path, no object storage, and no image pipeline anywhere in this codebase. A self-hosted
OCR pipeline needs all of that *plus* the OCR/extraction layer itself — a third-party API needs
only the first two (upload + storage), because the vendor's endpoint replaces the extraction
layer entirely. Self-hosting is strictly more infrastructure to stand up, not less, for a
platform starting from nothing.

**b) Open-source OCR tooling gives text and layout, not receipt fields.** I checked the two most
relevant projects directly:

- **Tesseract** (Apache 2.0, via [github.com/tesseract-ocr/tesseract](https://github.com/tesseract-ocr/tesseract)):
  a CPU-only OCR engine (LSTM-based recognition, Leptonica dependency for image processing) that
  outputs plain text / hOCR / TSV / PDF — character and word recognition only. It has no concept
  of "this string is the vendor name" or "this string is the total" — that semantic layer would
  need to be built entirely by hand (regex/heuristics over positional text, or fine-tuning a
  separate model on top). Independent benchmarking (not Tesseract's own docs, flagged as
  secondary) puts general OCR accuracy around 83% character-level on receipt-quality images,
  meaningfully behind the commercial APIs' calibrated field-level accuracy claims.
- **docTR** (Apache 2.0, via [github.com/mindee/doctr](https://github.com/mindee/doctr) — note:
  built by Mindee, the same company selling the commercial Receipt API above): deep-learning
  text detection + recognition with layout hierarchy (Page/Block/Line/Word) and optional GPU
  acceleration. Its own README is explicit that it does **not** do field extraction out of the
  box — the "Key Information Extraction" predictor it ships requires custom training per field
  type. Same gap as Tesseract, just with better raw text/layout quality as a starting point.
- **invoice2data** (MIT, [github.com/invoice-x/invoice2data](https://github.com/invoice-x/invoice2data)):
  the closest thing to a turnkey open-source option — it layers a YAML/JSON regex-template system
  on top of a pluggable text-extraction backend (pdfium/pdftotext/pdfminer, or OCR via Tesseract,
  docTR, PaddleOCR, or even a cloud Vision API as a backend). It is fundamentally
  **template-per-vendor**: each new receipt layout needs its own template until enough coverage
  exists, which is workable for a stable set of recurring vendor invoices but a poor fit for
  photographed receipts from an open set of merchants (the exact use case this ticket describes).
  It ships an optional LLM fallback for cases the templates miss, which reintroduces a
  third-party API dependency anyway.

**Verdict:** self-hosting would mean building file upload, storage, an image pipeline, an OCR
engine deployment (Tesseract is CPU-fine; docTR benefits from a GPU this platform has no
provisioning story for), *and* a field-extraction layer with no off-the-shelf receipt semantics —
on a platform that currently has none of the first three. That is a multi-module effort to match
what a single API call from any of the five vendors above does today, for roughly a cent a page.
Revisit self-hosting only if volume grows large enough that per-page vendor cost dominates (the
crossover is far above what a mid-market ERP's expense volume would hit) or if a customer's data
residency/compliance requirement rules out sending receipt images to a third party — neither
condition holds today.

## 3. What a draft expense record needs, and where review sits in the flow

### What the draft must hold

Independent of which vendor is chosen, every one of them returns the same shape of information,
which maps onto what a draft record needs:

1. **The original file itself**, retained and linked to the draft — every vendor above treats the
   uploaded image/PDF as the source of truth the extraction is *derived from*, not a disposable
   intermediate. The human reviewer needs to see the actual receipt beside the extracted fields to
   correct them with confidence, and the record needs it for audit purposes (this is money leaving
   the company; "why does this expense say $84.20" should be answerable by looking at the receipt,
   indefinitely, not just at capture time).
2. **The four extracted fields as structured, typed values** — date, vendor (free text at this
   stage; ticket 01 decides whether/how it resolves to a Party), total, tax — each stored
   separately from any raw OCR text blob, so the draft is directly editable field-by-field rather
   than requiring re-parsing. Per this platform's own money rule (`CLAUDE.md`/`README.md`: "money
   and quantities are never a `number`"), total and tax land as the platform's exact-decimal money
   type with currency, not a float — meaning the extraction step's raw currency string has to be
   validated/normalized into that type before it can occupy those fields, which is itself part of
   the capture mechanism's job, not deferred to review.
3. **A confidence signal per field, not just one for the document.** Every commercial API surveyed
   above returns confidence at the *field* level (AWS: 0–100 per `ValueDetection`; Azure/Google:
   0–1 per field/entity; Mindee: claims >95% average but doesn't expose it in the public product
   page — confirm in their API reference before relying on it). A single whole-document score
   would hide the common case where vendor and date are both read cleanly but the total is
   ambiguous (e.g. total vs. subtotal confusion, a common receipt-parsing failure mode) — the
   review UI needs to flag *that specific field*, not force a human to re-check all four every
   time. Store the per-field confidence alongside each field's value.
4. **A capture provenance/status marker** distinguishing "machine-extracted, unconfirmed,"
   "machine-extracted, human-corrected," and "manually entered" (the ticket's map already lists
   manual entry, email, and mileage as sibling capture paths alongside OCR — the draft's status
   field is what lets Accounting and reporting treat all capture paths uniformly downstream, per
   this repo's existing pattern of the emitting module carrying full context rather than
   Accounting having to know how a value arrived).
5. **The raw provider response, kept but not surfaced** — not because the draft needs it, but
   because every vendor's response includes fields beyond the four this ticket scopes (line
   items, merchant address, receipt number) that categorization (ticket 02) or a future
   line-item-level feature may want without a second extraction call. Cheap to keep, expensive to
   have discarded.

### Where review sits in the flow

A capture-to-confirm flow, in the shape the surveyed vendors all assume and this platform's
"empty states are acceptance criteria" / "no seed data" discipline implies for a first version:

1. **Upload** — user photographs or uploads a file from the Expenses screen. This is the piece of
   plain infrastructure (§0) that doesn't exist yet: a multipart endpoint
   (`FileInterceptor`/`@UploadedFile()` from `@nestjs/platform-express`, already a transitive
   dependency) plus a storage destination — local disk is fine for development, but production
   needs an object store (S3-compatible; none is currently provisioned anywhere in this repo).
2. **Extraction call** — the backend sends the stored file to the chosen vendor's endpoint
   (synchronous call is fine at receipt-page-count; none of the vendors above require async
   polling for single-page receipts) and receives fields + confidence back.
3. **Draft created** — a record is written in a genuinely draft/unconfirmed status, holding the
   four fields, their confidences, and a reference to the stored file, per §"What the draft must
   hold" above. This is the point where the record starts existing at all — nothing upstream of
   this step touches the expense data model.
4. **Review/correction screen** — sits immediately after draft creation and before the expense
   enters any downstream flow (categorization, approval, posting). Renders the receipt image next
   to the four editable fields, with low-confidence fields visually flagged so the person doesn't
   have to re-verify fields the extractor was already confident about. The user corrects what's
   wrong and confirms.
5. **Confirmation** — flips the draft to a confirmed state, at which point category (ticket 02)
   and payee (ticket 01) assignment can proceed — this ticket's scope ends here; what happens to a
   confirmed expense is those tickets' concern.

The review step is deliberately a **gate**, not a background reconciliation step done later: none
of the surveyed vendors claim (or should be trusted to claim) accuracy high enough to post
directly to a ledger unattended, and this platform's own numeric discipline (exact decimals,
explicit rounding) makes an unreviewed OCR total a real risk to figures that eventually reach
Accounting's journal. A human confirms every draft before it becomes a real expense; the
confidence signal's only job is to make that confirmation fast, not to let it be skipped.

## Recommendation

For the third-party call: pick whichever of AWS Textract `AnalyzeExpense`, Azure Document
Intelligence `prebuilt-receipt`, or Google Document AI's Expense Parser matches whatever cloud
this platform's object storage ends up on — all three are near-identical in receipt-field
coverage, per-field confidence, and price (~$0.01/page), so the deciding factor is operational
(one fewer cloud vendor relationship, shared IAM/billing), not capability. Mindee is worth a
second look if the built-in per-field accuracy publication (>95%, stated on their own product
page) and lower entry pricing ($44/month) matter more than staying inside one cloud account;
Veryfi's richer field set and fraud detection are not worth its ~$500/month floor for a first
build. Do not self-host: this platform has no file-upload, storage, or image-processing
infrastructure today, and open-source OCR (Tesseract, docTR) only supplies raw text/layout, not
receipt-field semantics — replicating what a single ~$0.01 API call already does would mean
building the missing plumbing *and* a field-extraction layer from scratch. The draft record needs
the original file, the four fields as typed values (money fields using this platform's existing
exact-decimal type), a confidence score per field, and a capture-status marker, with a mandatory
human review/correction screen sitting between extraction and the moment the expense becomes real
— gating on a person, not on a confidence threshold, given none of these vendors publish accuracy
high enough to post unattended.
