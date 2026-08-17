# 03 — Expense report grouping

Type: grilling

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
