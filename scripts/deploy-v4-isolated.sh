#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
ROOT="$HOME/cto-weinstein-trader"
PROJECT=cto_weinstein
BASE="$HOME/cto-weinstein-v4-releases"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RELEASE="$BASE/$STAMP"
mkdir -p "$RELEASE"
cd "$ROOT"
command -v docker >/dev/null
command -v git >/dev/null
test -f .env || { echo "BLOCKED: local .env absent"; exit 1; }
git fetch origin develop
OLD_WEB="$(docker compose -p "$PROJECT" ps -q web)"
test -n "$OLD_WEB" || { echo "BLOCKED: existing web service absent"; exit 1; }
OLD_IMAGE="$(docker inspect -f '{{.Image}}' "$OLD_WEB")"
echo "Previous web container: $OLD_WEB image: $OLD_IMAGE"
echo "=== Backup, before any deployment ==="
echo "Backing up PostgreSQL..."
docker compose -p "$PROJECT" exec -T db pg_dump -U trader -d trader -Fc </dev/null > "$RELEASE/trader.dump" || { echo "BLOCKED: pg_dump failed"; exit 2; }
echo "PostgreSQL dump created"
test -s "$RELEASE/trader.dump"
docker compose -p "$PROJECT" exec -T db pg_restore --list < "$RELEASE/trader.dump" > "$RELEASE/pg-restore-list.txt" || { echo "BLOCKED: pg_restore archive check failed"; exit 2; }
if ! grep -q "TABLE" "$RELEASE/pg-restore-list.txt"; then echo "BLOCKED: backup archive has no tables"; exit 2; fi
echo "Backing up local source..."
tar --exclude=.git --exclude=node_modules --exclude=.next -czf "$RELEASE/previous-source.tar.gz" -C "$ROOT" .
sha256sum "$RELEASE/trader.dump" "$RELEASE/previous-source.tar.gz" > "$RELEASE/SHA256SUMS"
(cd "$RELEASE" && sha256sum -c SHA256SUMS)
mkdir -p "$RELEASE/source"
git archive origin/develop | tar -xf - -C "$RELEASE/source"
cp "$ROOT/.env" "$RELEASE/source/.env"
cat > "$RELEASE/source/compose.v4.yml" <<'YAML'
services:
  web:
    environment:
      MKD_BASE_URL: http://host.docker.internal:8100
      MKD_SHADOW_ENABLED: "true"
YAML
COMPOSE=(docker compose -p "$PROJECT" -f "$RELEASE/source/docker-compose.yml" -f "$RELEASE/source/compose.v4.yml")
"${COMPOSE[@]}" config -q
echo "=== Check MKD reachability from Docker network ==="
docker run --rm -i=false --network "${PROJECT}_default" --add-host=host.docker.internal:host-gateway curlimages/curl:8.12.1 -fsS --max-time 10 http://host.docker.internal:8100/health/live </dev/null >/dev/null || {
 echo "BLOCKED: MKD 8100 not reachable from Docker; no deployment made"; exit 2;
}
echo "=== Test staged code without changing running web ==="
"${COMPOSE[@]}" run --rm -T --no-deps web sh -c 'npm install --no-audit --no-fund >/dev/null && npm test && npm run typecheck' </dev/null || {
 echo "BLOCKED: tests/typecheck failed; no deployment made"; exit 3;
}
rollback(){
 code=$?
 trap - ERR
 if [[ "${DEPLOY_STARTED:-0}" == 1 ]]; then
  echo "Deployment failed: recent web logs before rollback:"
  docker compose -p "$PROJECT" -f "$RELEASE/source/docker-compose.yml" -f "$RELEASE/source/compose.v4.yml" logs --tail=90 web 2>&1 || true
  echo "Rolling back original web container/source"
  docker compose -p "$PROJECT" -f "$ROOT/docker-compose.yml" up -d --no-deps --force-recreate web || true
 fi
 echo "Backup: $RELEASE"
 exit "$code"
}
trap rollback ERR
DEPLOY_STARTED=1
"${COMPOSE[@]}" up -d --no-deps --force-recreate web
echo "=== Post-deployment HTTP checks ==="
python3 - <<'PY'
import json,time,urllib.request,urllib.error
base='http://127.0.0.1:3010'
for attempt in range(8):
 try:
  print('Checking /api/scanner',flush=True)
  with urllib.request.urlopen(base+'/api/scanner',timeout=90) as r: scanner=json.load(r)
  assert isinstance(scanner.get('results'),list)
  assert all(x['currency'] in ('EUR','USD') for x in scanner['results'])
  assert all(x['symbol'] not in ('KESKOBU0126.HE','VSURE.ST','VYLR') for x in scanner['results'])
  print('Checking /api/paper-candidates',flush=True)
  with urllib.request.urlopen(base+'/api/paper-candidates',timeout=90) as r: paper=json.load(r)
  assert isinstance(paper.get('candidates'),list)
  assert all(x.get('currency','EUR') in ('EUR','USD') for x in paper['candidates'])
  print('Checking /api/mkd-shadow SAMPO',flush=True)
  with urllib.request.urlopen(base+'/api/mkd-shadow?symbol=SAMPO.HE&analysis=true',timeout=90) as r: shadow=json.load(r)
  assert shadow['symbol']=='SAMPO.HE' and shadow['mode']=='READ_ONLY_SHADOW'
  assert shadow['paperEligible'] is False and shadow['backtestEligible'] is False
  print(json.dumps({'scannerCount':len(scanner['results']),'paperCount':len(paper['candidates']),'sampo':shadow},indent=2))
  break
 except urllib.error.HTTPError as e:
  last=f'HTTP {e.code}: '+e.read(3000).decode(errors='replace')
  print('Attempt',attempt+1,'failed:',last,flush=True)
  time.sleep(3)
 except Exception as e:
  last=e
  print('Attempt',attempt+1,'failed:',repr(e),flush=True)
  time.sleep(3)
else: raise RuntimeError('Post-deployment checks failed: '+str(last))
PY
DEPLOY_STARTED=0
echo "V4 DEPLOYED AND VERIFIED; backup: $RELEASE"
echo "Local Git branches unchanged. DB unchanged except possible normal application activity."
