#!/usr/bin/env bash
set -euo pipefail
mkd="$HOME/market-data-hub"
[[ -d "$mkd/.git" ]] || { echo "Missing MKD repository"; exit 2; }
first="/tmp/mkd-targeted-stage-20261118T221339Z"
retry="/tmp/mkd-targeted-retry-20261119T070550Z"
[[ -f "$first/manifest.json" && -f "$retry/manifest.json" ]] || { echo "Staged files missing; no changes"; exit 2; }
git -C "$mkd" fetch origin feature/weinstein-legacy-migration
tmp=$(mktemp /tmp/mkd-persist-XXXXXX.py)
trap 'rm -f "$tmp"' EXIT
git -C "$mkd" show origin/feature/weinstein-legacy-migration:scripts/persist_targeted_stage.py > "$tmp"
python3 -m py_compile "$tmp"
dest="$HOME/market-data-hub-data/targeted-$(date -u +%Y%m%dT%H%M%SZ)"
python3 "$tmp" --first "$first" --retry "$retry" --destination "$dest"
echo "=== Branch W: $(git -C "$HOME/cto-weinstein-trader" branch --show-current) ==="
echo "=== Branch MKD: $(git -C "$mkd" branch --show-current) ==="
