# 18 — Money is summed as money

**What to build:** Valuation adding monetary amounts through `Money` rather than through
`Decimal`, so that the refusal the type exists for is not stepped around by the module that does
the most arithmetic.

`Money` carries its currency everywhere it travels and **refuses arithmetic across two of them**.
That refusal is the whole of what makes ADR 0004's "carried rather than assumed" enforceable — a
bare `Decimal` on a column called `amount` cannot refuse anything.

`StockService.getValuation` sums by taking `MoneyValue.amount`, parsing it to a `Decimal`, adding
the `Decimal`s, and re-wrapping the total with `Money.of(total)` — which supplies
`DEFAULT_CURRENCY`. The per-product figure keeps the cost's own currency; the company total and
every location total assume the default. The movement accounting totals do the same.

Today every product cost is created in `DEFAULT_CURRENCY`, so every number is right and no test
can tell. The first supplier priced in EUR turns a refusal into a total labelled GBP. This is the
retrofit ADR 0004 called the expensive half, quietly reintroduced in one method.

Small, and a ticket rather than an edit inside the audit because ticket 14 builds nothing.

**Blocked by:** 14 — Foundation audit against the module roadmap

**Status:** ready-for-agent

- [ ] Valuation totals are accumulated as `Money`, not as `Decimal`
- [ ] The accumulator starts from a value's own currency rather than from a constant
- [ ] Summing costs in two currencies is refused rather than answered
- [ ] A test asserts that refusal, so the guarantee is evidenced rather than assumed
- [ ] Company, product, location and movement-accounting totals all go through the same path
- [ ] Every existing valuation figure is unchanged, and the suite says so
- [ ] Anywhere else in the repository that sums money as `Decimal` is found and given the same treatment

## Comments

**2026-08-04 — the shape of the fix, and what stays out of scope.**

Roughly: keep a `Money | null` accumulator per total, seed it from the first costed item rather
than from `Money.zero()`, and let `plus` throw. Null stays meaningful and already is — a total
over no costed products is `null` today and must remain so, because ADR 0008's whole argument for
`value` being null rather than zero is that "nobody has said what this costs" is not a claim that
it is worthless.

The last criterion is the one worth doing properly. `Money.of(` and `Decimal.parse(` on something
that came off a `MoneyValue` are the two things to look for; `HrmService.grossPay` is the other
place money arithmetic happens and it does it correctly, through `Money`, which is the pattern.

**What is not in scope:** multi-currency. ADR 0009 priced ticket 04's open question and confirmed
the answer — `DEFAULT_CURRENCY` stays until Purchase prices in a supplier's currency, at which
point the change is a column on `companies`, a field on the session principal, and the callers of
one constant. This ticket does not add a currency column and does not touch the session. It closes
the hole through which the *type's* guarantee leaks, which is a different and much smaller thing.

See ADR 0009, finding 4, and ADR 0004, decision 3.
