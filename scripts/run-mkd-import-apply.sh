#!/usr/bin/env bash
set -euo pipefail
mkd="$HOME/market-data-hub"
stage="$HOME/market-data-hub-data/targeted-20261119T120134Z"
qualification="$stage/qualification-20261119T120733Z.json"
venv="$HOME/market-data-hub-data/.import-venv"
[[ -f "$stage/manifest.json" && -f "$qualification" && -x "$venv/bin/python" && -d "$mkd/.git" ]] || { echo "Missing validated input or import environment"; exit 2; }
command -v pg_dump >/dev/null
command -v pg_restore >/dev/null
git -C "$mkd" fetch origin feature/weinstein-legacy-migration
work=$(mktemp -d /tmp/mkd-apply-XXXXXX)
trap 'rm -rf "$work"' EXIT
git -C "$mkd" show origin/feature/weinstein-legacy-migration:scripts/import_qualified_targeted.py > "$work/import_qualified_targeted.py"
"$venv/bin/python" -m py_compile "$work/import_qualified_targeted.py"
backup="$HOME/market-data-hub-data/backups/pre-targeted-import-$(date -u +%Y%m%dT%H%M%SZ)"
echo "=== PREFLIGHT / READ ONLY ==="
"$venv/bin/python" "$work/import_qualified_targeted.py" "$stage" "$qualification" --backup-dir "$backup"
echo "=== APPLY 264 QUALIFIED INSTRUMENTS (BACKUP FIRST) ==="
"$venv/bin/python" "$work/import_qualified_targeted.py" "$stage" "$qualification" --backup-dir "$backup" --apply
echo "=== IMPORT COMPLETED ==="
echo "Backup: $backup"
echo "W branch: $(git -C "$HOME/cto-weinstein-trader" branch --show-current)"
echo "MKD branch: $(git -C "$mkd" branch --show-current)"
