# Lead priority is a display-only custom field, not a sortable column

The redesigned lead workspace shows a Hot/Warm/Cold priority badge on worklist cards and the
lead header. We chose to store priority as a company-defined **custom field**
(`Lead.customValues`) rather than a first-class column on `Lead`, to avoid a schema change and
let each company name its own priority scheme.

The consequence — surprising to a future reader — is that priority **cannot drive server-side
sort or filter**: `customValues` is a JSON column deliberately excluded from the `ListSpec`
sort/filter grammar (see the note on `Lead.customValues` in `schema.prisma`). So the worklist
badge is a visual triage cue only; "stack the hot leads on top" is not available without
promoting priority to a real column later. If that need becomes real, the reversal is a
migration plus a list-field declaration, and this ADR should be superseded.
