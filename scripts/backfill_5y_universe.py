#!/usr/bin/env python3
"""Bounded, resumable Yahoo 5y OHLCV import across V4.1 index observations.

Run from the deployed WSL checkout:
    git show FETCH_HEAD:scripts/backfill_5y_universe.py | python3 - --limit 48 --apply

The existing authenticated API performs one transactional import per ticker.
This script never changes source code, scheduler, account, orders or stops.
Source+PostgreSQL backup and checksum verification are mandatory before writes.
The API may refuse a symbol; it is recorded and not silently treated as ready.
No broker connection. Yahoo is unofficial and must not be bypassed on refusal.
"""
import argparse
from datetime import date,datetime,timezone,timedelta
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from urllib.error import HTTPError,URLError
from urllib.request import Request,urlopen

ROOT=Path.cwd().resolve()
API="http://127.0.0.1:3010"
STATE_DIR=Path.home()/"cto-weinstein-backfill"
STATE_FILE=STATE_DIR/"v4_1_rolling5y.json"
CURRENCIES=("USD","EUR","GBP","CHF","SEK","DKK","NOK","PLN")
QUOTAS={"USD":8,"EUR":6,"GBP":3,"CHF":2,"SEK":2,"DKK":1,"NOK":1,"PLN":1}
INDEX_DAYS={"SP500":"2026-11-14","STOXX600_ETF_PROXY":"2026-11-12"}
EXPECTED_COUNTS={"SP500":503,"STOXX600_ETF_PROXY":602}
PROVIDER="YAHOO_UNOFFICIAL"
PAUSE_SECONDS=4
MAX_LIMIT=1105
STOP_REFUSAL=("HTTP 429","HTTP 403","HTTP 401","TOO MANY REQUESTS","RATE LIMIT",
              "RATE-LIMIT","CAPTCHA")
TICKER=re.compile(r"^[A-Z0-9.^-]{1,24}$")
# Confirmed by a read-only Yahoo 5-year source diagnostic (2026-11-15).
# No price interpolation, reconstruction, repair, or deletion: these tickers
# remain visibly excluded from full-history collection until independently
# verified against a second reliable source. --retry-blocked explicitly
# permits a future recheck if Yahoo has corrected its original records.
KNOWN_OHLCV_QUARANTINE={
    "AAF.L":("2024-05-01",),
    "AAL.L":("2024-05-01",),
    "ABDN.L":("2024-05-02","2024-10-16"),
    "AKER.OL":("2022-01-10","2022-11-07","2023-11-06","2024-04-17"),
    "ABF.L":("2026-03-02",),
    "ADM.L":("2026-03-02",),
}

def cmd(*args):
    return subprocess.run(args,cwd=ROOT,check=True,capture_output=True)

def docker(*args):
    return cmd("docker","compose","-p","cto_weinstein",*args).stdout.decode().strip()

def sql(query):
    return docker("exec","-T","db","psql","-v","ON_ERROR_STOP=1","-At",
                  "-U","trader","-d","trader","-c",query)

def paper_hash():
    return sql("""SELECT md5(
      (SELECT COALESCE(string_agg(row_to_json(o)::text,'|' ORDER BY id),'') FROM orders o)
      || '#' ||
      (SELECT COALESCE(string_agg(row_to_json(r)::text,'|' ORDER BY instrument_id),'') FROM risk_stops r)
      || '#' ||
      (SELECT COALESCE(string_agg(row_to_json(s)::text,'|' ORDER BY key),'') FROM settings s)
    )""")

def dashboard():
    with urlopen(API+"/api/dashboard",timeout=12) as response:
        result=json.load(response)
    if result.get("mode")!="PAPER" or result.get("initial")!=500:
        raise RuntimeError("PAPER 500 EUR account not healthy")
    return result

