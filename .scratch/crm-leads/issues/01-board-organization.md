# 01 — Board organization: groups, sources, status labels & source reporting

**What to build:** A sales manager can arrange the Leads board the way their team actually thinks
about it — grouped, sourced, and labeled in their own vocabulary — and see which sources are
actually converting, not just producing volume.

Finishes the in-flight `LeadGroup` work (uncommitted at spec time: model, service, controller,
migration exist but aren't declared in `crm.manifest.ts`), replaces the fixed `LEAD_SOURCES` list
with a company-owned `LeadSource` vocabulary, adds cosmetic per-company labels/colors on top of
the four fixed `Lead.status` values (not a new state — qualify/disqualify and `WorkflowRule`
triggers are untouched), and extends the existing pipeline dashboard with a produced-vs-converted
breakdown per source.

**Blocked by:** None — can start immediately.

**Status:** complete

- [x] `LeadGroup` and its migration are declared in `crm.manifest.ts`; `check:modules` passes.
- [x] Listing lead groups with zero groups returns an empty list — no row is created as a side
      effect of reading (removes the current read-time auto-provision).
- [x] Groups can be created, renamed, reordered, and colored from the board; deleting a group
      that still holds leads is refused.
- [x] `LeadSource` is a company-owned row (`name`, `order`). The migration converts each
      company's existing distinct `Lead.source` string values into `LeadSource` rows and
      repoints every `Lead` at the resulting row — no data loss, no company seeded with a
      vocabulary it didn't already have.
- [x] Sources can be created, renamed, and reordered; deleting a source still referenced by a
      `Lead` is refused.
- [x] The board can be filtered by group, source, status, and owner.
- [x] A company can relabel and recolor each of the four fixed status values
      (`new`/`contacted`/`qualified`/`disqualified`) via an "Edit Labels" affordance; the
      underlying status values, qualify/disqualify behavior, and `WorkflowRule` `triggerConfig`
      vocabulary are unchanged by this.
- [x] The pipeline dashboard shows leads produced and leads converted, grouped by source, over a
      selectable date range.
- [x] Tenant isolation holds for `LeadGroup`, `LeadSource`, and the new status-label rows: one
      company's rows are never visible or referenceable from another.
