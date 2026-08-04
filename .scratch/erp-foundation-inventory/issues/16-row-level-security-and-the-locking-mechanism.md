# 16 — Row-level security, and the lock that a build check chose

**What to build:** The backstop ADR 0003 accepted in principle and scheduled for the foundation
audit, brought forward — and with it, a serialisation mechanism for the stock level projection
that does not depend on there being exactly one backend process.

The two are one ticket because one caused the other. `check:tenancy` refuses `$queryRaw` and
`$executeRaw` anywhere outside the test harness, so when ticket 12 needed to serialise the
read-then-write on `StockLevel` it could not write `SELECT … FOR UPDATE`. What it built instead is
`ResourceLockManager` in `movements.service.ts`: a `Map` of promises keyed on
`productId:locationId`, held by the singleton service. It is correct, it is deadlock-free by
sorting keys before acquiring them, and it does not block unrelated products.

It is also in-process. A second backend instance — a second container, a worker, a blue/green
overlap during a deploy — silently reintroduces the lost update ADR 0008 described, with nothing
failing. The ledger keeps it recoverable and `GET /stock/reconcile` finds it, so this is a bounded
and detectable divergence rather than silent corruption. But "correct provided the process count
is one" is a deployment constraint that nothing in the repository states, and it was arrived at by
a check about tenancy making a decision about concurrency.

ADR 0003 named the trigger that brings RLS forward: **the first legitimate need for raw SQL against
a company-owned table.** It arrived in ticket 12 and was routed around rather than recognised. The
check is not really a rule about raw SQL — it is a rule that says the extension is the only
enforcement — and the honest way to keep that rule while taking a row lock is to put enforcement
somewhere a raw statement cannot escape from.

Not because tenancy has leaked: it has not, and `tenancy.spec.ts` exercises the extension against a
real database. Because the alternative is a second concurrency mechanism per module for as long as
raw SQL stays unavailable, and because the plumbing ADR 0003 declined to pay for is now paid against
a system with a real ledger in it rather than one whose only sensitive table was a stub.

**Blocked by:** 14 — Foundation audit against the module roadmap

**Status:** ready-for-agent

### The decision this ticket owns

The mechanism is open and settling it is the first half of the work. RLS is the reason the ticket
exists but the criteria below do not assume it — what is settled is that the status quo does not
survive the roadmap. Candidates, each to be priced before code is written:

1. **Postgres RLS**, with the tenancy extension layered over it, and a narrowly scoped raw-SQL
   exception for row locks. ADR 0003's costs come due: every request inside a transaction for
   `SET LOCAL` to survive pooling, and a non-superuser application role separate from the
   migration role, whose failure mode when misconfigured is *empty result sets* rather than an
   error.
2. **A raw-SQL exception with no RLS** — `check:tenancy` grants one in the
   `withoutCompanyScope` spirit: greppable, costing whoever opens it a written reason. Cheapest,
   and it leaves the guarantee resting on the exception being read carefully.
3. **Postgres advisory locks** through the extension, so no module writes SQL at all and the lock
   is cross-process without the enforcement question being reopened.

Whichever wins, it is recorded as an ADR before the code, superseding ADR 0003's deferral.

- [ ] The mechanism is chosen and recorded as an ADR, with the alternatives priced
- [ ] Concurrent movements against the same product and location are serialised across processes
- [ ] Concurrent movements against different products still do not block each other
- [ ] Transfers and twin reversals, which touch two levels, remain deadlock-free
- [ ] `ResourceLockManager` is gone, or is documented as deliberately retained with its constraint
- [ ] Tenant isolation is still enforced for any query the new mechanism introduces
- [ ] A test drives genuinely concurrent requests and asserts the final quantity
- [ ] Ticket 12's reconciliation check still reports agreement after concurrent activity
- [ ] If raw SQL is permitted anywhere, `check:tenancy` names the exception and requires a reason
- [ ] Migrations are covered, or the remaining gap is written down
- [ ] `docs/tenancy.md` describes what a module may now assume about concurrency

## Comments

**2026-08-04 — what the current lock says about itself.**

`ResourceLockManager`'s own comment names `check-tenancy.mjs` as the reason it exists, which is
what makes this a finding rather than a preference — the constraint is documented at the point it
bit. Read it in `backend/src/modules/inventory/movements.service.ts` before choosing a
replacement; it is a correct piece of code solving the wrong-sized problem.

One thing to keep whichever way this goes: the lock keys are sorted before acquisition, which is
what makes a transfer touching two locations unable to deadlock against a transfer touching the
same two in the other order. Any replacement needs the same property, and `movements.spec.ts`
already has the test that would catch losing it.

ADR 0003 also lists a gap this ticket is the natural home for: **migrations are not covered.** A
migration script that moves rows between companies is not something the extension can see, and it
is not something the conformance pack can see either. RLS closes it; the other two candidates do
not, and if one of them wins that should be said out loud rather than left implied.

See ADR 0009, finding 2, and ADR 0003's "RLS is accepted in principle and deferred".
