#!/usr/bin/env python3
"""Offline normalization of EXSA (BlackRock iShares) ETF holdings.

This is explicitly an ETF HOLDINGS PROXY, NOT the official STOXX 600 index.
Accept an iShares CSV exported by the authorized recipient. Never touches DB.
Unknown exchanges or unverifiable source dates fail closed by default.
"""
import argparse
import csv
import hashlib
import io
from datetime import date,datetime
from pathlib import Path
import re
import sys
from import_index_universe import parse_csv

SUFFIXES={
    "EURONEXT AMSTERDAM":".AS","EURONEXT PARIS":".PA",
    "EURONEXT BRUSSELS":".BR","EURONEXT LISBON":".LS",
    "EURONEXT DUBLIN":".IR","DEUTSCHE BOERSE XETRA":".DE",
    "XETRA":".DE","LONDON STOCK EXCHANGE":".L",
    "SIX SWISS EXCHANGE":".SW","SWISS EXCHANGE":".SW",
    "BORSA ITALIANA":".MI","BOLSA DE MADRID":".MC",
    "MADRID STOCK EXCHANGE":".MC","NASDAQ OMX STOCKHOLM":".ST",
    "NASDAQ STOCKHOLM":".ST","NASDAQ OMX COPENHAGEN":".CO",
    "NASDAQ COPENHAGEN":".CO","NASDAQ OMX HELSINKI":".HE",
    "NASDAQ HELSINKI":".HE","OSLO BORS ASA":".OL",
    "OSLO BORS":".OL","WARSAW STOCK EXCHANGE":".WA",
    "VIENNA STOCK EXCHANGE":".VI",
}
CURRENCY_SUFFIX={"SEK":".ST","DKK":".CO","NOK":".OL","PLN":".WA"}
MONTHS={
    "JAN":1,"FEB":2,"MAR":3,"APR":4,"MAY":5,"MAI":5,"JUN":6,
    "JUL":7,"AUG":8,"SEP":9,"OCT":10,"OKT":10,
    "NOV":11,"DEC":12,"DEZ":12
}
EQUITY_CLASSES={"EQUITY","AKTIEN","ACTIONS","ACCIONES"}
SUPPORTED={"EUR","USD","GBP","CHF","SEK","DKK","NOK","PLN"}
HEADER_TICKER={"TICKER","ISSUER TICKER","EMITTENTENTICKER"}
HEADER_ASSET={"ASSET CLASS","ANLAGEKLASSE","CLASSE D’ACTIFS"}
HEADER_EXCHANGE={"EXCHANGE","BOERSE","BÖRSE","BOURSE"}
HEADER_CURRENCY={"MARKET CURRENCY","MARKTWÄHRUNG","DEVISE DE MARCHÉ"}
HEADER_NAME={"NAME","NOM"}

def snapshot_date(prefix):
    for row in prefix[:20]:
        raw=" ".join(str(x) for x in row)
        for m in re.findall(r"(?<!\d)(20\d\d-\d\d-\d\d)(?!\d)",raw):
            try:return date.fromisoformat(m)
            except ValueError:pass
        for d,mon,y in re.findall(r"(?<!\d)(\d{1,2})[./-]([A-Za-zÄÖÜäöü]{3,10})[./-](20\d\d)",raw):
            number=MONTHS.get(mon.upper()[:3])
            if number:
                try:return date(int(y),number,int(d))
                except ValueError:pass
        for m,d,y in re.findall(r"([A-Za-z]{3})\s+(\d{1,2}),?\s+(20\d\d)",raw):
            number=MONTHS.get(m.upper())
            if number:
                try:return date(int(y),number,int(d))
                except ValueError:pass
    return None

def pick(fieldnames,options):
    return next((f for f in fieldnames if f.strip().upper() in options),None)

def exchange_suffix(value,currency):
    x=re.sub(r"[^A-Z0-9 ]"," ",value.upper())
    x=" ".join(x.split())
    for key,suffix in SUFFIXES.items():
        clean=re.sub(r"[^A-Z0-9 ]"," ",key)
        if clean in x:return suffix
    return CURRENCY_SUFFIX.get(currency) if x in {"NASDAQ OMX NORDIC","NASDAQ NORDIC"} else None

