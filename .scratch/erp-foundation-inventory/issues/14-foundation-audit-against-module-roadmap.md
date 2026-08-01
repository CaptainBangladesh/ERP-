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

**Status:** ready-for-agent

- [ ] The module contract is checked against a periodic, calculation-driven module
- [ ] Tenant scoping is checked against sensitive personal data and stricter access
- [ ] The permission model is checked against a module only some staff may access at all
- [ ] The audit approach is checked against a legally-mandated immutable trail
- [ ] The accounting seam is checked against a module every other module writes to
- [ ] The public contract and events are checked against a module reading across boundaries
- [ ] Tier enablement is checked against a module absent for some companies
- [ ] The extension approach is checked against an add-on that must not edit what it extends
- [ ] Module dependency ordering is checked against the roadmap's real dependency graph
- [ ] The conformance pack is reviewed for what it fails to catch
- [ ] Every gap is recorded as a decision, with its cost if deferred
- [ ] Gaps expensive to fix later are raised as follow-up tickets
- [ ] A written conclusion states whether the foundation is ready for the second business module
