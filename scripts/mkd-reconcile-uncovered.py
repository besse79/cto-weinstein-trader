#!/usr/bin/env python3
"""Read-only reconciliation of W uncovered symbols against MKD PostgreSQL.
Requires local psql and peer-authenticated MKD database; no writes or imports.
"""
import csv
import io
import json
import os
import re
import subprocess
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

if len(sys.argv) != 2:
    sys.exit("Usage: python3 mkd-reconcile-uncovered.py <acceptance-report.json>")
source = Path(sys.argv[1]).resolve()
report = json.loads(source.read_text())
if report.get("source") != "MKD_LEGACY_NON_PIT" or not isinstance(report.get("results"), list):
    sys.exit("Unsupported acceptance report")
symbols = [r["symbol"] for r in report["results"] if r.get("kind") == "NO_HISTORY"]
if len(symbols) != len(set(symbols)) or not symbols:
    sys.exit("Invalid uncovered list")
# Restrict connections to the local Unix socket. No credentials in report.
db = os.environ.get("MKD_DB_NAME", "market_data_hub")
user = os.environ.get("MKD_DB_USER", "benoit")
port = os.environ.get("MKD_DB_PORT", "5433")
if not re.fullmatch(r"[a-zA-Z_][a-zA-Z_0-9]*", db + "x") or not re.fullmatch(r"[a-zA-Z_][a-zA-Z_0-9]*", user + "x") or not port.isdigit():
    sys.exit("Invalid DB connection settings")
sql = """BEGIN TRANSACTION READ ONLY;
COPY (
 SELECT m.symbol, m.instrument_id::text, COALESCE(m.currency,''), COALESCE(m.name,''),
        COALESCE(count(b.id),0), COALESCE(min(b.session_date)::text,''), COALESCE(max(b.session_date)::text,'')
 FROM (
    SELECT symbol, instrument_id, currency, name FROM legacy_symbol_map
    UNION ALL
    SELECT i.symbol, i.instrument_id, i.currency, ins.name
    FROM instrument_identifiers i JOIN instruments ins ON ins.id=i.instrument_id
    WHERE NOT EXISTS (
      SELECT 1 FROM legacy_symbol_map lm WHERE upper(lm.symbol)=upper(i.symbol)
        AND lm.instrument_id=i.instrument_id
    )
 ) m
 LEFT JOIN eod_bars b ON b.instrument_id=m.instrument_id AND b.provider='yahoo' AND b.quality_status='legacy_unverified'
 GROUP BY m.symbol,m.instrument_id,m.currency,m.name
) TO STDOUT WITH (FORMAT CSV, HEADER TRUE);
ROLLBACK;"""
cmd = ["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-h", "/var/run/postgresql", "-p", port, "-U", user, "-d", db]
try:
    p = subprocess.run(cmd, input=sql, text=True, capture_output=True, timeout=90, check=True)
except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
    sys.exit(f"Read-only PostgreSQL query failed: {exc}")
rows = list(csv.DictReader(io.StringIO(p.stdout)))
# Exact matching only; ticker guesses and exchange suffix changes require manual approval.
by_symbol = {}
for row in rows:
    by_symbol.setdefault(row["symbol"].upper(), []).append(row)
result = []
for symbol in symbols:
    hits = by_symbol.get(symbol.upper(), [])
    if len(hits) > 1:
        status, action = "AMBIGUOUS_EXACT", "Resolve duplicate identifiers before any change"
    elif len(hits) == 1:
        status = "EXACT_WITH_BARS" if int(hits[0]["count"]) else "EXACT_WITHOUT_BARS"
        action = "Review source discrepancy" if status == "EXACT_WITH_BARS" else "Schedule collection after validation"
    else:
        status, action = "ABSENT_FROM_MKD_IDENTIFIERS", "Review identifiers and plan targeted collection"
    result.append({"symbol":symbol,"status":status,"action":action,"matches":hits})
counts = dict(Counter(x["status"] for x in result))
output = source.with_name(source.stem + "-reconciliation.json")
if output.exists():
    output = source.with_name(source.stem + "-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") + "-reconciliation.json")
data = {"generatedAt":datetime.now(timezone.utc).isoformat(),"readOnly":True,"backtestEligible":False,
        "mappingRows":len(rows),"requested":len(symbols),"counts":counts,"rows":result,
        "note":"No fuzzy matches inferred. ABSENT_FROM_LEGACY_MAP does not prove missing historical data under alternate tickers."}
with output.open("x") as f:
    json.dump(data,f,indent=2)
print(json.dumps({"report":str(output),"mappingRows":len(rows),"requested":len(symbols),"counts":counts},indent=2))
