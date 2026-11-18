#!/usr/bin/env bash
set -euo pipefail
cd "$HOME/cto-weinstein-trader"
report=$(find /tmp/mkd-v4-acceptance -maxdepth 1 -type f -name '*-reconciliation.json' -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-)
[[ -f "$report" ]] || { echo "Missing reconciliation report"; exit 2; }
mkd="$HOME/market-data-hub"
[[ -d "$mkd/.git" ]] || { echo "Missing $mkd repository"; exit 2; }
git -C "$mkd" fetch origin feature/weinstein-legacy-migration
tmp=$(mktemp /tmp/mkd-stage-XXXXXX.py)
trap 'rm -f "$tmp"' EXIT
git -C "$mkd" show origin/feature/weinstein-legacy-migration:scripts/stage_targeted_yahoo.py > "$tmp"
python3 -m py_compile "$tmp"
venv=/tmp/mkd-yahoo-stage-venv
if [[ ! -x "$venv/bin/python" ]]; then python3 -m venv "$venv"; fi
"$venv/bin/python" -m pip install -q 'yfinance>=0.2.60,<2'
out="/tmp/mkd-targeted-stage-$(date -u +%Y%m%dT%H%M%SZ)"
"$venv/bin/python" "$tmp" "$report" --output "$out"
echo "=== W branch unchanged: $(git branch --show-current) ==="
echo "=== MKD branch unchanged: $(git -C "$mkd" branch --show-current) ==="
