#!/usr/bin/env bash
set -euo pipefail
mkd="$HOME/market-data-hub"
stage="$HOME/market-data-hub-data/targeted-20261119T120134Z"
qualification="$stage/qualification-20261119T120733Z.json"
[[ -f "$stage/manifest.json" && -f "$qualification" && -d "$mkd/.git" ]] || { echo "Required stage, qualification or MKD repository missing"; exit 2; }
git -C "$mkd" fetch origin feature/weinstein-legacy-migration
work=$(mktemp -d /tmp/mkd-import-XXXXXX)
trap 'rm -rf "$work"' EXIT
git -C "$mkd" show origin/feature/weinstein-legacy-migration:scripts/import_qualified_targeted.py > "$work/import_qualified_targeted.py"
venv="$HOME/market-data-hub-data/.import-venv"
if [[ ! -x "$venv/bin/python" ]]; then python3 -m venv "$venv"; fi
"$venv/bin/python" -m pip install --disable-pip-version-check 'psycopg[binary]>=3.1,<4'
"$venv/bin/python" -m py_compile "$work/import_qualified_targeted.py"
"$venv/bin/python" "$work/import_qualified_targeted.py" "$stage" "$qualification" --backup-dir "$HOME/market-data-hub-data/backups/pre-targeted-import-$(date -u +%Y%m%dT%H%M%SZ)"
echo "=== DRY RUN ONLY: no database writes ==="
echo "W branch: $(git -C "$HOME/cto-weinstein-trader" branch --show-current)"
echo "MKD branch: $(git -C "$mkd" branch --show-current)"
