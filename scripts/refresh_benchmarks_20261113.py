#!/usr/bin/env python3
"""Refresh only SPY & EXSA.DE Friday 2026-11-13 closes for PAPER readiness.

Run from deployed WSL checkout via pinned git show; --apply performs one
authenticated ATOMIC delta market sync for the two benchmark instruments.
No code checkout, scheduler start or paper orders. A verified full DB+source
backup is mandatory before any market-data update. Intended ONLY for
2026-11-15/16, before the next market close.
"""
import argparse
from datetime import date
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
from urllib.error import HTTPError,URLError
from urllib.request import Request,urlopen

ROOT=Path.cwd().resolve()
API="http://127.0.0.1:3010"
TARGET="2026-11-13"
SYMBOLS={"EXSA.DE":"EUR","SPY":"USD"}
REPORT="benchmark_friday_20261113.json"

def run(*args):
    return subprocess.run(args,cwd=ROOT,check=True,capture_output=True)

def docker(*args):
    return run("docker","compose","-p","cto_weinstein",*args).stdout.decode().strip()

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
    with urlopen(API+"/api/dashboard",timeout=15) as response:
        result=json.load(response)
    if result.get("mode")!="PAPER" or result.get("initial")!=500:
        raise RuntimeError("Expected PAPER account with EUR 500 initial capital")
    return result

def guard():
    if date.today().isoformat() not in ("2026-11-15","2026-11-16"):
        raise RuntimeError("Friday 2026-11-13 sync is only approved for 15/16 November 2026")
    if not (ROOT/".git").is_dir() or not (ROOT/"deploy_local.py").is_file() or not (ROOT/".env").is_file():
        raise RuntimeError("Run from installed WSL paper app directory")
    if docker("--profile","automation","ps","-q","scheduler"):
        raise RuntimeError("Automatic collector not paused")
    dashboard()
    observation=sql("""SELECT index_code||':'||count(*) FROM index_constituent_observations
      WHERE (index_code='SP500' AND observed_on='2026-11-14') OR
            (index_code='STOXX600_ETF_PROXY' AND observed_on='2026-11-12')
      GROUP BY index_code ORDER BY index_code""").splitlines()
    if observation!=["SP500:503","STOXX600_ETF_PROXY:602"]:
        raise RuntimeError("Unexpected indexed catalog")
    actual=sql("SELECT symbol||':'||currency FROM instruments WHERE symbol IN "
               "('EXSA.DE','SPY') ORDER BY symbol").splitlines()
    if actual!=["EXSA.DE:EUR","SPY:USD"]:
        raise RuntimeError("Reference ticker currencies have changed")

def latest_benchmarks():
    rows=sql("""SELECT i.symbol||'|'||coalesce(min(c.day)::text,'')||'|'||
          coalesce(max(c.day)::text,'')||'|'||count(c.day)
       FROM instruments i LEFT JOIN candles c ON c.instrument_id=i.id
       WHERE i.symbol IN ('EXSA.DE','SPY')
       GROUP BY i.symbol ORDER BY i.symbol""").splitlines()
    result={}
    for row in rows:
        symbol,first,last,count=row.split("|")
        if symbol not in SYMBOLS or symbol in result:
            raise RuntimeError("Unexpected benchmark SQL result")
        result[symbol]={"first":first,"last":last,"bars":int(count)}
    if set(result)!=set(SYMBOLS):raise RuntimeError("Incomplete benchmark SQL result")
    return result

def token():
    for line in (ROOT/".env").read_text(encoding="utf-8").splitlines():
        if line.startswith("APP_TOKEN="):
            value=line.split("=",1)[1].strip().strip('"').strip("'")
            if len(value)>=24 and not any(c.isspace() for c in value):
                return value
    raise RuntimeError("APP_TOKEN missing")

def verified_backup():
    spec=importlib.util.spec_from_file_location("installed_deployer",ROOT/"deploy_local.py")
    deploy=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(deploy)
    deploy.check_prerequisites()
    directory=deploy.backup()
    entries={}
    for row in (directory/"checksums.sha256").read_text().splitlines():
        digest,name=row.split("  ",1)
        entries[name]=digest
    for name in ("source.tar.gz","postgres.dump"):
        p=directory/name
        if not p.is_file() or not p.stat().st_size:
            raise RuntimeError("Missing source + database full backup")
        if hashlib.sha256(p.read_bytes()).hexdigest()!=entries.get(name):
            raise RuntimeError("SHA256 verification failed: "+name)
    return directory

