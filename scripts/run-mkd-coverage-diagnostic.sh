#!/usr/bin/env bash
set -euo pipefail
export PGHOST=/var/run/postgresql PGPORT=5433 PGUSER=benoit PGDATABASE=market_data_hub
echo "=== MKD DB vs W DB (read-only) ==="
psql -X -v ON_ERROR_STOP=1 -P pager=off <<'SQL'
SELECT count(*) AS mkd_instruments FROM instruments;
SELECT count(*) AS mkd_legacy_maps FROM legacy_symbol_map;
SELECT symbol,currency,mic,mic_verified FROM legacy_symbol_map
WHERE symbol IN ('COLO-B.CO','DCC.L','VSURE.ST','VYLR')
ORDER BY symbol;
SQL
echo "=== MKD API resolution ==="
for symbol in COLO-B.CO DCC.L VSURE.ST VYLR; do
 echo "Symbol $symbol"
 curl -sS --max-time 15 -o /tmp/mkd-check-response-$$ -w 'HTTP %{http_code}\n' --get --data-urlencode "symbol=$symbol" http://127.0.0.1:8100/v1/legacy/resolve
 head -c 350 /tmp/mkd-check-response-$$; echo
done
rm -f /tmp/mkd-check-response-$$
echo "=== W local database coverage ==="
docker compose -p cto_weinstein exec -T db psql -U trader -d trader -X -v ON_ERROR_STOP=1 -P pager=off <<'SQL'
SELECT count(*) AS instruments FROM instruments;
SELECT count(*) AS instruments_without_candles
FROM instruments i WHERE NOT EXISTS (SELECT 1 FROM candles c WHERE c.instrument_id=i.id);
SELECT i.symbol,i.currency,count(c.day) AS bars
FROM instruments i LEFT JOIN candles c ON c.instrument_id=i.id
WHERE i.symbol IN ('COLO-B.CO','DCC.L','VSURE.ST','VYLR')
GROUP BY i.symbol,i.currency ORDER BY i.symbol;
SQL
echo "=== Diagnostic complete, no writes ==="
