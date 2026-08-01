# 13 — Stock valuation

**What to build:** What my stock is worth. I can see total value across the company, broken down by
product and by location, with exact arithmetic — no drift, however many movements have accumulated.

Valuation is designed to reconcile against a general ledger that does not exist yet: the total value
derived from stock must equal the sum of the accounting classifications carried on the movements.
That equality is what makes Accounting a straightforward module to add later instead of a reason to
rewrite inventory.

This completes the inventory module as something I can genuinely use and judge end to end.

**Blocked by:** 11 — Reversals and negative stock policy

**Status:** ready-for-agent

- [ ] I can see total stock value for my company
- [ ] I can see value broken down by product and by location
- [ ] Valuation uses each product's recorded cost
- [ ] Products with no recorded cost are shown as such rather than counted as zero
- [ ] Arithmetic is exact, with rounding applied only at display
- [ ] Valuation reflects adjustments, transfers and reversals correctly
- [ ] Value derived from stock equals the sum of the movements' accounting values
- [ ] A test asserts that equality holds after long, mixed movement sequences
- [ ] Valuation screens show distinct empty, loading and error states
- [ ] Valuation is company-scoped
- [ ] The valuation contract is exposed publicly for a future accounting module to consume
- [ ] Frontend tests cover the valuation screens and their breakdowns
