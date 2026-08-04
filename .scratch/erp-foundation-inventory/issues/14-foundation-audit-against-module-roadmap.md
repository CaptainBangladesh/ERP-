# 14 — Foundation audit against the module roadmap

**What to build:** Proof that the foundation is ready for the next thirty-nine modules rather than
merely finished for inventory. The two shape stubs have been pushing against every decision since
tickets 03 and 07, so this is a confirmation pass, not a discovery pass — but it is the gate before
the second real business module starts. If it finds something expensive, the stubs were not
dissimilar enough, and that is itself a finding.

The check runs the contract against the shapes the roadmap actually contains: Sales and Purchase
(depend on Parties, Products and Inventory, and post to Accounting), Accounting (a sink every module
writes to), HRM and payroll (periodic, sensitive, immutable), Manufacturing (consumes and produces
stock), E-commerce (external traffic, eventual consistency with stock), and industry add-ons
(optional, extend without editing).

No modules are built. The output is recorded decisions and, where a gap is expensive to defer,
follow-up tickets.

**Blocked by:** 13 — Stock valuation

**Status:** done

- [x] The module contract is checked against a periodic, calculation-driven module
- [x] Tenant scoping is checked against sensitive personal data and stricter access
- [x] The permission model is checked against a module only some staff may access at all
- [x] The audit approach is checked against a legally-mandated immutable trail
- [x] The accounting seam is checked against a module every other module writes to
- [x] The public contract and events are checked against a module reading across boundaries
- [x] Tier enablement is checked against a module absent for some companies
- [x] The extension approach is checked against an add-on that must not edit what it extends
- [x] Module dependency ordering is checked against the roadmap's real dependency graph
- [x] The conformance pack is reviewed for what it fails to catch
- [x] Every gap is recorded as a decision, with its cost if deferred
- [x] Gaps expensive to fix later are raised as follow-up tickets
- [x] A written conclusion states whether the foundation is ready for the second business module

## Comments

**2026-08-02 — one gap ticket 04 chose to leave, for this audit to price.**

`Money` carries its currency everywhere it travels: it is on the wire on every monetary value,
it is part of the type, and arithmetic between two currencies throws rather than producing a
number. That is the expensive-to-retrofit half and it is done.

What is *not* stored is where the currency comes from. A newly created value takes it from
`DEFAULT_CURRENCY` in the shared package, so it is assumed at exactly one point — the moment a
value is first made. Ticket 04's criterion said "carried rather than assumed", and this half
meets it and half does not, deliberately: multi-currency is out of scope per the spec, and the
alternative (a `currency` column on `companies`, set at sign-up, carried on the session) buys
nothing today while adding a migration to identity's schema and a field to the session
principal.

The question for this audit is whether that stays true against the roadmap. Any module that
prices in a supplier's currency — Purchase is the obvious one — makes it false, and the fix is
a change to one constant's callers rather than to the type. Price it, and say so either way.

See ADR 0004, and ticket 04's comments.

**2026-08-04 — the audit, its answer, and what it did not expect to find.**

The whole of it is `docs/adr/0009-foundation-audit-against-the-module-roadmap.md`, with its
evidence in `backend/test/roadmap-audit.spec.ts` — the roadmap's shapes declared as manifests and
handed to the same `assembleModules` the build runs. No module was built and nothing boots there.

**The conclusion: the foundation is ready for the second business module, with one exclusion —
that module must not be Accounting.** Sales, Purchase, Manufacturing, E-commerce and any industry
add-on assemble, order deterministically, and survive each other's removal on the contract exactly
as it stands. Accounting is the one roadmap shape the contract gets wrong.

Mostly a confirmation pass, as expected. Four findings were not, and each has a ticket:

- **15 — an event edge is not a service edge.** A module cannot listen without declaring the
  emitter as a dependency, which makes removing any emitter take the sink down, and makes
  listening to an Enterprise module drag Accounting up out of Core. One manifest field and three
  branches now; thirty-nine modules' worth of wrong edges later. This blocks Accounting and
  nothing else.
- **16 — RLS, and the lock a build check chose.** ADR 0003 said row-level security would be
  revisited here and named the trigger: the first legitimate need for raw SQL against a
  company-owned table. It arrived in ticket 12 and was routed around — `check:tenancy` refuses
  `$queryRaw`, so the stock level projection is serialised by an in-process promise map that is
  correct for exactly one backend process, and nothing in the repository says so.
- **17 — every default sort carries its index.** ADR 0004 called it "a real obligation and not a
  hope" and left it unenforced; six modules in, `users` and `invitations` have already drifted.
- **18 — money is summed as money.** Valuation adds `MoneyValue`s by dropping to `Decimal` and
  re-wrapping with the default currency, which steps around the one refusal that makes ADR 0004's
  "carried rather than assumed" enforceable.

A fifth ticket came out of the review rather than the audit. **Tickets 11–13 were in the tree
uncommitted, marked done, with every box ticked, and three of ticket 11's criteria are not met** —
the whole permissive branch of the negative-stock policy, which only shows up for a company that
has chosen to allow it. Those are un-ticked with the reason in ticket 11, and issue 19 carries
them along with the rest of what the review found. Four defects in that work were fixed here
rather than deferred, because they were defects rather than debt: `Prisma.Decimal.toString()` in
three places in `reverse()` (the documented money-losing one), `tx: any`, a `SHAPE.reversal`
constant that was both dead and wrong, and a route written out by hand in three places. Issue 19
lists them so nobody looks for them there.

**On the comment above, and ticket 04's currency question: it is priced and the answer stands.**
`DEFAULT_CURRENCY` remains right until Purchase prices in a supplier's currency, and the fix then
is a column on `companies`, a field on the session principal, and the callers of one constant —
not a change to the type. The expensive half really was done in ticket 04. What the audit found
instead was issue 18, which is a different and smaller hole in the same guarantee.

**The finding this ticket half-predicted.** Issue 15 is the kind of gap the shape stubs exist to
prevent, and they did not prevent it — so, as the ticket says, the stubs were not dissimilar
enough. The reason is worth more than the finding: hrm and warranties differ in tier, sensitivity,
periodicity and optionality, and are identical in *direction*. Both are things other modules do
not listen to. Nothing in the foundation has ever consumed an event, so the one rule governing
consumption never had a case run against it. A third stub is deliberately not added — building the
counter-example after the fact is not what a counter-example is for — but the omission is recorded
in ADR 0009 so the next foundation gets asked about direction too.

Everything else the audit checked is recorded in ADR 0009 as understood and accepted with a
trigger: no scheduler (the expensive half, `Tenancy.runInCompany`, already exists), no anonymous
request path for an e-commerce storefront (a middleware, when E-commerce is built), no frontend
extension slots for add-ons (deliberate, and revisited at the second add-on that wants one), no
inventory write contract (written when its first consumer exists), the immutability-versus-erasure
tension on payroll records, and the conformance pack's seven known blind spots.
