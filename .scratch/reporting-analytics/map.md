# Map — Reporting & Analytics

Label: wayfinder:map

## Destination

A working Reporting & Analytics module for the ERP, built now rather than only decided — see
Notes. Phase 1 delivers inventory-based core metrics (stock-on-hand, valuation over time,
movement/turnover history) from data that already exists (tickets 08–13 of
`erp-foundation-inventory`). Phase 2 adds financial metrics (P&L, cash position, AP/AR) once
Accounting's ledger model lands; the module boundary and query mechanism are designed now so
phase 2 slots in without rework, but its metrics are not built until Accounting exists.

## Notes

**This map carries execution, not just decisions** — overriding wayfinder's plan-only default.
Each ticket here is expected to result in working code once resolved, not only a documented
decision.

Modular monolith ERP — see `README.md`, `docs/modules.md`, `docs/tenancy.md`. A module reads
another only through its public surface or its declared events, never another module's tables
directly — enforced by `check:conformance` (`docs/modules.md`, "What a module may not do").
Reporting will want to listen to events from Inventory now, and from Expenses/Accounting/Sales/
Payroll later, without being dragged to their tier or taken down if one emitter isn't installed —
exactly the problem foundation ticket 15 ("event edges are not service edges," status
ready-for-agent, `.scratch/erp-foundation-inventory/issues/15-event-edges-are-not-service-edges.md`)
exists to fix. This map treats ticket 15 as an **external prerequisite**, the same way the
Expenses & Accounting map already does, and does not re-ticket it.

Verified directly in `backend/src/platform/tenancy/tenant-scope.ts`: the tenant-scoping extension
intercepts `$allOperations` on `$allModels`, and explicitly covers `aggregate` and `groupBy`
(both are in its `TAKES_WHERE`/`AGGREGATES` sets). Standard rollups — sums, counts, averages,
group-by breakdowns — are already safely tenant-scoped through Prisma's native query API. Only
`$queryRaw` and its siblings bypass the extension, and `check:tenancy` refuses those outside the
test harness. The real gap is narrow: only genuinely complex queries (multi-table window
functions, running totals) would need a reviewed exception. Don't assume the gap is bigger than
that going in.

Prior art on scheduling: `expenses-accounting`'s ticket 06 found this platform has no real
scheduler yet, and recommended lazy/pending-draft materialization over building one
(`.scratch/expenses-accounting/issues/06-recurring-scheduler.md`). If a phase-1 metric needs
periodic snapshots (e.g. a valuation trend line), check that finding before assuming a scheduler
is the answer.

Use `/grilling` and `/domain-modeling` for grilling tickets; `/research` for research tickets;
`/prototype` and the `dataviz` skill for the dashboard UI once its ticket unblocks.

## Decisions so far

<!-- one line per closed ticket, appended on resolution -->

(none yet — map just charted)

## Not yet specified

- **Financial metrics (phase 2)** — P&L, cash position, AP/AR. Blocked on Accounting's ledger
  model, which is itself still fog on the Expenses & Accounting map ("Accounting module shape",
  `.scratch/expenses-accounting/map.md`). Not sharp enough to ticket until that lands.
- **Dashboard UI shape beyond ticket 05's placeholder** — exact chart choices depend on which
  phase-1 metrics ticket 02 settles on.
- **Data freshness / snapshot strategy** — real-time query vs. periodic materialization for trend
  metrics like valuation-over-time. Depends on which specific metrics ticket 02 chooses, and
  should consult the scheduling prior art above once it's live.

## Out of scope

(none yet)
