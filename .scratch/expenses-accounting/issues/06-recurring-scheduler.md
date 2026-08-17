# 06 — Recurring-expense scheduling: mechanism, and a rule conflict to check first

Type: research
Status: resolved

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

## Answer

**The rule conflict does not exist at the enforcement level.** `check:conformance` is a fixed
pack of 21 static text/import rules (verified exhaustive against `conformance.spec.ts`), and none
of them checks who or what triggered an insert — "was this write reached by an HTTP request" is
not a fact visible in source text at all. `docs/modules.md`'s claim that this is "refused by
`check:conformance`" is not accurate as literally written in code. The no-seed-data rule is real
as an architectural discipline (no seed scripts, no fixtures outside tests, migrations create
schema only) but is upheld by the absence of any code path that does it, not by a build check
catching an attempt.

Two shapes are both technically available; the platform has already anticipated this exact
scenario in ADR 0009 (which names "a payroll run on a schedule" and "a dunning notice" as the
trigger for building a real scheduler, and confirms `Tenancy.runInCompany` is the half-built seam
for it):

1. **True unattended cron**, using `Tenancy.runInCompany` for per-tenant context — not blocked by
   any check, but requires building the platform's first scheduling mechanism from scratch
   (nothing in this codebase runs on a timer today — confirmed by grep across every
   `package.json` and `backend/src` for job-queue/cron/timer usage). ADR 0009 frames that as a
   deliberate, priced-later platform decision, not something to back into quietly from one
   module's ticket.
2. **Lazy/pending-draft materialization** — a due recurrence is a user-created row that
   materializes into a real expense on the next authenticated request into that company. Every
   insert stays traceable to a real HTTP request, needs no new platform dependency, and matches
   the codebase's existing empty-state philosophy.

Recommendation: option 2, since it stays inside what this map's Expenses-module ticket can decide
on its own, without also deciding platform-wide scheduling infrastructure as a side effect.

Full findings, file citations, and the exhaustive rule-list evidence:
`.scratch/expenses-accounting/research/06-recurring-scheduler.md` (merged from branch
`research/recurring-scheduler`).
