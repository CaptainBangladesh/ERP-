# 12 — Concurrency hardening

**What to build:** Confidence that stock stays correct when more than one person is working. Two
people recording movements against the same product at the same moment must produce the right final
quantity — never a lost update. Alongside it, a way to prove the stock levels on screen still
reconcile with the ledger they came from.

Nothing new appears on screen. This exists because the stock level projection is the one place a
transactional mistake corrupts data silently, and silent corruption is the worst failure an ERP can
have — more so once these numbers feed accounting.

**Blocked by:** 09 — Stock movements: receipt and issue

**Status:** ready-for-agent

- [ ] Concurrent movements against the same product and location produce a correct final quantity
- [ ] Concurrent movements across different products do not block each other unnecessarily
- [ ] Concurrent transfers involving a shared location produce correct results
- [ ] No movement is ever lost; the ledger contains every recorded entry
- [ ] A reconciliation check recomputes levels from the ledger and reports any divergence
- [ ] The check can be run on demand and reports clearly when everything agrees
- [ ] Backend tests drive genuinely concurrent requests and assert correct final quantities
- [ ] Backend tests assert ledger and stock levels agree after concurrent activity
- [ ] The locking approach and its reasoning are documented for other modules to follow