def sync_benchmarks(key):
    payload=json.dumps({"symbols":["EXSA.DE","SPY"],
                        "mode":"delta","scheduled":False}).encode("utf-8")
    req=Request(API+"/api/market/sync",data=payload,method="POST",
                headers={"Content-Type":"application/json","x-app-token":key})
    try:
        with urlopen(req,timeout=110) as response:
            body=json.load(response)
    except HTTPError as exc:
        try:detail=json.loads(exc.read(5000).decode())
        except Exception:detail={}
        msg=str(detail.get("detail") or detail.get("error") or "Sync failed")[:300]
        raise RuntimeError("HTTP "+str(exc.code)+": "+msg) from exc
    except URLError as exc:
        raise RuntimeError("Local market data API unavailable: "+str(exc.reason)[:200]) from exc
    if body.get("ok") is not True or body.get("provider")!="YAHOO_UNOFFICIAL" or body.get("mode")!="PAPER" or body.get("window")!="3mo":
        raise RuntimeError("Provider did not confirm real Yahoo daily delta")
    found=body.get("results")
    if not isinstance(found,list) or {x.get("symbol") for x in found}!=set(SYMBOLS) or len(found)!=2:
        raise RuntimeError("Yahoo result missing one or both benchmarks")
    for item in found:
        if item.get("last")!=TARGET or int(item.get("count",0))<30:
            raise RuntimeError("Yahoo does not yet confirm Friday 13 November for "+item["symbol"])
    return found

def paper_candidates():
    with urlopen(API+"/api/paper-candidates",timeout=100) as response:
        data=json.load(response)
    if data.get("mode")!="PAPER" or data.get("benchmarkDay")!=TARGET:
        raise RuntimeError("Paper candidate screen does not acknowledge Friday benchmark")
    eligible=[c for c in data.get("candidates",[]) if c.get("eligible") is True]
    return {"as_of":data.get("asOf"),
            "benchmark_day":data.get("benchmarkDay"),
            "eligible_count":data.get("eligibleCount"),
            "eligible_symbols":[c.get("symbol") for c in eligible],
            "order_window_open":data.get("orderWindowOpen"),
            "order_allowed_symbols":[c.get("symbol") for c in eligible
                                     if c.get("orderAllowed") is True]}

def emit(value):
    print(json.dumps(value,ensure_ascii=False,indent=2))

def execute(apply=False):
    guard()
    before=latest_benchmarks()
    if not apply:
        emit({"status":"DRY_RUN","target":TARGET,
              "before":before,"scheduler":"PAUSED",
              "paper":"500_EUR","actions":"NONE"})
        return 0
    if all(row["last"]==TARGET for row in before.values()):
        c=paper_candidates()
        emit({"status":"BENCHMARKS_ALREADY_CURRENT","before":before,
              "after":before,"paper_candidates":c,"paper_unchanged":True,
              "scheduler":"PAUSED","orders_placed":False})
        return 0
    original=paper_hash()
    key=token()
    folder=verified_backup()
    report={"status":"RUNNING","backup":str(folder),"target":TARGET,
            "before":before,"after":None,"sync":None,
            "scheduler":"PAUSED","orders_placed":False}
    try:
        report["sync"]=sync_benchmarks(key)
        after=latest_benchmarks()
        report["after"]=after
        for symbol in SYMBOLS:
            if after[symbol]["last"]!=TARGET:
                raise RuntimeError("PostgreSQL Friday close still missing for "+symbol)
            if after[symbol]["bars"]<before[symbol]["bars"]:
                raise RuntimeError("Historical candle regression for "+symbol)
            if before[symbol]["first"] and after[symbol]["first"]>before[symbol]["first"]:
                raise RuntimeError("Historical benchmark earliest bar lost: "+symbol)
        if paper_hash()!=original:raise RuntimeError("PAPER orders/stops/settings changed")
        dashboard()
        report["paper_candidates"]=paper_candidates()
        if paper_hash()!=original:raise RuntimeError("PAPER account changed during screening")
        report["paper_unchanged"]=True
        report["status"]="FRIDAY_BENCHMARKS_COMPLETE"
    except Exception as exc:
        report["status"]="FRIDAY_BENCHMARKS_BLOCKED"
        report["reason"]=str(exc)[:500]
        report["paper_unchanged"]=paper_hash()==original
    path=folder/REPORT
    path.write_text(json.dumps(report,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    path.chmod(0o600)
    emit(report)
    return 0 if report["status"]=="FRIDAY_BENCHMARKS_COMPLETE" else 1

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--apply",action="store_true",
                   help="Backup+one atomic Yahoo delta batch for only EXSA.DE and SPY")
    args=p.parse_args()
    try:return execute(args.apply)
    except Exception as exc:
        print("FRIDAY BENCHMARK REFRESH BLOCKED:",str(exc)[:600],file=sys.stderr)
        return 1

if __name__=="__main__":
    raise SystemExit(main())
