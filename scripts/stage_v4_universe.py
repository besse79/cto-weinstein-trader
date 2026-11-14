#!/usr/bin/env python3
"""Stage audited SP500 + EXSA proxy snapshots in ONE PostgreSQL transaction.

Read-only by default. --apply is explicit, requires confirmed proxy scope,
a complete dated manifest, verified local source+PostgreSQL backup, and an
installed local WSL application. Does NOT download prices or create orders.
"""
import argparse
from datetime import date
import hashlib
import json
from pathlib import Path
import re
import sys

from import_index_universe import parse_csv,statement
from deploy_local import backup,check_prerequisites,docker,ROOT

EXPECTED={
 "SP500_PUBLIC_THIRD_PARTY":("SP500",490,520),
 "STOXX600_ETF_PROXY":("STOXX600_ETF_PROXY",570,640),
}

def file_hash(file):
    h=hashlib.sha256()
    with file.open("rb") as fp:
        for chunk in iter(lambda:fp.read(1048576),b""):
            h.update(chunk)
    return h.hexdigest()

def validate(manifest_file):
    manifest_file=Path(manifest_file).resolve(strict=True)
    folder=manifest_file.parent
    if manifest_file.name!="manifest.json":
        raise ValueError("Expected an unchanged manifest.json from the V4.1 preflight")
    data=json.loads(manifest_file.read_text(encoding="utf-8"))
    if data.get("status")!="PREVIEWS_COMPLETE":
        raise ValueError("Source preflight not complete: no import")
    sources=data.get("sources")
    if not isinstance(sources,dict):raise ValueError("Missing source records")
    parts=[]
    currencies={}
    all_symbols={}
    for key,(index,min_rows,max_rows) in EXPECTED.items():
        meta=sources.get(key)
        if not isinstance(meta,dict):raise ValueError(f"Missing validated {key}")
        target=Path(meta.get("file","")).resolve(strict=True)
        if target.parent!=folder or target.is_symlink() or not target.is_file():
            raise ValueError("Source CSV must be a regular file next to the manifest")
        digest=file_hash(target)
        recorded=meta.get("output_sha256") or meta.get("source_sha256")
        if recorded!=digest:raise ValueError(f"Source SHA256 mismatch: {key}")
        stamp=meta.get("snapshot_day")
        if not isinstance(stamp,str):
            raise ValueError(f"Missing verified dated snapshot: {key}")
        observed=date.fromisoformat(stamp)
        if observed.isoformat()!=stamp or not 0<=(date.today()-observed).days<=14:
            raise ValueError(f"Missing, future or stale snapshot: {key}")
        rows=parse_csv(target)
        if not min_rows<=len(rows)<=max_rows:
            raise ValueError(f"{key} count outside expected bounds")
        if {row[0] for row in rows}!={index}:
            raise ValueError(f"{key} file contains different index codes")
        if data.get("validated_rows",{}).get(index)!=len(rows):
            raise ValueError(f"{key} manifest and CSV row count differ")
        for _,symbol,_,currency in rows:
            if symbol in all_symbols and all_symbols[symbol]!=currency:
                raise ValueError(f"Ticker currency conflict between sources: {symbol}")
            all_symbols[symbol]=currency
            currencies[currency]=currencies.get(currency,0)+1
        parts.append({"name":key,"index":index,"date":stamp,
                      "rows":rows,"digest":digest,"source":meta.get("source_url") or meta.get("source") or key})
    if data.get("total_rows")!=sum(len(part["rows"]) for part in parts):
        raise ValueError("Manifest total mismatch")
    return parts,currencies

def transactional_sql(parts):
    body=["\\set ON_ERROR_STOP on","BEGIN;"]
    for part in parts:
        label=part["name"]+" "+part["date"]+" SHA256:"+part["digest"]
        statement_sql=statement(part["rows"],part["date"],label)
        fragment=statement_sql.split("BEGIN;",1)[1].rsplit("COMMIT;",1)[0]
        body.append(fragment)
    body.append("COMMIT;")
    return "\n".join(body)+"\n"

def apply(parts):
    # Avoid copying/overwriting the local application from a temporary
    # detached archive. Run from the deployed checkout with its .env.
    if not (ROOT/".env").is_file() or not (ROOT/".git").exists():
        raise ValueError("Only installed WSL repository with secrets/backup is allowed for --apply")
    check_prerequisites()
    initial=docker("--profile","automation","ps","-q","scheduler",capture=True)
    scheduler_running=bool(initial.stdout.strip())
    try:
        docker("--profile","automation","stop","scheduler")
        saved=backup()
        if not (saved/"postgres.dump").is_file():
            raise RuntimeError("Verified PostgreSQL backup mandatory; import cancelled")
        payload=transactional_sql(parts).encode("utf-8")
        docker("exec","-T","db","psql","-v","ON_ERROR_STOP=1",
               "-U","trader","-d","trader",input_data=payload)
        expected=sum(len(part["rows"]) for part in parts)
        # Verify the observations for each source/date; no order tables touched.
        for part in parts:
            query=("SELECT count(*) FROM index_constituent_observations "
                   "WHERE index_code='"+part["index"]+"' AND observed_on='"+
                   part["date"]+"'::date")
            out=docker("exec","-T","db","psql","-U","trader","-d","trader",
                       "-Atc",query,capture=True).stdout.decode().strip()
            if int(out)!=len(part["rows"]):
                raise RuntimeError("Post-import membership count mismatch; "
                                   "verified backup at "+str(saved))
        return str(saved)
    finally:
        if scheduler_running:
            docker("--profile","automation","up","-d","scheduler")

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("manifest",type=Path,help="V4.1 PREVIEWS_COMPLETE manifest.json")
    ap.add_argument("--apply",action="store_true",help="Insert after verified backup; no prices/orders")
    ap.add_argument("--acknowledge-proxy",action="store_true",help="Confirm EXSA holdings are NOT official index membership")
    args=ap.parse_args()
    try:
        parts,currencies=validate(args.manifest)
        print(json.dumps({"status":"VALIDATED","constituents":{x["index"]:len(x["rows"]) for x in parts},
                          "dates":{x["index"]:x["date"] for x in parts},
                          "currencies":currencies,
                          "note":"Catalog membership ONLY. No Yahoo histories or broker orders."},indent=2))
        if not args.apply:
            print("DRY RUN: no PostgreSQL writes. --apply requires --acknowledge-proxy.")
            return 0
        if not args.acknowledge_proxy:
            raise ValueError("--acknowledge-proxy required: ETF holdings are not official STOXX constituents")
        saved=apply(parts)
        print("APPLIED: two index observations in one transaction; prior backup:",saved)
        return 0
    except Exception as exc:
        print("V4 UNIVERSE STAGING BLOCKED:",exc,file=sys.stderr)
        return 1

if __name__=="__main__":
    raise SystemExit(main())
