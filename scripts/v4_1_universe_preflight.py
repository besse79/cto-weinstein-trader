#!/usr/bin/env python3
"""Create auditable, NON-DESTRUCTIVE 1,100-ticker research universe previews.

Separate public S&P 500 snapshot and EXSA ETF holdings proxy. No database,
broker, orders, scheduler, git operations, or existing application mutation.
"""
import json
import os
from datetime import datetime,timezone
from pathlib import Path
import sys
from import_index_universe import parse_csv
from fetch_sp500_preview import fetch_preview as fetch_us
from fetch_exsa_preview import fetch_preview as fetch_europe

OUTPUT_BASE=Path.home()/"cto-weinstein-previews"

def run(*,output_base=OUTPUT_BASE):
    timestamp=datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    folder=output_base/timestamp
    folder.mkdir(parents=True,mode=0o700,exist_ok=False)
    output={"status":"NOT_READY","folder":str(folder),"sources":{},
            "warning":"EXSA ETF holdings are a research proxy, NOT official STOXX 600 membership. No prices or databases imported."}
    try:
        us=folder/"sp500.csv"
        us_result=fetch_us(us,day="auto")
        output["sources"]["SP500_PUBLIC_THIRD_PARTY"]={**us_result,"file":str(us)}
    except Exception as e:
        output["sources"]["SP500_PUBLIC_THIRD_PARTY"]={"status":"BLOCKED","reason":str(e)}
    try:
        eu=folder/"exsa_etf_proxy.csv"
        eu_result=fetch_europe(eu,as_of="auto")
        output["sources"]["STOXX600_ETF_PROXY"]={**eu_result,"file":str(eu)}
    except Exception as e:
        output["sources"]["STOXX600_ETF_PROXY"]={"status":"BLOCKED","reason":str(e)}
    counts={}
    for name,filename in (("SP500",folder/"sp500.csv"),("STOXX600_ETF_PROXY",folder/"exsa_etf_proxy.csv")):
        if filename.exists():
            rows=parse_csv(filename)
            counts[name]=len(rows)
    output["validated_rows"]=counts
    output["total_rows"]=sum(counts.values())
    if counts.get("SP500",0)>=490 and counts.get("STOXX600_ETF_PROXY",0)>=570:
        output["status"]="PREVIEWS_COMPLETE"
    else:
        output["status"]="INCOMPLETE"
    return output

def main():
    try:
        result=run()
        print(json.dumps(result,indent=2,ensure_ascii=False))
        return 0 if result["status"]=="PREVIEWS_COMPLETE" else 1
    except Exception as e:
        print(json.dumps({"status":"ERROR","reason":str(e)},ensure_ascii=False),file=sys.stderr)
        return 2

if __name__=="__main__":
    raise SystemExit(main())
