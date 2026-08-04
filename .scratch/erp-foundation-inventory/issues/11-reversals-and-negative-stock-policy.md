# 11 — Reversals and negative stock policy

**What to build:** A way to fix mistakes without hiding them, and a choice about how strict the
system is. When I record a movement wrongly I can reverse it — the original stays, the reversal is
recorded beside it, and history shows both. Nothing is ever quietly rewritten, which is what makes
the ledger worth trusting once it feeds accounting.

I can also decide, in company settings, whether the system refuses a movement that would drive
stock negative or merely warns me and allows it, because that depends on how the business operates.

**Blocked by:** 10 — Adjustments and transfers

**Status:** done, except the three criteria carried to 19

- [x] I can reverse any recorded movement from its history entry
- [x] A reversal is a new ledger entry; the original is never edited or deleted
- [x] History shows the original and its reversal, clearly linked
- [x] A movement already reversed cannot be reversed again
- [x] Reversing restores the stock level to its prior value
- [x] A reversal carries the accounting classification needed to reverse an entry later
- [x] A company setting controls whether negative stock is refused or allowed with a warning
- [x] I can change that setting myself in the application
- [x] When set to refuse, a movement that would go negative is rejected with a clear explanation
- [ ] When set to allow, the movement succeeds and I am warned before and after
- [ ] Negative stock is displayed distinctly wherever stock levels appear
- [x] The setting defaults to refusing, applied in code rather than by a seeded row
- [x] Backend tests cover reversal, double-reversal refusal and both negative stock policies
- [ ] Frontend tests cover the reversal action, the warning and the settings screen

## Comments

**2026-08-04 — three boxes un-ticked, from ticket 14's review.**

This ticket was found in the tree marked done with every box ticked. Three of them are not met,
and they are un-ticked above rather than argued about. All three are the *warning* half of the
policy — the half that only shows up when a company has chosen to allow negative stock, which is
not the default, which is why nothing noticed.

- **"When set to allow, the movement succeeds and I am warned before and after."** The movement
  succeeds. Nothing warns, at either moment. `grep -i warn` across the inventory contract, the
  backend module and the frontend module finds one hit, and it is the sentence on the settings
  screen *describing* the behaviour. There is no field on the movement response saying a movement
  went negative, so the screen has nothing to warn from even if it wanted to.
- **"Negative stock is displayed distinctly wherever stock levels appear."** `StockPage` does it
  properly — red, semibold, and a "Negative" chip. `ValuationPage` renders per-product and
  per-location quantities with no such treatment, and it is a place stock levels appear.
- **"Frontend tests cover the reversal action, the warning and the settings screen."** Reversal
  and settings are covered. The warning is not, because it does not exist; and `StockPage.test.tsx`
  was not touched, so the negative display that *was* built is untested.

Issue 19 carries all three, together with the rest of what the review found in tickets 11–13.

The refused path is complete and well covered — `negativeStockRefused` names the location, the
product, what is on the shelf and what was asked for, and the backend suite exercises both
policies. What is missing is everything on the permissive branch, which is the branch a company
chooses precisely because it knows its stock figures will sometimes be wrong and wants to be told.
