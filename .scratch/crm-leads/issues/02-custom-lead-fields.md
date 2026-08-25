# 02 — Custom lead fields

**What to build:** A company defines its own fields on a Lead — text, number, date,
single-select, multi-select, checkbox — without a developer, and every write path that will
eventually set them (manual entry now; import and capture once tickets 04/05 land) validates
against the same definitions, so the public capture door is never the lenient one.

`LeadFieldDefinition` rows per company drive a no-code field editor; values live in one JSON
column on `Lead` (`customValues`), keyed by a stable `key` generated once at creation so a later
rename never orphans stored data. Custom fields are deliberately **not** filterable/sortable in
this cut — the platform's `ListSpec` grammar is static and a JSON column has no static fields to
declare; this is a stated limitation, not an oversight.

**Blocked by:** None — can start immediately.

**Status:** complete

- [x] `LeadFieldDefinition` (`key`, `label`, `type`, `options`, `required`, `order`,
      `archivedAt`) can be created, reordered, relabeled, and archived from a no-code field
      editor.
- [x] A field's `key` is generated once at creation and never changes when the label is renamed,
      so stored values never orphan.
- [x] `Lead.customValues` stores values keyed by definition `key`; each write is validated
      against its definition's type — a date field refuses a non-date value, a `select`/
      `multiselect` value outside its configured options is refused, a required field refuses an
      absent value.
- [x] An archived field's previously stored values remain visible on the lead even though the
      field no longer appears in the editor.
- [x] Custom fields appear on the lead creation form and the lead detail screen.
- [x] Custom fields are not filterable or sortable on the board in this cut.
- [x] Tenant isolation holds for `LeadFieldDefinition`.