def transform(raw,expected_day):
    if not isinstance(raw,bytes) or not 100<=len(raw)<=1_000_000:
        raise ValueError("Invalid source size")
    txt=raw.decode("utf-8-sig")
    if "<html" in txt[:2000].lower() or "<!doctype" in txt[:2000].lower():
        raise ValueError("HTML login/consent page returned instead of holdings CSV")
    lines=list(csv.reader(io.StringIO(txt)))
    indexes=None;columns=None
    for n,row in enumerate(lines[:50]):
        if pick(row,HEADER_TICKER) and pick(row,HEADER_ASSET) and pick(row,HEADER_CURRENCY) and pick(row,HEADER_EXCHANGE):
            indexes=n
            columns=row
            break
    if indexes is None:
        raise ValueError("BlackRock ticker/asset class/currency/exchange headers not found")
    published=snapshot_date(lines[:indexes])
    if published!=expected_day:
        raise ValueError(f"ETF source date unverified or mismatched: {published}; requested {expected_day}")
    if (date.today()-published).days not in range(0,15):
        raise ValueError("ETF holdings snapshot is stale or future dated (>14 days)")
    ticker_col=pick(columns,HEADER_TICKER)
    asset_col=pick(columns,HEADER_ASSET)
    exchange_col=pick(columns,HEADER_EXCHANGE)
    currency_col=pick(columns,HEADER_CURRENCY)
    name_col=pick(columns,HEADER_NAME)
    if not name_col:raise ValueError("Name column missing")
    rows=[];unknown=[];seen=set();non_equities=0
    for original in lines[indexes+1:]:
        if len(original)!=len(columns):continue
        item=dict(zip(columns,original))
        if item[asset_col].strip().upper() not in EQUITY_CLASSES:
            non_equities+=1
            continue
        raw_ticker=item[ticker_col].strip().upper()
        if not raw_ticker or raw_ticker in {"-","N/A"}:continue
        currency=item[currency_col].strip().upper()
        if currency not in SUPPORTED:
            unknown.append((raw_ticker,"CURRENCY:"+currency));continue
        suffix=exchange_suffix(item[exchange_col],currency)
        if suffix is None:
            unknown.append((raw_ticker,"EXCHANGE:"+item[exchange_col]));continue
        ticker=re.sub(r"\s+","-",raw_ticker.strip(".").replace("/","-"))
        symbol=ticker+suffix
        name=item[name_col].strip()
        if not re.fullmatch(r"[A-Z0-9.^-]{1,24}",symbol) or not name or len(name)>180:
            unknown.append((raw_ticker,"INVALID_TICKER_OR_NAME"));continue
        if symbol in seen:raise ValueError(f"Duplicate mapped Yahoo symbol: {symbol}")
        seen.add(symbol)
        rows.append(("STOXX600_ETF_PROXY",symbol,name,currency))
    if unknown:
        samples=", ".join(f"{a}:{b}" for a,b in unknown[:12])
        raise ValueError(f"Unresolved ETF equity listings {len(unknown)}; {samples}")
    if not 570<=len(rows)<=640:
        raise ValueError(f"ETF equity holdings outside plausible count: {len(rows)}, non-equities: {non_equities}")
    return sorted(rows,key=lambda r:r[1]),{"snapshot_day":published.isoformat(),
      "holdings":len(rows),"non_equities":non_equities,
      "source_sha256":hashlib.sha256(raw).hexdigest(),
      "basis":"ISHARES_EXSA_ETF_HOLDINGS_PROXY_NOT_OFFICIAL_STOXX_INDEX"}

def convert(source,dest,as_of):
    if source.resolve()==dest.resolve() or dest.exists():
        raise ValueError("Source/output collision or existing snapshot")
    expected=date.fromisoformat(as_of)
    if expected.isoformat()!=as_of:raise ValueError("Invalid as-of date")
    raw=source.read_bytes()
    rows,report=transform(raw,expected)
    dest.parent.mkdir(parents=True,exist_ok=True)
    with dest.open("x",encoding="utf-8",newline="") as fp:
        writer=csv.writer(fp)
        writer.writerow(["index_code","symbol","name","currency"])
        writer.writerows(rows)
    if len(parse_csv(dest))!=len(rows):
        dest.unlink(missing_ok=True)
        raise ValueError("Generated preview failed validation")
    report["output_sha256"]=hashlib.sha256(dest.read_bytes()).hexdigest()
    return report

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("source",type=Path,help="Unmodified EXSA holdings CSV from iShares")
    p.add_argument("destination",type=Path)
    p.add_argument("--as-of",required=True,help="Date reported in source holdings file, YYYY-MM-DD")
    a=p.parse_args()
    try:
        print(convert(a.source,a.destination,a.as_of))
        print("PREVIEW ONLY: NOT a STOXX official index constituent list. PostgreSQL untouched.")
        return 0
    except Exception as exc:
        print("EXSA PREVIEW BLOCKED:",exc,file=sys.stderr)
        return 1
if __name__=="__main__":
    raise SystemExit(main())
