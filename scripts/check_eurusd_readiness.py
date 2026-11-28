#!/usr/bin/env python3
"""Read-only EUR/USD V4.1 closeout: four Yahoo refusals + Monday PAPER readiness.

Run from installed WSL repo:
 git show FETCH_HEAD:scripts/check_eurusd_readiness.py | python3 -

No database writes, no source checkout, no APP_TOKEN access, no scheduler
activation and no order placement. Raw Yahoo chart reads occur in the running
web container (same Node runtime as authenticated sync).
"""
import json
from datetime import datetime, timezone
import math
from pathlib import Path
import subprocess
import sys
from urllib.error import HTTPError,URLError
from urllib.request import urlopen

ROOT=Path.cwd().resolve()
API="http://127.0.0.1:3010"
OUTLIERS=("KESKOBU0126.HE","SAMPO.HE","VSURE.ST","VYLR")
EXPECTED_CURRENCY={"KESKOBU0126.HE":"EUR","SAMPO.HE":"EUR",
                   "VSURE.ST":"EUR","VYLR":"USD"}
FRIDAY="2026-11-13"
RAW_NODE=r"""
(async()=>{
 const symbol=process.argv[1];
 const url=new URL('https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol));
 url.searchParams.set('range','5y');url.searchParams.set('interval','1d');
 url.searchParams.set('includePrePost','false');
 const response=await fetch(url,{cache:'no-store',headers:{Accept:'application/json'},
   signal:AbortSignal.timeout(25000)});
 if(!response.ok){console.error('YAHOO_HTTP_'+response.status);process.exitCode=4;return}
 console.log(JSON.stringify(await response.json()));
})().catch(e=>{console.error('YAHOO_NETWORK_ERROR '+String(e));process.exitCode=5})
"""

def process(*argv,timeout=40):
    return subprocess.run(argv,cwd=ROOT,text=True,capture_output=True,timeout=timeout)

def pg(query):
    r=process("docker","compose","-p","cto_weinstein","exec","-T",
              "db","psql","-v","ON_ERROR_STOP=1","-At","-U","trader",
              "-d","trader","-c",query,timeout=30)
    if r.returncode:
        raise RuntimeError("Read-only PostgreSQL query failed: "+r.stderr[-250:])
    return r.stdout.strip()

def local_json(path,timeout=70):
    try:
        with urlopen(API+path,timeout=timeout) as response:
            return json.load(response)
    except HTTPError as exc:
        return {"error":"API_HTTP_"+str(exc.code)}
    except (URLError,TimeoutError,ValueError) as exc:
        return {"error":"LOCAL_API_UNAVAILABLE "+str(exc)[:200]}

def inspect_chart(raw,symbol):
    result=raw.get("chart",{}).get("result")
    if not isinstance(result,list) or len(result)!=1:
        return {"symbol":symbol,"status":"MALFORMED_CHART"}
    chart=result[0]
    meta=chart.get("meta") or {}
    series=chart.get("indicators",{}).get("quote") or []
    times=chart.get("timestamp") or []
    details={"symbol":symbol,"provider_symbol":meta.get("symbol"),
      "company_name":meta.get("shortName") or meta.get("longName"),
      "quote_type":meta.get("instrumentType") or meta.get("quoteType"),
      "quoted_currency":meta.get("currency"),"catalog_currency":EXPECTED_CURRENCY[symbol],
      "timezone":meta.get("exchangeTimezoneName"),"raw_rows":len(times),
      "invalid_rows":0,"first_examples":[]}
    if meta.get("symbol")!=symbol or meta.get("currency")!=EXPECTED_CURRENCY[symbol]:
        details["status"]="SYMBOL_OR_CURRENCY_MISMATCH"
        return details
    if len(series)!=1 or not isinstance(times,list):
        details["status"]="MALFORMED_COLUMNS"
        return details
    q=series[0]
    if any(not isinstance(q.get(c),list) or len(q[c])!=len(times)
           for c in ("open","high","low","close","volume")):
        details["status"]="MALFORMED_COLUMNS"
        return details
    counts={}
    first=None
    last=None
    for i,t in enumerate(times):
        try:
            day=datetime.fromtimestamp(t,timezone.utc).date().isoformat()
        except (TypeError,ValueError,OverflowError):
            details["status"]="INVALID_TIMESTAMP"
            return details
        first=first or day
        last=day
        vals={c:q[c][i] for c in ("open","high","low","close","volume")}
        if all(v is None for v in vals.values()):
            continue
        o,h,l,c,v=(vals[k] for k in ("open","high","low","close","volume"))
        valid_price=all(type(x) in (int,float) and math.isfinite(x) and x>0
                        for x in (o,h,l,c))
        reasons=[]
        if not valid_price: reasons.append("INVALID_PRICE")
        else:
            if h<max(o,l,c):reasons.append("HIGH_TOO_LOW")
            if l>min(o,h,c):reasons.append("LOW_TOO_HIGH")
        if type(v)!=int or v<0:reasons.append("INVALID_VOLUME")
        if reasons:
            details["invalid_rows"]+=1
            for reason in reasons:counts[reason]=counts.get(reason,0)+1
            if len(details["first_examples"])<5:
                details["first_examples"].append({"date_utc":day,"reasons":reasons,
                                                  "ohlcv":vals})
    details["first_day_utc"]=first
    details["last_day_utc"]=last
    details["reasons"]=counts
    details["status"]=("INVALID_OHLCV" if details["invalid_rows"] else
                       "HISTORY_UNDER_40" if len(times)<40 else
                       "VALID_RAW_CHART_REVIEW_API")
    return details

