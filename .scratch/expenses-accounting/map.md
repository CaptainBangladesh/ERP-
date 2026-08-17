# Map — Expenses & Accounting

Label: wayfinder:map

## Destination

A spec for two Core-tier modules — **Expenses** (capture via manual entry, OCR, email, and
mileage; categorized with industry-preset templates; grouped into expense reports; routed
through an approval workflow; tied to a payee — employee reimbursement, company card, or vendor
bill via Parties) and **Accounting** (chart of accounts, journal-entry posting from Expenses' and
Inventory's emitted events, payable tracking, payment/reimbursement, and bank reconciliation).
Expenses never depends on Accounting — it carries value and accounting classification in its
events, exactly as Inventory already does (ADR 0008); Accounting is the sink.

## Notes

Modular monolith ERP — see `README.md`, `docs/modules.md`, `docs/tenancy.md`. Fourteen
foundation tickets are done (`.scratch/erp-foundation-inventory/`); ticket 14's audit
(`docs/adr/0009-foundation-audit-against-the-module-roadmap.md`) found the foundation ready for a
second business module and named the constraint this map inherits: a module can't consume
another's events without a `dependsOn` edge, so a sink drags in the emitter's tier and breaks the
deletion test. That gap is already fully specified as foundation ticket 15 ("event edge ≠ service
edge"), status ready-for-agent, at
`.scratch/erp-foundation-inventory/issues/15-event-edges-are-not-service-edges.md` — this map
treats it as an **external prerequisite** for Accounting's event consumption and does not
re-ticket it.

Expenses is Core tier (decided). **Accounting's tier is not pre-decided.** Ticket 15's acceptance
criteria removes the technical constraint that would force a consumer's tier to match a
higher-tier emitter — that only means Accounting *can* be Core without being dragged up; it
doesn't answer whether it *should* be. That's a real, separate business decision, folded into the
Accounting-module-shape fog item below rather than assumed settled once 15 lands.

Every category-to-ledger link follows ADR 0008's pattern: the emitting module (Expenses) carries
the value and classification, and never gains a `dependsOn` on Accounting — the same discipline
Inventory already established for the accounting module that doesn't exist yet.

Use `/grilling` and `/domain-modeling` for grilling tickets; `/research` for research tickets,
each fired as its own subagent per the usual protocol.

## Decisions so far

<!-- one line per closed ticket, appended on resolution -->

- [06 — Recurring-expense scheduling](issues/06-recurring-scheduler.md) — `check:conformance`
  does not actually forbid background writes (it's 21 static text rules, none about who
  triggered an insert); recommend lazy/pending-draft materialization on the next authenticated
  request rather than building the platform's first real scheduler. Full findings in
  `research/06-recurring-scheduler.md`.

## Not yet specified

- **Approval workflow** — levels, thresholds (e.g. a second tier above some amount), who holds
  the approve/reject permission. Depends on the payee model (01) and expense report grouping
  (03) — approval likely acts on whatever unit those decide.
- **Mileage tracking** — rate configuration (flat vs. per-vehicle), unit (km/mi), who sets the
  rate. Depends on the category model (02).
- **Spend policies** — a per-line limit enforced at submission (e.g. "max $50/meal"), flag vs.
  hard block. Distinct from budgets below. Depends on the category model (02).
- **Budgets** — an aggregate spend cap per category/period, with some kind of overspend signal.
  Distinct from spend policies above. Depends on the category model (02).
- **Recurring expense rules** — cadence, template, what "due" means, and confirming the
  lazy/pending-draft materialization shape ticket 06 recommended. Depends on the category model
  (02) only now that 06 has resolved.
- **Accounting module shape** — chart of accounts, journal-entry model, how it consumes
  Expenses'/Inventory's events without depending on them, and its own tier (see Notes above).
  Depends on the payee model (01), since payee type shapes the payable side of the ledger, and
  eventually on the approval workflow, since posting happens after approval.
- **Payment & reimbursement flow** — how an employee gets paid back, how a vendor bill gets
  marked paid. Depends on the Accounting module shape.
- **Bank reconciliation** — where bank data comes from (manual import vs. a live feed) and how
  it matches against recorded payments. Depends on payment & reimbursement.
- **Client re-invoicing** — billing an expense back to a customer via a Sales Order. Blocked on
  a Sales module that does not exist on this platform yet; revisit once it does.

## Out of scope

<!-- nothing ruled out yet -->