def guards():
    if not (ROOT/".git").is_dir() or not (ROOT/"deploy_local.py").is_file() or not (ROOT/".env").is_file():
        raise RuntimeError("Execute from installed WSL app, not detached archive")
    if docker("--profile","automation","ps","-q","scheduler"):
        raise RuntimeError("Scheduler must remain PAUSED until backfill + daily planning are certified")
    dashboard()
    observed=sql("""SELECT index_code||':'||count(*) FROM index_constituent_observations
     WHERE (index_code='SP500' AND observed_on='2026-11-14') OR
           (index_code='STOXX600_ETF_PROXY' AND observed_on='2026-11-12')
     GROUP BY index_code ORDER BY index_code""").splitlines()
    if observed!=["SP500:503","STOXX600_ETF_PROXY:602"]:
        raise RuntimeError("Expected point-in-time S&P500 and EXSA 503+602, got "+repr(observed))

def catalog_rows():
    # One row per instrument. A successful prior 5-year history audit is
    # stronger evidence than raw candle counts, which may only cover 2025-26.
    # Existing audited 5-year imports (including the three pilot stocks) skip.
    query="""WITH members AS (
       SELECT DISTINCT instrument_id
       FROM index_constituent_observations
       WHERE (index_code='SP500' AND observed_on='2026-11-14') OR
             (index_code='STOXX600_ETF_PROXY' AND observed_on='2026-11-12')
     ), latest AS (
       SELECT i.id,i.symbol,i.currency,
         count(c.day) AS bars,
         coalesce(min(c.day)::text,'') AS first_day,
         coalesce(max(c.day)::text,'') AS last_day
       FROM members m JOIN instruments i ON i.id=m.instrument_id
       LEFT JOIN candles c ON c.instrument_id=i.id AND
         c.day>=CURRENT_DATE-INTERVAL '5 years 20 days'
       GROUP BY i.id,i.symbol,i.currency
     ), audits AS (
       SELECT symbol, count(*) AS complete
       FROM market_sync_audit
       WHERE provider='YAHOO_UNOFFICIAL'
         AND candles_count>=900
         AND first_day<=CURRENT_DATE-INTERVAL '4 years 6 months'
         AND last_day>=CURRENT_DATE-INTERVAL '10 days'
       GROUP BY symbol
     )
     SELECT l.symbol||E'\t'||l.currency||E'\t'||l.bars::text||E'\t'||
       l.first_day||E'\t'||l.last_day||E'\t'||
       CASE WHEN a.complete>0 THEN '1' ELSE '0' END
     FROM latest l LEFT JOIN audits a ON a.symbol=l.symbol
     ORDER BY l.symbol"""
    result={}
    for line in sql(query).splitlines():
        fields=line.split("\t")
        if len(fields)!=6:raise RuntimeError("Invalid membership SQL row")
        symbol,currency,bars,first,last,complete=fields
        if not TICKER.fullmatch(symbol):raise RuntimeError("Invalid Yahoo symbol in catalog "+symbol)
        if currency not in CURRENCIES:raise RuntimeError("Unknown denomination currency "+currency)
        if symbol in result:raise RuntimeError("Duplicate instrument row "+symbol)
        if not bars.isdecimal() or complete not in ("0","1"):
            raise RuntimeError("Invalid stored coverage for "+symbol)
        result[symbol]={"symbol":symbol,"currency":currency,
            "bars":int(bars),"first":first,"last":last,"audited_5y":complete=="1"}
    if not 1000<=len(result)<=1105:
        raise RuntimeError("Unexpected number of unique catalog instruments "+str(len(result)))
    return result

def load_state():
    if not STATE_FILE.exists():return {"version":1,"completed":{},"blocked":{}}
    doc=json.loads(STATE_FILE.read_text(encoding="utf-8"))
    if doc.get("version")!=1 or not isinstance(doc.get("completed"),dict) or not isinstance(doc.get("blocked"),dict):
        raise RuntimeError("Invalid local 5y checkpoint; manual inspection required")
    return doc

