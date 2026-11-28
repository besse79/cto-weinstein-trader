#!/usr/bin/env bash
# Read-only 267-symbol MKD audit; leaves W branch, database and services unchanged.
set -euo pipefail
cd "$HOME/cto-weinstein-trader"
report=$(find /tmp/mkd-v4-acceptance -maxdepth 1 -type f -name 'mkd-acceptance-*.json' ! -name '*-coverage.json' ! -name '*-mkd-uncovered-audit.json' -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-)
[[ -n "$report" && -f "$report" ]] || { echo 'Acceptance report not found'; exit 2; }
tmp=$(mktemp /tmp/mkd-uncovered-audit-XXXXXX.mjs)
trap 'rm -f "$tmp"' EXIT
git show origin/develop:scripts/mkd-uncovered-audit.mjs > "$tmp"
echo "=== Auditing MKD against $report ==="
MKD_BASE_URL=http://127.0.0.1:8100 node "$tmp" "$report"
echo "=== Local branch unchanged: $(git branch --show-current) ==="
