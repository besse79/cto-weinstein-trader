#!/usr/bin/env python3
"""V4.1 index constituents: explicit licensed CSV snapshot, dry-run by default.

Input header: index_code,symbol,name,currency
index_code: SP500, STOXX600 or STOXX600_ETF_PROXY; symbol must be Yahoo-compatible.
The file must come from a source the operator is authorized to use.
No constituent lists are fabricated or scraped by this tool.
"""
import argparse
import csv
import hashlib
from datetime import date
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from deploy_local import backup, docker, check_prerequisites

SYMBOL = re.compile(r"^[A-Z0-9.^-]{1,24}$")
CURRENCIES = {"EUR", "USD", "GBP", "CHF", "SEK", "DKK", "NOK", "PLN"}
INDEXES = {"SP500", "STOXX600", "STOXX600_ETF_PROXY"}

def quote(value):
    # Hex-encoded UTF-8 SQL expression avoids interpolation hazards with
    # apostrophes, backslashes, embedded SQL and dollar-quote delimiters.
    return "convert_from(decode('" + value.encode("utf-8").hex() + "','hex'),'UTF8')"

def parse_csv(path):
    with path.open("r", newline="", encoding="utf-8-sig") as stream:
        reader = csv.DictReader(stream)
        if reader.fieldnames != ["index_code", "symbol", "name", "currency"]:
            raise ValueError("Required columns: index_code,symbol,name,currency")
        rows = []
        seen = set()
        by_symbol = {}
        for n, row in enumerate(reader, 2):
            index_code = (row["index_code"] or "").strip()
            symbol = (row["symbol"] or "").strip().upper()
            name = (row["name"] or "").strip()
            currency = (row["currency"] or "").strip().upper()
            if index_code not in INDEXES or not SYMBOL.fullmatch(symbol) or not name or len(name)>180 or currency not in CURRENCIES:
                raise ValueError(f"Invalid index constituent on CSV line {n}")
            if (index_code, symbol) in seen:
                raise ValueError(f"Duplicate constituent {index_code}/{symbol} on line {n}")
            seen.add((index_code,symbol))
            if symbol in by_symbol and by_symbol[symbol] != currency:
                raise ValueError(f"Conflicting currency for {symbol}")
            by_symbol[symbol] = currency
            rows.append((index_code,symbol,name,currency))
    if not rows:
        raise ValueError("Empty constituent file")
    return rows

def statement(rows, observed_on, source):
    sql = ["\\set ON_ERROR_STOP on", "BEGIN;", "SELECT pg_advisory_xact_lock(147041);"]
    sql.append("""CREATE TABLE IF NOT EXISTS index_constituent_observations (
      index_code TEXT NOT NULL CHECK (index_code IN ('SP500','STOXX600','STOXX600_ETF_PROXY')),
      instrument_id BIGINT NOT NULL REFERENCES instruments(id),
      observed_on DATE NOT NULL,
      source_label TEXT NOT NULL,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY(index_code,instrument_id,observed_on)
    );""")
    for index_code,symbol,name,currency in rows:
        vals = ",".join(map(quote,[symbol,name,currency]))
        # Existing instruments are never overwritten by a CSV snapshot.
        sql.append(f"INSERT INTO instruments(symbol,name,currency) VALUES({vals}) ON CONFLICT(symbol) DO NOTHING;")
        sql.append(f"""DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM instruments WHERE symbol={quote(symbol)} AND currency={quote(currency)}) THEN
            RAISE EXCEPTION 'Ticker/currency conflict for {symbol}';
          END IF;
        END $$;""")
        sql.append(f"""INSERT INTO index_constituent_observations(index_code,instrument_id,observed_on,source_label)
        SELECT {quote(index_code)},id,({quote(observed_on)})::date,{quote(source)}
        FROM instruments WHERE symbol={quote(symbol)}
        ON CONFLICT(index_code,instrument_id,observed_on) DO NOTHING;""")
    sql.append("COMMIT;")
    return "\n".join(sql)+"\n"

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("csv_path", type=Path)
    ap.add_argument("--as-of", required=True, help="Snapshot date YYYY-MM-DD")
    ap.add_argument("--source", required=True, help="Constituent data provenance label")
    ap.add_argument("--apply", action="store_true", help="Write DB only after verified backup")
    ap.add_argument("--allow-partial", action="store_true", help="Allow deliberate incomplete index snapshots; not a complete universe")
    args = ap.parse_args()
    try:
        if date.fromisoformat(args.as_of).isoformat() != args.as_of:
            raise ValueError("Invalid ISO date")
        if not 3 <= len(args.source) <= 120 or any(ord(c)<32 for c in args.source):
            raise ValueError("Source label required (3..120 chars)")
        rows = parse_csv(args.csv_path)
        counts = {key:sum(r[0]==key for r in rows) for key in sorted(INDEXES)}
        currencies = {key:sum(r[3]==key for r in rows) for key in sorted(CURRENCIES) if any(r[3]==key for r in rows)}
        digest=hashlib.sha256(args.csv_path.read_bytes()).hexdigest()
        print("Validated constituent snapshot:", counts, "currencies:",currencies)
        print("Source CSV SHA256:", digest)
        if args.apply and not args.allow_partial:
            limits={"SP500":(490,520),"STOXX600":(590,620),"STOXX600_ETF_PROXY":(570,640)}
            invalid={k:{"observed":n,"expected":list(limits[k])} for k,n in counts.items()
                     if n and not (limits[k][0]<=n<=limits[k][1])}
            if invalid:
                raise ValueError(f"Incomplete or oversized snapshot; refused: {invalid}. "
                                 "Use --allow-partial for an intentional research subset.")
        print("This is a snapshot, NOT independently verified current index membership.")
        if not args.apply:
            print("DRY RUN: database untouched; pass --apply after reviewing CSV provenance.")
            return 0
        check_prerequisites()
        location = backup()
        print("Verified pre-import backup:", location)
        sql=statement(rows,args.as_of,args.source + " [SHA256:" + digest + "]").encode()
        docker("exec","-T","db","psql","-v","ON_ERROR_STOP=1","-U","trader","-d","trader",input_data=sql)
        print("APPLIED: instrument catalog and dated index membership observations.")
        return 0
    except Exception as exc:
        print("IMPORT BLOCKED:",exc,file=sys.stderr)
        return 1

if __name__=="__main__":
    raise SystemExit(main())
