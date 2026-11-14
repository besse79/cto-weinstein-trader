#!/usr/bin/env python3
"""V4.1 2026 Yahoo research-paper multi-currency checkpointed batch.

For the deployed WSL V4.1 app, run from its root using:
  git show FETCH_HEAD:scripts/batch_history_2026.py | python3 - --apply

Intentionally 24 previously incomplete symbols across currencies. Never
places orders. Requires paused scheduler and healthy PAPER 500 account.
Verifies SHA256 of complete source+Postgres backup BEFORE any data writes.
No background execution, no full-universe overload. Each instrument is
individually committed by the existing authenticated sync route.
"""
import argparse
from datetime import date,datetime,timezone
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
QUOTAS={"USD":8,"EUR":6,"GBP":3,"CHF":2,"SEK":2,"DKK":1,"NOK":1,"PLN":1}
EXPECTED={"SP500":503,"STOXX600_ETF_PROXY":602}
EXPECTED_DATES={"SP500":"2026-11-14","STOXX600_ETF_PROXY":"2026-11-12"}
LIMIT=24
STOP_WORDS=("HTTP 429","HTTP 403","HTTP 401","RATE LIMIT","RATE-LIMIT","TOO MANY REQUESTS","CAPTCHA")

def run(*args,stdin=None):
    return subprocess.run(list(args),cwd=ROOT,check=True,capture_output=True,input=stdin)

def docker(*args):
    return run("docker","compose","-p","cto_weinstein",*args).stdout.decode().strip()

def sql(query):
    return docker("exec","-T","db","psql","-v","ON_ERROR_STOP=1","-At","-U","trader","-d","trader","-c",query)

def paper_hash():
    return sql("""SELECT md5(
      (SELECT COALESCE(string_agg(row_to_json(o)::text,'|' ORDER BY id),'') FROM orders o)
      || '#' ||
      (SELECT COALESCE(string_agg(row_to_json(r)::text,'|' ORDER BY instrument_id),'') FROM risk_stops r)
      || '#' ||
      (SELECT COALESCE(string_agg(row_to_json(s)::text,'|' ORDER BY key),'') FROM settings s)
    )""")

def get_token():
    path=ROOT/".env"
    if not path.is_file():raise RuntimeError("App .env unavailable")
    for line in path.read_text().splitlines():
        if line.startswith("APP_TOKEN="):
            token=line.split("=",1)[1].strip().strip('"').strip("'")
            if len(token)>=24 and not any(c.isspace() for c in token):
                return token
    raise RuntimeError("APP_TOKEN absent")

def guard():
    if not (ROOT/".git").is_dir() or not (ROOT/"deploy_local.py").is_file():
        raise RuntimeError("Must run from installed WSL application, not extracted source")
    if date.today().year!=2026:
        raise RuntimeError("2026-only pilot; cannot be reused in future calendar years")
    if docker("--profile","automation","ps","-q","scheduler"):
        raise RuntimeError("Scheduler is running: pause it before importing history")
    response=json.load(urlopen(API+"/api/dashboard",timeout=12))
    if response.get("mode")!="PAPER" or response.get("initial")!=500:
        raise RuntimeError("Wrong PAPER 500 EUR account")
    refs=sql("""SELECT index_code||':'||count(*) FROM index_constituent_observations
      WHERE (index_code='SP500' AND observed_on='2026-11-14') OR
            (index_code='STOXX600_ETF_PROXY' AND observed_on='2026-11-12')
      GROUP BY index_code ORDER BY index_code""").splitlines()
    if refs!=["SP500:503","STOXX600_ETF_PROXY:602"]:
        raise RuntimeError("Unexpected index constituents: "+repr(refs))

def candidates():
    rows=sql("""SELECT i.symbol||E'\\t'||i.currency||E'\\t'||count(c.day)
      FROM instruments i
      JOIN index_constituent_observations o ON o.instrument_id=i.id
      LEFT JOIN candles c ON c.instrument_id=i.id AND c.day>='2026-01-01' AND c.day<='2026-11-13'
      WHERE (o.index_code='SP500' AND o.observed_on='2026-11-14') OR
            (o.index_code='STOXX600_ETF_PROXY' AND o.observed_on='2026-11-12')
      GROUP BY i.symbol,i.currency ORDER BY i.symbol""")
    # A symbol may be present in both snapshots; the distinct set is
    # mandatory to prevent overwriting entries or biasing quota allocation.
    unique={}
    for record in rows.splitlines():
        cols=record.split("\t")
        if len(cols)!=3:raise RuntimeError("Invalid catalog row")
        symbol,currency,n=cols
        if not re.fullmatch(r"[A-Z0-9.^-]{1,24}",symbol):raise RuntimeError("Invalid ticker in catalog")
        if currency not in QUOTAS:raise RuntimeError("Unknown asset currency "+currency)
        if symbol in unique and unique[symbol][0]!=currency:
            raise RuntimeError("Ticker currency disagreement "+symbol)
        unique[symbol]=(currency,max(int(n),unique.get(symbol,(currency,0))[1]))
    pending=[(s,c,n) for s,(c,n) in sorted(unique.items())
             if n<150]
    # Diversify Yahoo endpoint verification across all eight EXSA currencies.
    chosen=[];seen=set()
    for currency,quota in QUOTAS.items():
        group=[v for v in pending if v[1]==currency and v[0] not in seen]
        for triple in group[:quota]:
            chosen.append(triple);seen.add(triple[0])
    for triple in pending:
        if len(chosen)>=LIMIT:break
        if triple[0] not in seen:
            chosen.append(triple);seen.add(triple[0])
    return chosen[:LIMIT],len(pending),len(unique)

