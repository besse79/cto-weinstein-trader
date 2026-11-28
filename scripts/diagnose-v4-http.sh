#!/usr/bin/env bash
set -euo pipefail
cd "$HOME/cto-weinstein-trader"
echo '=== Current HTTP endpoints ==='
python3 - <<'PY'
import urllib.request,urllib.error
for path in ['/api/dashboard','/api/scanner','/api/paper-candidates','/api/mkd-shadow?symbol=SAMPO.HE&analysis=true']:
 try:
  with urllib.request.urlopen('http://127.0.0.1:3010'+path,timeout=90) as r:
   data=r.read(1600).decode(errors='replace')
   print(path,'HTTP',r.status,data[:1200])
 except urllib.error.HTTPError as e:
  print(path,'HTTP',e.code,e.read(1600).decode(errors='replace'))
 except Exception as e: print(path,type(e).__name__,str(e))
PY
echo '=== Web container configuration ==='
docker compose -p cto_weinstein ps web db
docker compose -p cto_weinstein logs --tail=65 web 2>&1 | tail -65
echo '=== MKD host connectivity from Docker ==='
docker run --rm -i=false --network cto_weinstein_default --add-host=host.docker.internal:host-gateway curlimages/curl:8.12.1 -sS -o /dev/null -w 'MKD /health/live HTTP %{http_code}\n' --max-time 10 http://host.docker.internal:8100/health/live </dev/null || true
echo '=== No changes made ==='
