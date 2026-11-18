#!/usr/bin/env bash
# One-command, read-only MKD V4 acceptance. Does not change checked-out branch.
set -u
ROOT="$HOME/cto-weinstein-trader"
TMP="/tmp/mkd-v4-release"
cd "$ROOT" || exit 1
mkdir -p "$TMP/src" "$TMP/scripts" "$TMP/tests"
for file in src/mkd-legacy-adapter.mjs src/mkd-source-policy.mjs src/weinstein.mjs src/weinstein-explain.mjs src/weinstein-watch.mjs src/paper-candidates.mjs src/paper-risk.mjs scripts/mkd-v4-acceptance.mjs tests/mkd-legacy-adapter.test.js tests/mkd-paper-acceptance.test.js tests/mkd-source-policy.test.js; do
  git show "origin/develop:$file" > "$TMP/$file" || { echo "Missing $file"; exit 1; }
done
echo "=== MKD adapter unit tests ==="
node --test "$TMP/tests/mkd-legacy-adapter.test.js" "$TMP/tests/mkd-paper-acceptance.test.js" "$TMP/tests/mkd-source-policy.test.js" || exit 1
echo "=== MKD health ==="
curl --fail --silent --show-error --max-time 10 "http://127.0.0.1:8100/health/live" >/dev/null || exit 1
echo "=== Weinstein health ==="
curl --fail --silent --show-error --max-time 180 "http://127.0.0.1:3010/api/scanner" >/dev/null || exit 1
echo "=== Full universe, stage, signal, PAPER and stop parity ==="
MKD_BASE_URL=http://127.0.0.1:8100 WEB_BASE_URL=http://127.0.0.1:3010 node "$TMP/scripts/mkd-v4-acceptance.mjs"
result=$?
echo "=== Acceptance exit code: $result ==="
echo "=== Local branch unchanged: $(git branch --show-current) ==="
exit "$result"
