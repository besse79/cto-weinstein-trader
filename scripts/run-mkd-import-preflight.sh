#!/usr/bin/env bash
set -euo pipefail
mkd="$HOME/market-data-hub"
stage="$HOME/market-data-hub-data/targeted-20261119T120134Z"
[[ -f "$stage/manifest.json" && -d "$mkd/.git" ]] || { echo "Persistent stage or MKD repository missing"; exit 2; }
git -C "$mkd" fetch origin feature/weinstein-legacy-migration
tmp=$(mktemp /tmp/mkd-preflight-XXXXXX.py)
trap 'rm -f "$tmp"' EXIT
git -C "$mkd" show origin/feature/weinstein-legacy-migration:scripts/preflight_targeted_import.py > "$tmp"
python3 -m py_compile "$tmp"
python3 "$tmp" "$stage"
echo "No PostgreSQL writes. W branch: $(git -C "$HOME/cto-weinstein-trader" branch --show-current)"