def atomic_json(path,data):
    target=Path(path)
    tmp=target.with_name(target.name+".tmp."+str(os.getpid()))
    try:
        with os.fdopen(os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),"w",encoding="utf-8") as fp:
            json.dump(data,fp,ensure_ascii=False,indent=2)
            fp.write("\n")
            fp.flush()
            os.fsync(fp.fileno())
        os.replace(tmp,target)
        target.chmod(0o600)
    finally:
        if tmp.exists():tmp.unlink()

def available(rows,state,*,retry_blocked=False):
    done=state["completed"]
    blocked=state["blocked"]
    now=date.today()
    pending=[]
    for symbol,item in rows.items():
        if item["audited_5y"]:continue
        if symbol in KNOWN_OHLCV_QUARANTINE and not retry_blocked:
            continue
        saved=done.get(symbol)
        if isinstance(saved,dict) and saved.get("currency")==item["currency"]:
            try:
                last=date.fromisoformat(saved.get("last",""))
                checked=date.fromisoformat(saved.get("checked",""))
                if last>=now-timedelta(days=10) and checked>=now-timedelta(days=20):
                    continue # successful short IPO history within verified freshness window
            except (TypeError,ValueError):
                pass
        fail=blocked.get(symbol)
        if not retry_blocked and isinstance(fail,dict):
            try:
                retry_day=date.fromisoformat(fail["retry_after"])
                if retry_day>now:continue
            except (ValueError,TypeError,KeyError):
                pass
        pending.append(item)
    return pending

def balanced(pending,limit):
    groups={c:[] for c in CURRENCIES}
    for row in pending:groups[row["currency"]].append(row)
    result=[]
    selected=set()
    for c,quota in QUOTAS.items():
        for row in groups[c][:min(quota,limit-len(result))]:
            result.append(row);selected.add(row["symbol"])
    for row in pending:
        if len(result)>=limit:break
        if row["symbol"] not in selected:
            result.append(row);selected.add(row["symbol"])
    return result

def get_token():
    for line in (ROOT/".env").read_text(encoding="utf-8").splitlines():
        if line.startswith("APP_TOKEN="):
            value=line.split("=",1)[1].strip().strip('"').strip("'")
            if len(value)>=24 and not any(c.isspace() for c in value):return value
    raise RuntimeError("APP_TOKEN missing from deployed app")

def verified_backup():
    spec=importlib.util.spec_from_file_location("deployed_backup",ROOT/"deploy_local.py")
    dep=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(dep)
    dep.check_prerequisites()
    folder=dep.backup()
    entries={}
    for line in (folder/"checksums.sha256").read_text().splitlines():
        digest,name=line.split("  ",1)
        entries[name]=digest
    for name in ("source.tar.gz","postgres.dump"):
        file=folder/name
        if not file.is_file() or not file.stat().st_size:
            raise RuntimeError("No complete pre-import verified backup")
        if hashlib.sha256(file.read_bytes()).hexdigest()!=entries.get(name):
            raise RuntimeError("Backup SHA256 mismatch "+name)
    return folder

def request_5y(token,symbol):
    payload=json.dumps({"mode":"history","symbols":[symbol],"scheduled":False}).encode("utf-8")
    request=Request(API+"/api/market/sync",data=payload,method="POST",
                    headers={"Content-Type":"application/json","x-app-token":token})
    try:
        with urlopen(request,timeout=100) as response:
            if response.status!=200:raise RuntimeError("Invalid local history HTTP response")
            body=json.load(response)
    except HTTPError as error:
        try: detail=json.loads(error.read(5000).decode("utf-8"))
        except Exception: detail={}
        why=str(detail.get("detail") or detail.get("error") or "Unknown")[:300]
        raise RuntimeError("HTTP "+str(error.code)+": "+why) from error
    except URLError as error:
        raise RuntimeError("Local history endpoint unavailable: "+str(error.reason)[:120]) from error
    if body.get("ok") is not True or body.get("provider")!=PROVIDER or body.get("mode")!="PAPER":
        raise RuntimeError("Missing verified real Yahoo PAPER confirmation")
    results=body.get("results")
    if not isinstance(results,list) or len(results)!=1 or results[0].get("symbol")!=symbol:
        raise RuntimeError("History response does not match requested ticker")
    item=results[0]
    first=date.fromisoformat(item["first"])
    last=date.fromisoformat(item["last"])
    if first>last or last>date.today() or last<date.today()-timedelta(days=10):
        raise RuntimeError("Yahoo history contains stale or future dates")
    count=item.get("count")
    if not isinstance(count,int) or count<40:
        raise RuntimeError("Insufficient Yahoo daily bars")
    return item

