#!/usr/bin/env python3
"""Read-only diagnosis of the six Yahoo 5y OHLCV outliers from V4.1 WSL.

No PostgreSQL, app token, order, source or scheduler changes. The reporter
uses exactly the raw Yahoo chart API and the same checks as src/yahoo-market.mjs;
a failure here does not imply any previous database import was modified.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import json
import math
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

SYMBOLS=("AAF.L","AAL.L","ABDN.L","AKER.OL","ABF.L","ADM.L")
BASE="https://query1.finance.yahoo.com/v8/finance/chart/"
MAX_EXAMPLES=4

def audit_series(payload,symbol):
    result=payload.get("chart",{}).get("result")
    if not isinstance(result,list) or len(result)!=1:
        raise ValueError("Yahoo JSON chart result missing or multiple")
    chart=result[0]
    meta=chart.get("meta",{})
    if meta.get("symbol")!=symbol:
        raise ValueError("Yahoo ticker mismatch")
    quotes=chart.get("indicators",{}).get("quote",[])
    timestamps=chart.get("timestamp",[])
    if not isinstance(quotes,list) or len(quotes)!=1 or not isinstance(timestamps,list):
        raise ValueError("Invalid Yahoo OHLCV arrays")
    data=quotes[0]
    for key in ("open","high","low","close","volume"):
        if not isinstance(data.get(key),list) or len(data[key])!=len(timestamps):
            raise ValueError("Incomplete column "+key)
    issues=Counter()
    examples=[]
    magnitude={}
    for index,timestamp in enumerate(timestamps):
        # The app uses exchange local timezone dates; UTC date here identifies
        # the raw Yahoo timestamp for diagnosis only, not for persistence.
        when=datetime.fromtimestamp(timestamp,timezone.utc).date().isoformat()
        values={key:data[key][index] for key in ("open","high","low","close","volume")}
        if all(v is None for v in values.values()):
            continue
        o,h,l,c,v=(values[k] for k in ("open","high","low","close","volume"))
        valid_prices=all(isinstance(x,(int,float)) and not isinstance(x,bool) and
                         math.isfinite(x) and x>0 for x in (o,h,l,c))
        reason=[]
        if not valid_prices:reason.append("NON_POSITIVE_OR_NULL_PRICE")
        else:
            if h<max(o,l,c):
                reason.append("HIGH_BELOW_OPEN_LOW_CLOSE")
                mag=(max(o,l,c)-h)/max(o,l,c)
                magnitude["high_max_relative_gap"]=max(magnitude.get("high_max_relative_gap",0),mag)
            if l>min(o,h,c):
                reason.append("LOW_ABOVE_OPEN_HIGH_CLOSE")
                mag=(l-min(o,h,c))/l
                magnitude["low_max_relative_gap"]=max(magnitude.get("low_max_relative_gap",0),mag)
        if not isinstance(v,int) or isinstance(v,bool) or v<0:
            reason.append("INVALID_VOLUME")
        if reason:
            issues.update(reason)
            if len(examples)<MAX_EXAMPLES:
                examples.append({"timestamp_utc":when,"reason":reason,"raw_ohlcv":values})
    return {"symbol":symbol,"meta_currency":meta.get("currency"),
            "exchange_timezone":meta.get("exchangeTimezoneName"),"daily_rows":len(timestamps),
            "invalid_rows_by_reason":dict(issues),"first_examples":examples,
            "relative_gaps":{k:round(v,8) for k,v in magnitude.items()}}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit",type=int,choices=range(1,7),default=6,
                        help="Read-only diagnostic of 1..6 known blocked tickers")
    args=parser.parse_args()
    report={"status":"READ_ONLY_DIAGNOSTIC","results":[],"provider_refusal":None,
            "note":"Raw exchange timestamps shown in UTC, no candle modifications"}
    for index,symbol in enumerate(SYMBOLS[:args.limit]):
        query=BASE+symbol+"?range=5y&interval=1d&includePrePost=false"
        request=Request(query,headers={"Accept":"application/json","User-Agent":"Mozilla/5.0"})
        try:
            with urlopen(request,timeout=25) as response:
                if response.status!=200:
                    raise ValueError("Yahoo unexpected HTTP response")
                data=json.load(response)
            summary=audit_series(data,symbol)
            report["results"].append(summary)
            print(symbol+": "+str(summary["invalid_rows_by_reason"]),file=sys.stderr,flush=True)
        except HTTPError as exc:
            report["provider_refusal"]={"symbol":symbol,"http_status":exc.code}
            break
        except (URLError,ValueError,KeyError,TypeError) as exc:
            report["results"].append({"symbol":symbol,"diagnostic_error":str(exc)[:250]})
            # Service or response problems must not become stealth invalid data.
            break
        if index+1<args.limit:time.sleep(3)
    print(json.dumps(report,ensure_ascii=False,indent=2))
    return 0 if not report["provider_refusal"] and len(report["results"])==args.limit and all(
        "diagnostic_error" not in r for r in report["results"]) else 1

if __name__=="__main__":
    raise SystemExit(main())
