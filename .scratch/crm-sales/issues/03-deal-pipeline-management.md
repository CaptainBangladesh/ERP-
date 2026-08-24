# 03 — Deal & pipeline management

**What to build:** A company defines its own pipeline: creating, reordering, and relabelling
Stages (including marking at most one Stage per company as meaning `won` and one as `lost`), all
from the deals board's "edit labels" affordance. A salesperson creates Deals against an existing
Party, gives each an aggregate amount (this platform's exact `MoneyValue`, currency fixed to
`DEFAULT_CURRENCY`), and moves them between Stages on the board — landing on a `won`/`lost` Stage
is how a Deal closes, with no separate close action. Deleting a Stage that still holds Deals is
refused. Full field list and the Stage/Deal contract are in [the spec](../spec.md)'s "Stage and
Deal schema and endpoints" section.

Runs independently of Lead management (02) — a Deal only needs an existing Party; its optional
`originLeadId` is a plain nullable field with no FK, so it doesn't require Lead's table to exist
functionally, only for the field to be populated when both happen to be built.

**Blocked by:** 01

- [ ] `Stage` model + migration: name, order (unique per company), `outcome` (`won`/`lost`/null,
      at most one of each per company, enforced at the application layer).
- [ ] `Deal` model + migration: partyId (mandatory), stageId (mandatory), name, amount
      (`MoneyValue`, decimal text over the wire), expectedCloseDate, assignedToUserId,
      originLeadId (nullable, no FK).
- [ ] Stage CRUD (create/reorder/rename/set outcome), refusing deletion while any Deal occupies it,
      refusing a second Stage with the same non-null `outcome` in one company.
- [ ] Deal CRUD, including moving between Stages.
- [ ] Deals board screen: Stages as columns (with "edit labels" to rename/reorder/add), Deals as
      cards moving between them, empty state when a company has zero Stages ("create your first
      stage").
- [ ] Assignment picker resolves users via `GET /api/identity/users`, same pattern as ticket 09.
- [ ] HTTP integration tests covering Stage CRUD (including the deletion-refusal and
      single-outcome-per-type refusal), Deal creation/movement, amount round-tripping as exact
      decimal text (not a JSON number), and tenant isolation.
