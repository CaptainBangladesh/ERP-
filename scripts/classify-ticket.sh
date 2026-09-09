#!/usr/bin/env bash
# classify-ticket.sh — deterministic pre-filter for ticket model routing.
#
# Scans a ticket markdown file for patterns that correlate with "needs a
# design/security pass" (Opus, high effort) vs "purely mechanical" (Sonnet,
# medium effort). Zero LLM cost — just grep — so run it before you even
# open a session.
#
# Signals come in two weights:
#   STRONG  a single hit is enough to want a design pass (public surface,
#           secrets, PII, redirects, money, an unanswered design question).
#   WEAK    ambient in this repo — nearly every ticket touches tenancy,
#           a platform integration, or the schema. One weak hit means
#           nothing; two or more together mean the ticket is broad.
#
# This is a heuristic, not a guarantee: it catches the obvious red flags
# (keywords), not novel risks described in plain prose with none of these
# words. Treat a clean run as "no obvious flags", not "definitely safe" —
# still worth a human/Opus glance on anything unfamiliar.
#
# Usage: ./scripts/classify-ticket.sh path/to/ticket.md
#        ./scripts/classify-ticket.sh --quiet path/to/ticket.md   # verdict only
#
# Exit code: 0 = Sonnet is fine, 1 = wants an Opus design pass, 2 = usage error.

set -euo pipefail

QUIET=0
if [[ "${1:-}" == "--quiet" ]]; then
  QUIET=1
  shift
fi

FILE="${1:-}"
if [[ -z "$FILE" ]]; then
  echo "Usage: $0 [--quiet] <ticket-file.md>" >&2
  exit 2
fi
if [[ ! -f "$FILE" ]]; then
  echo "File not found: $FILE" >&2
  exit 2
fi

# weight | label | extended-regex pattern (matched case-insensitively)
rules=(
  'STRONG|Public / unauthenticated surface|public route|unauthenticated|no auth|anonymous|@Public|GET [^ ]*:slug'
  'STRONG|Credentials & secrets|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|\bsecret|credential|oauth|password|encrypt'
  'STRONG|PII / personal data|\bssn\b|date of birth|\bdob\b|\bpii\b|personal data|customer data|email address|phone number|home address|billing address'
  'STRONG|Redirect / external link|redirect|buttonlink|outbound link|external url|shortlink|link builder|/b/:slug'
  'STRONG|Payment / financial|payment|invoice|stripe|billing|refund|payout'
  'STRONG|Hard reasoning (concurrency / correctness)|concurrenc|race condition|idempoten|deadlock|\block\b|distributed|rollback|backfill|invariant|reconcil|eventual consistency'
  'STRONG|Open design question|open question|\btbd\b|how should|design question|undecided'
  'WEAK|Third-party integration|integration|webhook|meta ads|google ads|tiktok|ad account|oauth app'
  'WEAK|Cross-tenant / authz filter|companyid|brandid|tenant|assignedtouserid|scoped to|access control|permission|authoriz'
  'WEAK|Schema or migration|prisma model|schema\.prisma|alter table|drop column|\brole\b|rbac|\bacl\b'
)

strong=0
weak=0
report=""

for rule in "${rules[@]}"; do
  weight="${rule%%|*}"
  rest="${rule#*|}"
  label="${rest%%|*}"
  pattern="${rest#*|}"

  matches="$(grep -inE "$pattern" "$FILE" || true)"
  [[ -z "$matches" ]] && continue

  if [[ "$weight" == "STRONG" ]]; then
    strong=$((strong + 1))
  else
    weak=$((weak + 1))
  fi
  report+=$'\n'"[$weight] $label"$'\n'"$(echo "$matches" | head -6 | sed 's/^/  /')"$'\n'
done

verdict_opus=0
if [[ "$strong" -gt 0 || "$weak" -ge 2 ]]; then
  verdict_opus=1
fi

if [[ "$QUIET" -eq 0 ]]; then
  echo "Classifying: $FILE"
  echo "======================================"
  if [[ -n "$report" ]]; then
    printf '%s' "$report"
  else
    echo ""
    echo "  (no signals matched)"
    echo ""
  fi
  echo "======================================"
  echo "Signals: $strong strong, $weak weak"
fi

if [[ "$verdict_opus" -eq 1 ]]; then
  echo "Recommendation: OPUS 5 (high effort) for the design/decision pass first."
  if [[ "$QUIET" -eq 0 ]]; then
    echo "Once those decisions are written down, delegate the mechanical CRUD/boilerplate"
    echo "to Sonnet 5 (medium effort)."
  fi
  exit 1
fi

echo "Recommendation: SONNET 5 (medium effort) — no obvious flags."
exit 0
