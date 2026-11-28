#!/usr/bin/env bash
set -euo pipefail
export PGHOST=/var/run/postgresql PGPORT=5433 PGUSER=benoit PGDATABASE=market_data_hub
command -v psql >/dev/null
echo "=== DATABASE POST-IMPORT AUDIT ==="
psql -X -v ON_ERROR_STOP=1 -P pager=off <<'SQL'
SELECT current_database() AS database, current_user AS db_user;
SELECT (SELECT count(*) FROM instruments) AS instruments,
       (SELECT count(*) FROM eod_bars) AS bars,
       (SELECT count(*) FROM legacy_symbol_map) AS legacy_mappings;
SELECT count(*) AS imported_instruments
FROM instrument_identifiers
WHERE provider='yahoo' AND symbol IN
 (SELECT symbol FROM legacy_symbol_map WHERE mic_verified=FALSE);
SELECT quality_status, count(*) AS bars
FROM eod_bars GROUP BY quality_status ORDER BY quality_status;
SELECT count(*) AS provenance_violations
FROM eod_bars
WHERE quality_status='legacy_unverified'
  AND (published_at IS NOT NULL OR first_available_at IS NOT NULL);
SELECT count(*) AS duplicate_bars
FROM (SELECT instrument_id,session_date,provider,revision
      FROM eod_bars GROUP BY 1,2,3,4 HAVING count(*)>1) t;
SELECT count(*) AS broken_identifier_links
FROM instrument_identifiers i LEFT JOIN instruments t ON t.id=i.instrument_id
WHERE t.id IS NULL;
SELECT count(*) AS broken_bar_links
FROM eod_bars b LEFT JOIN instruments t ON t.id=b.instrument_id
WHERE t.id IS NULL;
SQL
echo "=== BACKUP INTEGRITY ==="
backup="$HOME/market-data-hub-data/backups/pre-targeted-import-20261119T170704Z"
(cd "$backup" && sha256sum -c backup.sha256)
pg_restore -l "$backup/market_data_hub.dump" >/dev/null
echo "=== AUDIT COMPLETE, NO WRITES ==="
