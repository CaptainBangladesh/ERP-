# 10 — Adjustments and transfers

**What to build:** The two movement types that keep the ledger honest about reality. When a
physical count disagrees with the system I can record an adjustment, and I must give a reason, so
discrepancies are explained rather than silently corrected. When stock physically moves between my
locations I can record a transfer, which changes where stock sits without changing how much I own.

**Blocked by:** 09 — Stock movements: receipt and issue

**Status:** ready-for-agent

- [ ] I can record an adjustment that raises or lowers stock at a location
- [ ] An adjustment requires a reason and is refused without one
- [ ] The reason is stored on the ledger entry and shown in movement history
- [ ] I can transfer stock of a product from one location to another
- [ ] A transfer leaves total stock across all locations unchanged
- [ ] Both sides of a transfer are visible and clearly linked in history
- [ ] A transfer to the location it came from is refused
- [ ] A transfer succeeds or fails as a whole; it can never half-apply
- [ ] Adjustments and transfers carry their own accounting classification
- [ ] Both appear in history with distinct types and can be filtered by type
- [ ] Backend tests cover adjustments, the mandatory reason, transfers and total conservation
- [ ] Backend tests prove a failed transfer leaves no partial change
- [ ] Frontend tests cover the adjustment and transfer forms and their validation
