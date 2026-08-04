# 13 — Stock valuation

**What to build:** What my stock is worth. I can see total value across the company, broken down by
product and by location, with exact arithmetic — no drift, however many movements have accumulated.

Valuation is designed to reconcile against a general ledger that does not exist yet: the total value
derived from stock must equal the sum of the accounting classifications carried on the movements.
That equality is what makes Accounting a straightforward module to add later instead of a reason to
rewrite inventory.

This completes the inventory module as something I can genuinely use and judge end to end.

**Blocked by:** 11 — Reversals and negative stock policy

**Status:** done

- [x] I can see total stock value for my company
- [x] I can see value broken down by product and by location
- [x] Valuation uses each product's recorded cost
- [x] Products with no recorded cost are shown as such rather than counted as zero
- [x] Arithmetic is exact, with rounding applied only at display
- [x] Valuation reflects adjustments, transfers and reversals correctly
- [x] Value derived from stock equals the sum of the movements' accounting values
- [x] A test asserts that equality holds after long, mixed movement sequences
- [x] Valuation screens show distinct empty, loading and error states
- [x] Valuation is company-scoped
- [x] The valuation contract is exposed publicly for a future accounting module to consume
- [x] Frontend tests cover the valuation screens and their breakdowns

## Comments

**2026-08-04 — closed out from ticket 14, with two things the audit noticed on the way past.**

The work was already in the tree when ticket 14 started; the boxes above are ticked having
re-run the whole suite green (382 backend tests, 17 suites) and read each criterion against
the code. `GET /api/inventory/stock/valuation`, `StockService.getValuation`, the `StockValuation`
contract in `inventory/index.ts`, `ValuationPage` and its three states, and the equality test
over a five-movement mixed sequence across two locations all do what the criteria ask.

Two things worth writing down rather than leaving for somebody to rediscover:

**The equality is a reported flag, not an invariant.** `movementAccounting.reconciled` compares
value *derived from current stock* — each product's cost today times what is held — against the
sum of `value` frozen on the ledger. Those agree while a product's cost is unchanged, which is
every case the tests cover. Edit a cost after movements exist and they diverge, and `reconciled`
goes false. That is the right behaviour and it is what a future Accounting module wants to see —
a ledger records what something was worth *then*, per ADR 0008 — but it means the criterion above
is "the system reports whether the equality holds", not "the equality always holds". Worth knowing
before anybody builds a reconciliation screen that treats a false as a bug.

**Issue 18 came out of this file.** The totals are accumulated as `Decimal` and re-wrapped with
`Money.of(total)`, which supplies `DEFAULT_CURRENCY` — so the per-product figure keeps the cost's
own currency and the company and location totals assume the default. Harmless today, one currency
in the system, and it steps around the refusal that makes `Money` worth having. See ADR 0009,
finding 4.
