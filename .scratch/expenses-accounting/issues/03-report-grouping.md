# 03 — Expense report grouping

Type: grilling
Status: resolved

## Question

Individual expense lines get grouped into an "expense report" before submission — per the source
workflow: photograph receipts, tag each line with a category, group them under a report, submit
the report as a batch.

Resolve:

- What defines a report's boundary — a trip, a date range, a project, or a free-form label the
  submitter chooses?
- Can a line exist without belonging to a report, or is a report mandatory before submission?
- Is the report itself a first-class record with its own table and lifecycle, or a query
  grouping over lines that share a tag?

This shapes what "approval" acts on later — a line or a report — which is why the approval
workflow stays fog until this resolves.

## Answer

**`ExpenseReport` is a first-class record, not a query grouping.** A report needs its own
lifecycle state independent of any single line's — "this batch was submitted" is a fact that has
to live somewhere, and a tag over lines has nowhere to hold it. Approval acts on the report as a
unit (confirmed by the boundary question below), which needs a row to act on.

**Schema:**
- `ExpenseReport`: `id`, `companyId`, `submittedByUserId` / `submittedByName` (same frozen-pair
  mechanism as `ExpenseRecord`'s submitter fields — copied at write time, since Identity resolves
  nothing live), `name` (free-form label the submitter types, e.g. "NYC trip — March"),
  `startDate`, `endDate` (both mandatory, using the existing `Field type="date"` primitive this
  platform already has), `status`.
- **Boundary is structured but not over-built:** a name plus a real date range, not a free-form
  label alone and not a reference to a Project/Trip concept. A date range is cheap — two date
  columns — and buys real filtering ("show me Q1's reports") that a label alone can't; a
  project/trip reference would require inventing a Projects module that doesn't exist anywhere on
  this platform, which is scope this ticket doesn't own.
- `status`: string (`'draft' | 'submitted' | 'approved' | 'rejected'`), not a Postgres enum — same
  treatment as every other status column in this codebase (`Product.status`,
  `payeeType`, `Category.classification`). **This ticket only reserves the vocabulary; it does not
  build the transition.** No endpoint in this ticket sets `approved` or `rejected` — that's the
  separate, still-fog approval-workflow ticket's job (who holds the permission, thresholds,
  levels). Reserving the values now means that ticket adds behavior, not a migration.
- `ExpenseRecord.reportId` is **mandatory**, not nullable, matching the source workflow exactly
  ("group them under a report, submit the report as a batch"). A line is created inside a report
  (or added to one) before it can move past draft — approval gets one consistent unit to act on
  (the report) rather than two it would have to special-case (a lone line and a report).
  Consequently: a captured line (OCR/email) needs both `categoryId` and `reportId` assigned at
  confirmation time, the same moment it needs everything else that makes it real; a manually
  entered line needs both at creation. Editing/removing lines is only possible while the parent
  report is `draft`; a report's own transition to `submitted` is what locks its lines, mirroring
  `StockMovement`'s immutability pattern but scoped to the report rather than the line.

**Consequence for the map:** the approval workflow's fog item can now say "acts on `ExpenseReport`,
not on individual `ExpenseRecord` rows" — the ambiguity this ticket existed to remove.

Resolved through interactive grilling; live discussion not separately filed under `research/`.