def diagnose_one(symbol):
    r=process("docker","compose","-p","cto_weinstein","exec","-T",
              "web","node","-e",RAW_NODE,"--",symbol,timeout=42)
    if r.returncode:
        # Unlike a writer, diagnosis continues after provider 404 for a
        # symbol. A Yahoo throttle/auth refusal stops the entire inspection.
        err=(r.stderr or r.stdout)[-250:].strip()
        return {"symbol":symbol,"status":"YAHOO_FETCH_BLOCKED","reason":err}
    try:
        raw=json.loads(r.stdout)
        return inspect_chart(raw,symbol)
    except (ValueError,TypeError) as exc:
        return {"symbol":symbol,"status":"INVALID_YAHOO_RESPONSE",
                "reason":str(exc)[:200]}

def catalog_snapshot():
    # Same dated membership snapshots that fed the backfill; read-only.
    query="""WITH members AS(
        SELECT DISTINCT instrument_id FROM index_constituent_observations
         WHERE (index_code='SP500' AND observed_on='2026-11-14')
            OR (index_code='STOXX600_ETF_PROXY' AND observed_on='2026-11-12')
     ), covered AS(
        SELECT i.id,i.currency,i.symbol,count(c.day) AS bars,
               min(c.day) AS first_day,max(c.day) AS last_day
        FROM members m JOIN instruments i ON i.id=m.instrument_id
        LEFT JOIN candles c ON c.instrument_id=i.id
        WHERE i.currency IN('USD','EUR')
        GROUP BY i.id,i.currency,i.symbol
     ), audited AS(
       SELECT DISTINCT symbol FROM market_sync_audit
       WHERE provider='YAHOO_UNOFFICIAL'
         AND candles_count>=900
         AND first_day<=CURRENT_DATE-INTERVAL '4 years 6 months'
         AND last_day>=CURRENT_DATE-INTERVAL '10 days'
     )
     SELECT count(*)||'|'||
       count(*) FILTER(WHERE a.symbol IS NOT NULL)||'|'||
       count(*) FILTER(WHERE last_day='2026-11-13')||'|'||
       count(*) FILTER(WHERE bars>0 AND a.symbol IS NULL)||'|'||
       count(*) FILTER(WHERE bars=0)
     FROM covered c LEFT JOIN audited a ON a.symbol=c.symbol"""
    fields=pg(query).split("|")
    if len(fields)!=5 or any(not v.isdecimal() for v in fields):
        raise RuntimeError("Invalid EUR/USD coverage query result")
    return dict(zip(("total","fully_audited_5y","with_friday_close",
                     "non_full_with_bars","no_bars"),map(int,fields)))

def benchmark_snapshot():
    query="""SELECT i.symbol||'|'||coalesce(max(c.day)::text,'')||'|'||
       count(c.day)
       FROM instruments i LEFT JOIN candles c ON c.instrument_id=i.id
       WHERE i.symbol IN('SPY','EXSA.DE')
       GROUP BY i.symbol ORDER BY i.symbol"""
    result={}
    for line in pg(query).splitlines():
        symbol,last,n=line.split("|")
        result[symbol]={"last_day":last or None,"bars":int(n),
                        "has_friday_close":last==FRIDAY}
    return result

def candidate_snapshot():
    d=local_json("/api/paper-candidates")
    if d.get("error"):return d
    candidates=d.get("candidates") or []
    eligible=[x for x in candidates if x.get("eligible")]
    return {"mode":d.get("mode"),"as_of":d.get("asOf"),
       "order_window_open":d.get("orderWindowOpen"),
       "benchmark_day":d.get("benchmarkDay"),
       "eligible_count":d.get("eligibleCount"),
       "eligible_symbols":[x.get("symbol") for x in eligible[:15]],
       "eligible_order_allowed":sum(x.get("orderAllowed") is True for x in eligible),
       "limitations":d.get("limitations",[])}

def main():
    report={"status":"READ_ONLY_EURUSD_CLOSEOUT",
      "as_of_utc":datetime.now(timezone.utc).isoformat(),
      "friday_target":FRIDAY,"sources":[],
      "paper_orders_placed":False,"scheduler_started":False}
    try:
        if not (ROOT/".git").is_dir():
            raise RuntimeError("Run from existing WSL application checkout")
        for symbol in OUTLIERS:
            result=diagnose_one(symbol)
            report["sources"].append(result)
            print(symbol+": "+result["status"],file=sys.stderr,flush=True)
            reason=result.get("reason","")
            if any(term in reason for term in ("YAHOO_HTTP_429","YAHOO_HTTP_403","YAHOO_HTTP_401")):
                report["status"]="STOPPED_YAHOO_REFUSAL"
                break
        report["coverage"]=catalog_snapshot()
        report["benchmarks"]=benchmark_snapshot()
        report["paper_candidates"]=candidate_snapshot()
        report["safety_note"]="Read-only: no DB writes, import, order or scheduler actions"
    except Exception as exc:
        report["status"]="READ_ONLY_AUDIT_INCOMPLETE"
        report["error"]=str(exc)[:450]
    print(json.dumps(report,indent=2,ensure_ascii=False))
    return 0 if report["status"]=="READ_ONLY_EURUSD_CLOSEOUT" else 1

if __name__=="__main__":
    raise SystemExit(main())
