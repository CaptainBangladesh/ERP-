# 10 — Adjustments and transfers

**What to build:** The two movement types that keep the ledger honest about reality. When a
physical count disagrees with the system I can record an adjustment, and I must give a reason, so
discrepancies are explained rather than silently corrected. When stock physically moves between my
locations I can record a transfer, which changes where stock sits without changing how much I own.

**Blocked by:** 09 — Stock movements: receipt and issue

**Status:** done

- [x] I can record an adjustment that raises or lowers stock at a location
- [x] An adjustment requires a reason and is refused without one
- [x] The reason is stored on the ledger entry and shown in movement history
- [x] I can transfer stock of a product from one location to another
- [x] A transfer leaves total stock across all locations unchanged
- [x] Both sides of a transfer are visible and clearly linked in history
- [x] A transfer to the location it came from is refused
- [x] A transfer succeeds or fails as a whole; it can never half-apply
- [x] Adjustments and transfers carry their own accounting classification
- [x] Both appear in history with distinct types and can be filtered by type
- [x] Backend tests cover adjustments, the mandatory reason, transfers and total conservation
- [x] Backend tests prove a failed transfer leaves no partial change
- [x] Frontend tests cover the adjustment and transfer forms and their validation