def check_import(symbol,expected):
    # All SQL values originate in a regex-verified ticker or parsed ISO date.
    first=expected["first"];last=expected["last"];n=expected["count"]
    result=sql("SELECT count(*) FROM candles c JOIN instruments i ON i.id=c.instrument_id "
               "WHERE i.symbol='"+symbol+"' AND c.day>='"+first+"' AND c.day<='"+last+"'")
    if int(result)<n:
        raise RuntimeError("Stored candle count below Yahoo imported count for "+symbol)
    # Verify successful API audit before declaring the checkpoint complete.
    audits=sql("SELECT count(*) FROM market_sync_audit WHERE symbol='"+symbol+
               "' AND provider='YAHOO_UNOFFICIAL' AND first_day='"+first+
               "' AND last_day='"+last+"' AND candles_count="+str(n))
    if int(audits)<1:
        raise RuntimeError("Missing transactional Yahoo audit for "+symbol)
    return int(result)

def execute(*,apply=False,limit=48,retry_blocked=False):
    if not isinstance(limit,int) or not 1<=limit<=MAX_LIMIT:
        raise ValueError("Batch size must be 1.."+str(MAX_LIMIT))
    guards()
    catalog=catalog_rows()
    state=load_state()
    pending=available(catalog,state,retry_blocked=retry_blocked)
    selected=balanced(pending,limit)
    info={"status":"DRY_RUN","catalog_unique":len(catalog),
          "verified_5y_in_db":sum(x["audited_5y"] for x in catalog.values()),
          "pending_before_limit":len(pending),"selected":len(selected),
          "symbols":[{"symbol":x["symbol"],"currency":x["currency"],"prior_bars":x["bars"]} for x in selected],
          "mode":"PAPER","scheduler":"PAUSED","source":"YAHOO_UNOFFICIAL_RANGE_5Y",
          "quarantined_source_defects":{sym:list(days) for sym,days in
            KNOWN_OHLCV_QUARANTINE.items() if sym in catalog},
          "quarantined_count":sum(sym in catalog for sym in KNOWN_OHLCV_QUARANTINE)}
    if not apply:
        print(json.dumps(info,ensure_ascii=False,indent=2))
        return 0
    if not selected:
        print(json.dumps({**info,"status":"NO_PENDING_UNIVERSE"},ensure_ascii=False,indent=2))
        return 0
    key=get_token()
    original=paper_hash()
    folder=verified_backup()
    report=folder/"backfill_5y_wave.json"
    info.update({"status":"RUNNING","backup":str(folder),"successful":[],"short_history":[],
                 "blocked":[],"started_utc":datetime.now(timezone.utc).isoformat()})
    atomic_json(report,info)
    try:
        for index,row in enumerate(selected,1):
            symbol=row["symbol"]
            try:
                response=request_5y(key,symbol)
                stored=check_import(symbol,response)
                full=(response["count"]>=900 and
                      date.fromisoformat(response["first"])<=date.today()-timedelta(days=365*4+180))
                detail={"symbol":symbol,"currency":row["currency"],
                        "count":response["count"],"first":response["first"],
                        "last":response["last"],"stored":stored,"full_5y":full}
                (info["successful"] if full else info["short_history"]).append(detail)
                state["completed"][symbol]={"currency":row["currency"],
                    "first":response["first"],"last":response["last"],
                    "count":response["count"],"checked":date.today().isoformat(),
                    "full_5y":full}
                state["blocked"].pop(symbol,None)
                if index<=3 or index%25==0 or index==len(selected) or not full:
                    print("["+str(index)+"/"+str(len(selected))+"] "+symbol+
                          ": "+str(response["count"])+(" FULL" if full else " SHORT_HISTORY"),
                          flush=True)
            except Exception as exc:
                why=str(exc)[:400]
                info["blocked"].append({"symbol":symbol,"currency":row["currency"],"reason":why})
                refuse=any(word in why.upper() for word in STOP_REFUSAL)
                if not refuse:
                    state["blocked"][symbol]={"reason":why,"last_attempt":date.today().isoformat(),
                        "retry_after":(date.today()+timedelta(days=1)).isoformat()}
                print("["+str(index)+"/"+str(len(selected))+"] "+symbol+
                      ": BLOCKED "+why,file=sys.stderr,flush=True)
                if refuse:
                    info["status"]="STOPPED_PROVIDER_REFUSAL"
            if paper_hash()!=original:
                info["status"]="STOPPED_PAPER_INTEGRITY"
                raise RuntimeError("Paper order/stop/settings fingerprint changed")
            atomic_json(STATE_FILE,state)
            atomic_json(report,info)
            if info["status"]!="RUNNING":break
            if index<len(selected):time.sleep(PAUSE_SECONDS)
        if info["status"]=="RUNNING":
            info["status"]="COMPLETE" if not info["blocked"] else "PARTIAL"
        dashboard()
        if paper_hash()!=original:raise RuntimeError("PAPER state changed at end")
        info["paper_unchanged"]=True
    except KeyboardInterrupt:
        info["status"]="INTERRUPTED"
        info["note"]="Committed symbols are durable; rerun the same command to resume."
    except Exception as exc:
        info["status"]="STOPPED_SAFETY"
        info["error"]=str(exc)[:450]
    info["finished_utc"]=datetime.now(timezone.utc).isoformat()
    atomic_json(STATE_FILE,state)
    atomic_json(report,info)
    summary={"status":info["status"],"catalog_unique":info["catalog_unique"],
             "verified_before":info["verified_5y_in_db"],
             "selected":info["selected"],"full_5y_imported":len(info["successful"]),
             "short_history_imported":len(info["short_history"]),
             "blocked_count":len(info["blocked"]),
             "blocked":info["blocked"][:20],
             "short_history":info["short_history"][:10],
             "backup":info["backup"],"report":str(report),
             "quarantined_count":info["quarantined_count"],
             "quarantined_source_defects":info["quarantined_source_defects"],
             "scheduler":info["scheduler"],"paper_unchanged":info.get("paper_unchanged",False)}
    if "error" in info:summary["error"]=info["error"]
    print(json.dumps(summary,indent=2,ensure_ascii=False))
    return 0 if info["status"]=="COMPLETE" else 1

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--limit",type=int,default=48,help="One execution, 1..1105 symbols; default 48")
    p.add_argument("--apply",action="store_true",help="Backup then import in bounded foreground requests")
    p.add_argument("--retry-blocked",action="store_true",
                   help="Explicitly retry failed tickers, including source-quarantined cases; no data validation is relaxed")
    args=p.parse_args()
    STATE_DIR.mkdir(parents=True,exist_ok=True,mode=0o700)
    STATE_DIR.chmod(0o700)
    with (STATE_DIR/"backfill.lock").open("a+") as lock:
        try:fcntl.flock(lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            print("BACKFILL BLOCKED: another 5y backfill is running",file=sys.stderr)
            return 1
        try:return execute(apply=args.apply,limit=args.limit,retry_blocked=args.retry_blocked)
        except Exception as e:
            print("BACKFILL BLOCKED:",str(e)[:650],file=sys.stderr)
            return 1

if __name__=="__main__":
    raise SystemExit(main())
