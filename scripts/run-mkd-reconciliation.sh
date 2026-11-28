#!/usr/bin/env bash
set -euo pipefail
cd "$HOME/cto-weinstein-trader"
report=$(find /tmp/mkd-v4-acceptance -maxdepth 1 -type f -name 'mkd-acceptance-*.json' ! -name '*-coverage.json' ! -name '*-audit.json' ! -name '*-reconciliation.json' -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-)
[[ -f "$report" ]] || { echo "Acceptance report missing"; exit 2; }
tmp=$(mktemp /tmp/mkd-reconcile-XXXXXX.py)
trap 'rm -f "$tmp"' EXIT
git show origin/develop:scripts/mkd-reconcile-uncovered.py > "$tmp"
python3 -m py_compile "$tmp"
python3 "$tmp" "$report"
echo "=== Branch unchanged: $(git branch --show-current) ==="
