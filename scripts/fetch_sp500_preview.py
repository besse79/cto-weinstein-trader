#!/usr/bin/env python3
"""Fetch a PUBLIC, THIRD-PARTY S&P 500 preview, never an authoritative index.

Downloads a bounded CSV from a fixed upstream GitHub source. No DB writes.
User must independently verify provenance and usage rights before importing.
"""
import argparse
import csv
from datetime import date
import hashlib
import io
from pathlib import Path
import sys
import urllib.request
from prepare_sp500_snapshot import convert
from import_index_universe import parse_csv

SOURCE = "https://raw.githubusercontent.com/chinobing/historical_sp500_constituents/main/sp500_constituents.csv"
LIMIT = 250_000

def fetch_preview(destination: Path, *, day: str):
    expected=date.fromisoformat(day)
    if expected.isoformat()!=day:
        raise ValueError("Invalid ISO date")
    req=urllib.request.Request(SOURCE,headers={"User-Agent":"CTO-Weinstein-V4.1-Research/1.0","Accept":"text/csv"})
    with urllib.request.urlopen(req,timeout=15) as response:
        if response.status!=200 or response.geturl()!=SOURCE:
            raise ValueError("Unexpected provider response or redirect")
        raw=response.read(LIMIT+1)
    if len(raw)>LIMIT:
        raise ValueError("Source exceeds allowed size")
    content=raw.decode("utf-8-sig")
    reader=csv.DictReader(io.StringIO(content))
    if not reader.fieldnames or not {"symbol","security","date"}.issubset(reader.fieldnames):
        raise ValueError("Unexpected upstream CSV columns")
    rows=list(reader)
    if not 490<=len(rows)<=520:
        raise ValueError(f"Suspicious constituent count: {len(rows)}")
    observed={r["date"].strip() for r in rows}
    if observed!={day}:
        raise ValueError(f"Snapshot date mismatch; observed {sorted(observed)} expected {day}")
    import tempfile
    with tempfile.TemporaryDirectory() as directory:
        src=Path(directory)/"source.csv"
        with src.open("w",newline="",encoding="utf-8") as fp:
            writer=csv.writer(fp)
            writer.writerow(["Symbol","Name"])
            for row in rows:
                writer.writerow([row["symbol"],row["security"]])
        count=convert(src,destination)
    if count!=len(parse_csv(destination)):
        raise ValueError("Output validation failure")
    return {"count":count,"source":SOURCE,"source_sha256":hashlib.sha256(raw).hexdigest(),
            "output_sha256":hashlib.sha256(destination.read_bytes()).hexdigest()}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("destination",type=Path)
    p.add_argument("--as-of",required=True,help="Exact upstream snapshot YYYY-MM-DD; never infer from current clock")
    args=p.parse_args()
    try:
        print(fetch_preview(args.destination,day=args.as_of))
        print("PREVIEW ONLY: third-party source, not licensed index proof; PostgreSQL untouched.")
        return 0
    except Exception as e:
        print("PREVIEW BLOCKED:",e,file=sys.stderr)
        return 1
if __name__=="__main__":
    raise SystemExit(main())
