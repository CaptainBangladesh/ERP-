# 06 — Recurring-expense scheduling: mechanism, and a rule conflict to check first

Type: research

## Question

Investigate how recurring expenses (rent, subscriptions) would actually generate on this
platform — but check a real tension before designing further. `docs/modules.md` states a module
may not "insert a row outside a user's action — the running application seeds nothing, ever,"
enforced by `check:conformance`. A cron-driven job writing expense rows with nobody making a
request looks exactly like what that rule forbids.

- Does that rule — and its conformance check — actually reach scheduled/background writes, or is
  it scoped to seed/bootstrap data only? Read what `check:conformance` actually enforces, not
  just the prose in `docs/modules.md`, to find out for certain.
- If background writes are genuinely disallowed, what's the compliant shape? For example: a due
  recurring expense sits as a pending draft until a user's next request into the company triggers
  generation, rather than a true unattended cron.
- Separately, as a fact-check: does any part of this platform already run scheduled or
  background work (a job queue, `@nestjs/schedule`, anything similar), or would this be the
  first?

This is a platform-level finding, not just an Expenses-module detail — the answer may affect any
future module that wants recurring behavior.
