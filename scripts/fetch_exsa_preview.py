#!/usr/bin/env python3
"""Single-request-at-a-time EXSA ETF holdings PREVIEW, never a DB import.

Try only documented BlackRock/iShares holdings download URLs. Stop if the
provider refuses access. Never bypass authentication, challenges or robots.
Supports an authorized, manually downloaded original CSV as a fallback.
The output is a *proxy*, not official STOXX 600 index membership.
"""
import argparse
import csv
import hashlib
import io
from pathlib import Path
import sys
import urllib.error
import urllib.parse
import urllib.request
from prepare_exsa_holdings_preview import snapshot_date,transform
from import_index_universe import parse_csv

BASE=("https://www.ishares.com/de/privatanleger/de/produkte/251931/"
      "ishares-stoxx-europe-600-ucits-etf-de-fund/")
# The newest /latest-holdings.csv link on the BlackRock page returned 404
# on 2026-11-14. The alternative legacy AJAX URL is documented by
# tidy-finance's STOXX Europe 600 index data source.
SOURCE=BASE+"1478358465952.ajax?fileType=csv&fileName=EXSA_holdings&dataType=fund"
LEGACY_CH=("https://www.ishares.com/ch/professionelle-anleger/de/produkte/251931/"
           "ishares-stoxx-europe-600-ucits-etf-de-fund/"
           "1495092304805.ajax?fileType=csv&fileName=EXSA_holdings&dataType=fund")
NEW_URL=BASE+"latest-holdings.csv"
URLS=(SOURCE,LEGACY_CH,NEW_URL)
LIMIT=1_000_000

def _validate_raw(raw,as_of):
    if not 100<=len(raw)<=LIMIT:
        raise ValueError("EXSA source too large or not a holdings CSV")
    rows=list(csv.reader(io.StringIO(raw.decode("utf-8-sig"))))
    published=snapshot_date(rows[:25])
    if published is None:
        raise ValueError("No verifiable holdings date in CSV")
    if as_of!="auto" and published.isoformat()!=as_of:
        raise ValueError(f"Source date mismatch: {published} != {as_of}")
    return transform(raw,published)

def _get(url):
    req=urllib.request.Request(url,headers={
        "User-Agent":"CTO-Weinstein-V4.1-Personal-Research/1.0",
        "Accept":"text/csv,application/octet-stream;q=0.5,*/*;q=0.1"
    })
    with urllib.request.urlopen(req,timeout=20) as response:
        target=urllib.parse.urlparse(response.geturl())
        if response.status!=200 or target.scheme!="https" or target.hostname not in {
            "www.ishares.com","www.blackrock.com"}:
            raise ValueError("Provider refused CSV or redirected outside official domain")
        return response.read(LIMIT+1)

def fetch_preview(dest,*,as_of="auto",local_file=None):
    dest=Path(dest)
    if dest.exists():
        raise FileExistsError("Preview already exists; no overwrite")
    if as_of!="auto":
        from datetime import date
        if date.fromisoformat(as_of).isoformat()!=as_of:
            raise ValueError("Invalid as-of")
    tried=[]
    if local_file is not None:
        source=Path(local_file)
        if not source.is_file() or source.resolve()==dest.resolve():
            raise ValueError("Authorized original holdings CSV is missing or output collides")
        if source.stat().st_size>LIMIT:
            raise ValueError("Local EXSA source too large")
        raw=source.read_bytes()
        normalized,report=_validate_raw(raw,as_of)
        used="LOCAL_AUTHORIZED_ISHARES_CSV"
    else:
        normalized=report=raw=used=None
        for url in URLS:
            try:
                candidate=_get(url)
                parsed,summary=_validate_raw(candidate,as_of)
                raw=candidate;normalized=parsed;report=summary;used=url
                break
            except urllib.error.HTTPError as exc:
                tried.append(f"HTTP {exc.code} at {urllib.parse.urlsplit(url).path.rsplit('/',1)[-1]}")
                if exc.code in (401,403,429):
                    raise ValueError("BlackRock explicitly refused/rate limited; stopping: "+str(exc.code)) from exc
            except urllib.error.URLError as exc:
                tried.append("BlackRock URL network error: "+str(exc.reason)[:120])
            except (ValueError,UnicodeDecodeError,csv.Error) as exc:
                tried.append(str(exc)[:160])
        if used is None:
            raise ValueError("EXSA CSV not available from published endpoints; "+
                             "; ".join(tried)+
                             ". Use official download in browser and --exsa-file.")
    dest.parent.mkdir(parents=True,exist_ok=True)
    with dest.open("x",encoding="utf-8",newline="") as fp:
        writer=csv.writer(fp)
        writer.writerow(["index_code","symbol","name","currency"])
        writer.writerows(normalized)
    if len(parse_csv(dest))!=len(normalized):
        dest.unlink(missing_ok=True)
        raise ValueError("Generated preview validation failure")
    return {**report,"source_url":used,
            "output_sha256":hashlib.sha256(dest.read_bytes()).hexdigest()}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("destination",type=Path)
    p.add_argument("--as-of",default="auto",help="Exact provider date or auto (<=14 days)")
    p.add_argument("--exsa-file",type=Path,help="Previously downloaded original BlackRock EXSA CSV")
    a=p.parse_args()
    try:
        print(fetch_preview(a.destination,as_of=a.as_of,local_file=a.exsa_file))
        print("PREVIEW ONLY; not an official index composition. PostgreSQL untouched.")
        return 0
    except Exception as e:
        print("EXSA PREVIEW BLOCKED:",e,file=sys.stderr)
        return 1

if __name__=="__main__":
    raise SystemExit(main())
