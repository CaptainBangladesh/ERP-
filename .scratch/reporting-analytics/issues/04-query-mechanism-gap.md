# 04 — Query-mechanism gap: which phase-1 metrics need more than Prisma's aggregate/groupBy

Type: research
Blocked by: 02

## Question

This map's Notes already establish that Prisma's tenant-scoping extension covers `aggregate`
and `groupBy` safely — the raw-SQL ban (`check:tenancy`) is not the blanket obstacle it first
looked like. For the specific metrics ticket 02 names:

- Which ones are expressible with Prisma's native `aggregate`/`groupBy`/`count` API alone?
- Which (if any) genuinely need something beyond it — multi-table window functions, running
  totals, date-bucketing across joins Prisma's query builder can't express?
- For anything in the second bucket, what's the narrowest safe mechanism — a reviewed, scoped
  `$queryRaw` exception (and what carving that out of `check:tenancy` would actually require), a
  materialized view, or restructuring the query to fit Prisma after all?