def backup():
    spec=importlib.util.spec_from_file_location("v41deployer",ROOT/"deploy_local.py")
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.check_prerequisites()
    folder=module.backup()
    entries={}
    for row in (folder/"checksums.sha256").read_text().splitlines():
        digest,name=row.split("  ",1)
        entries[name]=digest
    if not {"postgres.dump","source.tar.gz"}<=set(entries):
        raise RuntimeError("No complete verified PostgreSQL + source backup")
    for name in ["postgres.dump","source.tar.gz"]:
        target=folder/name
        if not target.is_file() or not target.stat().st_size:
            raise RuntimeError("Empty backup "+name)
        actual=hashlib.sha256(target.read_bytes()).hexdigest()
        if entries[name]!=actual:raise RuntimeError("Checksum mismatch "+name)
    return folder

def token_request(token,symbol):
    payload=json.dumps({"mode":"year","year":2026,"symbols":[symbol],"scheduled":False}).encode()
    request=Request(API+"/api/market/sync",method="POST",data=payload,headers={
        "Content-Type":"application/json","x-app-token":token})
    try:
        with urlopen(request,timeout=65) as response:
            body=json.load(response)
    except HTTPError as exc:
        try: detail=json.loads(exc.read(6000).decode())
        except Exception: detail={}
        reason=str(detail.get("detail") or detail.get("error") or f"HTTP {exc.code}")[:300]
        raise RuntimeError(f"HTTP {exc.code}: {reason}") from exc
    except URLError as exc:
        raise RuntimeError("Local sync service unavailable: "+str(exc.reason)[:150]) from exc
    if body.get("provider")!="YAHOO_UNOFFICIAL" or not body.get("ok"):
        raise RuntimeError("Provider did not confirm a real Yahoo import")
    results=body.get("results")
    if not isinstance(results,list) or len(results)!=1 or results[0].get("symbol")!=symbol:
        raise RuntimeError("Unexpected Yahoo result")
    item=results[0]
    if not str(item.get("first","")).startswith("2026-") or not str(item.get("last","")).startswith("2026-") or int(item.get("count",0))<1:
        raise RuntimeError("Unexpected year or empty candle import")
    return item

def report(folder,value):
    path=folder/"v4_1_batch_2026.json"
    with path.open("x",encoding="utf-8") as fp:
        json.dump(value,fp,indent=2,ensure_ascii=False)
        fp.write("\n")
    path.chmod(0o600)

def execute(*,apply=False):
    guard()
    selected,pending,unique=candidates()
    overview={"status":"DRY_RUN","year":2026,"selected_count":len(selected),
              "pending_count":pending,"unique_catalog":unique,
              "chosen":[{"symbol":s,"currency":c,"existing_2026_bars":n} for s,c,n in selected],
              "scheduler":"PAUSED","paper":"PAPER_500_EUR"}
    if not apply:
        print(json.dumps(overview,ensure_ascii=False,indent=2))
        return 0
    if not selected:
        overview["status"]="NOTHING_PENDING"
        print(json.dumps(overview,ensure_ascii=False,indent=2))
        return 0
    token=get_token()
    before=paper_hash()
    folder=backup()
    overview.update({"status":"RUNNING","backup":str(folder),
                     "successful":[],"blocked":[]})
    total=len(selected)
    try:
        for index,(symbol,currency,old_count) in enumerate(selected,1):
            try:
                result=token_request(token,symbol)
                saved=sql("SELECT count(*) FROM candles c JOIN instruments i "
                          "ON i.id=c.instrument_id WHERE i.symbol='"+symbol+
                          "' AND c.day>='2026-01-01' AND c.day<='2026-11-13'")
                if int(saved)<max(old_count,1):
                    raise RuntimeError("PostgreSQL candle count unexpectedly decreased")
                overview["successful"].append({"symbol":symbol,"currency":currency,
                    "imported":result["count"],"stored":int(saved),
                    "first":result["first"],"last":result["last"]})
                print(f"[{index}/{total}] {symbol}: {int(saved)} daily 2026 bars",flush=True)
            except Exception as error:
                msg=str(error)[:350]
                overview["blocked"].append({"symbol":symbol,"currency":currency,"reason":msg})
                print(f"[{index}/{total}] {symbol}: BLOCKED {msg}",file=sys.stderr,flush=True)
                if any(word in msg.upper() for word in STOP_WORDS):
                    overview["status"]="STOPPED_PROVIDER_REFUSAL"
                    break
            if paper_hash()!=before:
                raise RuntimeError("PAPER orders/stops/settings changed; batch stopped")
            if index<total:time.sleep(3)
        else:
            overview["status"]="COMPLETE" if not overview["blocked"] else "PARTIAL"
        if paper_hash()!=before:
            raise RuntimeError("PAPER state changed")
        dashboard=json.load(urlopen(API+"/api/dashboard",timeout=10))
        if dashboard.get("mode")!="PAPER" or dashboard.get("initial")!=500:
            raise RuntimeError("PAPER account health changed")
        overview["paper_unchanged"]=True
        report(folder,overview)
        print(json.dumps({k:v for k,v in overview.items() if k!="chosen"},ensure_ascii=False,indent=2))
        return 0 if overview["status"]=="COMPLETE" else 1
    except Exception as exc:
        overview["status"]="STOPPED_SAFETY"
        overview["error"]=str(exc)[:500]
        report(folder,overview)
        print(json.dumps(overview,ensure_ascii=False,indent=2),file=sys.stderr)
        return 1

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply",action="store_true",help="Backup and import up to 24 previously incomplete 2026 symbols")
    args=parser.parse_args()
    try:return execute(apply=args.apply)
    except Exception as exc:
        print("2026 BATCH BLOCKED:",str(exc)[:700],file=sys.stderr)
        return 1

if __name__=="__main__":
    raise SystemExit(main())
