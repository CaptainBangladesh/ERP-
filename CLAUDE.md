# CLAUDE.md

## Agent skills

### Issue tracker

Issues live as markdown files under `.scratch/<feature-slug>/` in this repo. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Model routing

Before opening a ticket, run `./scripts/classify-ticket.sh <ticket.md>` to decide whether it
needs an Opus design pass or is Sonnet-mechanical. See `docs/agents/model-routing.md`.
