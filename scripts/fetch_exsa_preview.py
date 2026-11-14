#!/usr/bin/env python3
"""One-shot public BlackRock EXSA holdings PREVIEW; no database writes.

No crawling, login bypass, proxies, hidden API guessing or background polling.
Constituents are ETF holdings, not an official STOXX Europe 600 index list.
"""
import argparse
import csv
from datetime import date
import hashlib
import io
from pathlib import Path
import sys
import urllib.parse
import urllib.request
from prepare_exsa_holdings_preview import snapshot_date,transform
from import_index_universe import parse_csv

SOURCE=("https://www.ishares.com/de/privatanleger/de/produkte/251931/"
        "ishares-stoxx-europe-600-ucits-etf-de-fund/latest-holdings.csv")
LIMIT=1_000_000

def fetch_preview(dest,*,as_of="auto"):
    if dest.exists():
        raise FileExistsError("Preview already exists; no overwrite")
    req=urllib.request.Request(SOURCE,headers={
        "User-Agent":"CTO-Weinstein-V4.1-Personal-Research/1.0",
        "Accept":"text/csv,*/*;q=0.1"
    })
    with urllib.request.urlopen(req,timeout=20) as response:
        target=urllib.parse.urlparse(response.geturl())
        if response.status!=200 or target.scheme!="https" or target.hostname not in {
            "www.ishares.com","www.blackrock.com"}:
            raise ValueError("Provider refused data or redirected outside official domain")
        raw=response.read(LIMIT+1)
    if len(raw)>LIMIT:
        raise ValueError("EXSA source too large")
    rows=list(csv.reader(io.StringIO(raw.decode("utf-8-sig"))))
    published=snapshot_date(rows[:25])
    if published is None:
        raise ValueError("No verified holdings effective date; download blocked")
    if as_of!="auto" and published.isoformat()!=as_of:
        raise ValueError(f"Source date mismatch: {published} vs {as_of}")
    normalized,report=transform(raw,published)
    dest.parent.mkdir(parents=True,exist_ok=True)
    with dest.open("x",encoding="utf-8",newline="") as fp:
        writer=csv.writer(fp)
        writer.writerow(["index_code","symbol","name","currency"])
        writer.writerows(normalized)
    if len(parse_csv(dest))!=len(normalized):
        dest.unlink(missing_ok=True)
        raise ValueError("Generated preview checksum/row validation failure")
    return {**report,"source_url":SOURCE,
            "output_sha256":hashlib.sha256(dest.read_bytes()).hexdigest()}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("destination",type=Path)
    p.add_argument("--as-of",default="auto",help="Check exact provider date, or auto (max 14 days old)")
    a=p.parse_args()
    try:
        print(fetch_preview(a.destination,as_of=a.as_of))
        print("PREVIEW ONLY; ETF holdings are not official index membership. Database untouched.")
        return 0
    except Exception as e:
        print("EXSA DOWNLOAD BLOCKED:",e,file=sys.stderr)
        return 1

if __name__=="__main__":
    raise SystemExit(main())
