# Model routing

Which model to open a ticket with, and why.

## The rule

| Model                    | Use it for                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| **Opus 5** (high effort) | Design and decision passes: anything with a public surface, secrets, PII, money, concurrency, or an unanswered question in the ticket. |
| **Sonnet 5** (medium)    | Mechanical execution once the decisions are written down: CRUD, DTOs, controllers, tests, UI wiring against a settled spec. |

Most tickets want **both**, in that order — Opus decides and writes the decisions into the
ticket, Sonnet implements them. Splitting that way is the point: paying Opus rates for
boilerplate is waste, and letting Sonnet invent a security boundary is how a `@Public()`
route ends up unvalidated.

## The pre-filter

`scripts/classify-ticket.sh` greps a ticket for the patterns that correlate with "needs a
design pass". Zero LLM cost — run it before opening a session:

```bash
./scripts/classify-ticket.sh .scratch/marketing-automation/issues/11-unblock-the-module-and-harden-the-public-surface.md
```

It prints the matching lines grouped by signal, then a recommendation. `--quiet` prints the
verdict only. Exit code is `0` for Sonnet, `1` for Opus, `2` for a usage error — so it
scripts:

```bash
for f in .scratch/<slug>/issues/*.md; do
  ./scripts/classify-ticket.sh --quiet "$f" >/dev/null || echo "opus: $f"
done
```

### Signals are weighted

- **STRONG** — one hit is enough. Public/unauthenticated surface, credentials & secrets,
  PII, redirects and external links, payments, hard reasoning (concurrency, idempotency,
  backfills, invariants), and open design questions.
- **WEAK** — ambient in this repo; nearly every ticket mentions tenancy, a platform
  integration, or a Prisma migration. One weak hit means nothing. **Two or more** together
  mean the ticket is broad enough to want a design pass anyway.

That weighting is calibrated, not guessed. The first draft treated every signal equally and
flagged 57 of the 66 tickets in `.scratch/` — a filter that says "Opus" 86% of the time
tells you nothing. Weighted, it splits 42/24. If you add a signal, re-run the calibration
loop above and check the split still discriminates.

## What it does not catch

- **Novel risk described in plain prose** with none of these words. A clean run means
  "no obvious flags", not "safe".
- **Difficulty that isn't risk.** The `Hard reasoning` signal covers the common vocabulary
  (locks, races, backfills), but a ticket can be genuinely hard with none of those words in
  it. If a ticket is unfamiliar territory, open it on Opus regardless of what the script says.
- **Ticket quality.** A vague ticket greps clean because there's nothing in it. Thin tickets
  want Opus for exactly that reason.

The script is a pre-filter, not an authority. It saves you reading 60 tickets to find the
6 that need care; it does not replace the judgement call on the one in front of you.
