#!/usr/bin/env python3
"""Build an auditable SP500 snapshot from a permitted Symbol,Name CSV.

Does not access PostgreSQL. Input is a LOCAL CSV, never fetched implicitly.
A provider's historical or current memberships must be independently checked.
"""
import argparse
import csv
import hashlib
from pathlib import Path
import sys

from import_index_universe import SYMBOL, parse_csv

def convert(source: Path, dest: Path):
    if source.resolve() == dest.resolve():
        raise ValueError("Source and destination must differ")
    with source.open(newline="",encoding="utf-8-sig") as f:
        reader=csv.DictReader(f)
        if not reader.fieldnames or not {"Symbol","Name"}.issubset(set(reader.fieldnames)):
            raise ValueError("Expected Symbol and Name columns")
        rows=[]
        seen=set()
        for index,row in enumerate(reader,2):
            symbol=(row.get("Symbol") or "").strip().upper().replace(".","-")
            name=(row.get("Name") or "").strip()
            if not SYMBOL.fullmatch(symbol) or not name or len(name)>180:
                raise ValueError(f"Invalid row {index}: ticker/name")
            if symbol in seen:
                raise ValueError(f"Duplicate ticker {symbol}")
            seen.add(symbol)
            rows.append(("SP500",symbol,name,"USD"))
    if not 490 <= len(rows) <= 520:
        raise ValueError(f"Unexpected S&P 500 component count: {len(rows)}")
    if dest.exists():
        raise FileExistsError("Destination exists: refusing to overwrite previous snapshot")
    dest.parent.mkdir(parents=True,exist_ok=True)
    with dest.open("x",newline="",encoding="utf-8") as out:
        w=csv.writer(out)
        w.writerow(["index_code","symbol","name","currency"])
        w.writerows(rows)
    # Re-parse our own output with the production validator.
    assert len(parse_csv(dest)) == len(rows)
    return len(rows)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("source",type=Path)
    p.add_argument("destination",type=Path)
    a=p.parse_args()
    try:
        size=convert(a.source,a.destination)
        print("SP500 preview",size,"tickers",
              "source_sha256",hashlib.sha256(a.source.read_bytes()).hexdigest(),
              "output_sha256",hashlib.sha256(a.destination.read_bytes()).hexdigest())
        print("No database touched. Source must be licensed and constituent date verified before apply.")
        return 0
    except Exception as e:
        print("SNAPSHOT BLOCKED:",e,file=sys.stderr)
        return 1

if __name__=="__main__":
    raise SystemExit(main())
