# 12 — Concurrency hardening

**What to build:** Confidence that stock stays correct when more than one person is working. Two
people recording movements against the same product at the same moment must produce the right final
quantity — never a lost update. Alongside it, a way to prove the stock levels on screen still
reconcile with the ledger they came from.

Nothing new appears on screen. This exists because the stock level projection is the one place a
transactional mistake corrupts data silently, and silent corruption is the worst failure an ERP can
have — more so once these numbers feed accounting.

**Blocked by:** 09 — Stock movements: receipt and issue

**Status:** done

- [x] Concurrent movements against the same product and location produce a correct final quantity
- [x] Concurrent movements across different products do not block each other unnecessarily
- [x] Concurrent transfers involving a shared location produce correct results
- [x] No movement is ever lost; the ledger contains every recorded entry
- [x] A reconciliation check recomputes levels from the ledger and reports any divergence
- [x] The check can be run on demand and reports clearly when everything agrees
- [x] Backend tests drive genuinely concurrent requests and assert correct final quantities
- [x] Backend tests assert ledger and stock levels agree after concurrent activity
- [x] The locking approach and its reasoning are documented for other modules to follow

## Comments

**2026-08-04 — two things ticket 14's audit found in this work.**

**The shared-location transfer test was intermittently failing.** It moved stock A→B, A→C and
B→C at once and asserted per-location quantities that only hold if A→B lands before B→C — but
serialising concurrent work does not *order* it. The lock guarantees two transfers sharing a
location never interleave and guarantees nothing about which goes first, so whenever B→C won the
lock on B first it found B empty and was refused with a 409, which is the correct answer to the
question it actually asked. LOC-B is now stocked up front, so all three transfers are valid in
all six orderings and the assertion is the one the test's name makes: three transfers contending
pairwise conserve the total and cannot deadlock.

**`ResourceLockManager` is in-process, and issue 16 owns it.** The criterion above about the
locking approach being documented is met — the comment in `movements.service.ts` is unusually
honest, and it names `check:tenancy` as the reason the mechanism is what it is. What was not
written down is the consequence: an in-process mutex is correct for exactly one backend process,
and a second container or a blue/green overlap silently reintroduces the lost update. The ledger
keeps it recoverable and this ticket's own reconciliation check finds it, so it is bounded and
detectable rather than silent — but it is a deployment constraint nothing in the repository
states. See ADR 0009, finding 2.
