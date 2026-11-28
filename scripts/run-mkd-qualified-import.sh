#!/usr/bin/env bash
set -euo pipefail
mkd="$HOME/market-data-hub"
stage="$HOME/market-data-hub-data/targeted-20261119T120134Z"
venv="/tmp/mkd-yahoo-stage-venv"
[[ -f "$stage/manifest.json" && -d "$mkd/.git" && -x "$venv/bin/python" ]] || { echo "Stage/MKD/yfinance venv missing; no database changes"; exit 2; }
git -C "$mkd" fetch origin feature/weinstein-legacy-migration
work=$(mktemp -d /tmp/mkd-import-XXXXXX)
trap 'rm -rf "$work"' EXIT
for f in qualify_targeted_yahoo.py import_qualified_targeted.py; do
 git -C "$mkd" show "origin/feature/weinstein-legacy-migration:scripts/$f" > "$work/$f"
 "$venv/bin/python" -m py_compile "$work/$f"
done
qualification="$stage/qualification-$(date -u +%Y%m%dT%H%M%SZ).json"
"$venv/bin/python" "$work/qualify_targeted_yahoo.py" "$stage" --output "$qualification"
backup="$HOME/market-data-hub-data/backups/pre-targeted-import-$(date -u +%Y%m%dT%H%M%SZ)"
"$venv/bin/python" "$work/import_qualified_targeted.py" "$stage" "$qualification" --backup-dir "$backup"
echo "=== QUALIFICATION AND DRY-RUN COMPLETE ==="
echo "Qualification: $qualification"
echo "No database writes yet. To authorize import, inspect qualification and use reviewed apply procedure."
echo "W branch: $(git -C "$HOME/cto-weinstein-trader" branch --show-current)"
echo "MKD branch: $(git -C "$mkd" branch --show-current)"
