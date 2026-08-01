# 11 — Reversals and negative stock policy

**What to build:** A way to fix mistakes without hiding them, and a choice about how strict the
system is. When I record a movement wrongly I can reverse it — the original stays, the reversal is
recorded beside it, and history shows both. Nothing is ever quietly rewritten, which is what makes
the ledger worth trusting once it feeds accounting.

I can also decide, in company settings, whether the system refuses a movement that would drive
stock negative or merely warns me and allows it, because that depends on how the business operates.

**Blocked by:** 10 — Adjustments and transfers

**Status:** ready-for-agent

- [ ] I can reverse any recorded movement from its history entry
- [ ] A reversal is a new ledger entry; the original is never edited or deleted
- [ ] History shows the original and its reversal, clearly linked
- [ ] A movement already reversed cannot be reversed again
- [ ] Reversing restores the stock level to its prior value
- [ ] A reversal carries the accounting classification needed to reverse an entry later
- [ ] A company setting controls whether negative stock is refused or allowed with a warning
- [ ] I can change that setting myself in the application
- [ ] When set to refuse, a movement that would go negative is rejected with a clear explanation
- [ ] When set to allow, the movement succeeds and I am warned before and after
- [ ] Negative stock is displayed distinctly wherever stock levels appear
- [ ] The setting defaults to refusing, applied in code rather than by a seeded row
- [ ] Backend tests cover reversal, double-reversal refusal and both negative stock policies
- [ ] Frontend tests cover the reversal action, the warning and the settings screen
