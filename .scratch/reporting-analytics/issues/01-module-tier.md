# 01 — Reporting module tier: Core or Enterprise, and does the answer survive phase 2?

Type: grilling

## Question

What tier does the Reporting module belong to? Inventory (its first data source) is Core tier.
Basic stock/valuation reporting could reasonably be baseline functionality every business gets,
or a premium capability gated behind Enterprise — this is a business/pricing decision, not a
technical one, so it isn't guessed at breadth-first.

Resolve:

- Core or Enterprise for phase 1 (inventory metrics)?
- Does that answer survive phase 2? Once Reporting wants to listen to Accounting's events (tier
  not yet decided — see the Expenses & Accounting map) or Payroll/HRM's (Enterprise), does
  Reporting need to be Enterprise itself, or does foundation ticket 15's event/service split (see
  this map's Notes) mean a Core-tier Reporting module can still listen to an Enterprise emitter
  without being dragged up?
- If the answer differs by phase, does that mean two modules (`reporting-core`,
  `reporting-enterprise`) rather than one module whose tier changes later?
