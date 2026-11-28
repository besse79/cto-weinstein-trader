#!/usr/bin/env bash
set -euo pipefail
root="$HOME/cto-weinstein-trader"
cd "$root"
git fetch origin develop
tmp=$(mktemp -d /tmp/mkd-v4-final-XXXXXX)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/src" "$tmp/scripts" "$tmp/tests"
for file in src/mkd-legacy-adapter.mjs src/mkd-source-policy.mjs src/weinstein.mjs src/weinstein-explain.mjs src/weinstein-watch.mjs src/paper-candidates.mjs src/paper-risk.mjs scripts/mkd-v4-acceptance.mjs scripts/mkd-coverage-triage.mjs tests/mkd-legacy-adapter.test.js tests/mkd-paper-acceptance.test.js tests/mkd-source-policy.test.js; do
 git show "origin/develop:$file" > "$tmp/$file"
done
echo "=== Unit tests ==="
node --test "$tmp/tests/mkd-legacy-adapter.test.js" "$tmp/tests/mkd-paper-acceptance.test.js" "$tmp/tests/mkd-source-policy.test.js"
echo "=== API readiness ==="
curl --fail --silent --show-error --max-time 15 http://127.0.0.1:8100/health/live >/dev/null
curl --fail --silent --show-error --max-time 180 http://127.0.0.1:3010/api/scanner >/dev/null
echo "=== Read-only full-universe parity ==="
set +e
MKD_BASE_URL=http://127.0.0.1:8100 WEB_BASE_URL=http://127.0.0.1:3010 node "$tmp/scripts/mkd-v4-acceptance.mjs"
rc=$?
set -e
echo "=== Gate exit: $rc ==="
echo "=== Local W branch: $(git branch --show-current) ==="
echo "=== Local MKD branch: $(git -C "$HOME/market-data-hub" branch --show-current) ==="
echo "=== No source switch, no database writes ==="
exit "$rc"
