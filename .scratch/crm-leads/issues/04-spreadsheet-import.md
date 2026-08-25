# 04 — Spreadsheet import

**What to build:** A sales manager uploads a CSV or XLSX of leads, maps its columns onto Lead
fields (built-in and custom), previews exactly what would be created and what would be rejected
— row by row, with a reason — before anything is written, then commits. This is the first file
upload this platform has ever accepted, so the multipart handling is added as a reusable
platform capability rather than invented inside `crm`.

**Blocked by:** 01 (Board organization — an imported lead needs a source/group to land in), 02
(Custom lead fields — the column mapping must offer them).

**Status:** ready-for-agent

- [ ] The platform gains a reusable multipart-upload capability (size cap, content-type
      allowlist) that this import endpoint is the first consumer of.
- [ ] A dry-run endpoint accepts an uploaded spreadsheet and a column mapping, writes nothing,
      and returns `{ accepted, rejected: [{ row, field, message }] }`.
- [ ] A commit endpoint performs the same parse-and-validate and writes only the accepted rows,
      reporting the same shape.
- [ ] The column mapping step offers both built-in Lead fields and the company's
      `LeadFieldDefinition`s.
- [ ] A malformed row (bad email, bad custom-field type, etc.) is reported with its row number
      and never blocks its neighbours from being accepted.
- [ ] A non-spreadsheet upload and an oversized upload are each refused with a clear message
      before any parsing is attempted.
- [ ] Each committed batch is recorded as a `LeadImport` (`filename`, `rowCount`,
      `acceptedCount`, `importedByUserId`/`importedByName` actor freeze pair).
- [ ] The uploaded file itself is never persisted after the request completes.
- [ ] Tenant isolation holds for `LeadImport`.
