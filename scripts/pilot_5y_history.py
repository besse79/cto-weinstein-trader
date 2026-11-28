#!/usr/bin/env python3
"""One-request-per-symbol five-year Yahoo live-data pilot for PAPER only.

Run from the deployed WSL repo root via:
  git show FETCH_HEAD:scripts/pilot_5y_history.py | python3 - --apply

All mutations are candles and audit entries through the authenticated local
Next.js API. Original Git checkout, orders, stops, settings and scheduler
are not changed. Verified source and PostgreSQL backup precedes any import.
"""
import argparse
from datetime import date,timedelta
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
SAMPLES=(("AAPL","USD"),("AC.PA","EUR"),("ABBN.SW","CHF"))
REPORT="pilot_5y_history.json"

def run(*args):
    return subprocess.run(args,check=True,capture_output=True,cwd=ROOT)

def docker(*args):
    return run("docker","compose","-p","cto_weinstein",*args).stdout.decode().strip()

def sql(command):
    return docker("exec","-T","db","psql","-v","ON_ERROR_STOP=1",
                  "-At","-U","trader","-d","trader","-c",command)

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
        data=json.load(response)
    if data.get("mode")!="PAPER" or data.get("initial")!=500:
        raise RuntimeError("PAPER 500 EUR account check failed")
    return data

def guard():
    if not (ROOT/".git").is_dir() or not (ROOT/"deploy_local.py").is_file() or not (ROOT/".env").is_file():
        raise RuntimeError("Run inside existing WSL application with .env")
    if docker("--profile","automation","ps","-q","scheduler"):
        raise RuntimeError("Automated scheduler must remain paused")
    dashboard()
    expected=sql("""SELECT index_code||':'||count(*) FROM index_constituent_observations
      WHERE (index_code='SP500' AND observed_on='2026-11-14') OR
            (index_code='STOXX600_ETF_PROXY' AND observed_on='2026-11-12')
      GROUP BY index_code ORDER BY index_code""").splitlines()
    if expected!=["SP500:503","STOXX600_ETF_PROXY:602"]:
        raise RuntimeError("Unexpected index membership")
    actual=sql("SELECT symbol||':'||currency FROM instruments WHERE symbol IN "
        "('AAPL','AC.PA','ABBN.SW') ORDER BY symbol").splitlines()
    if actual!=sorted(s+":"+c for s,c in SAMPLES):
        raise RuntimeError("Sample currencies/tickers not as expected")

def token():
    for line in (ROOT/".env").read_text(encoding="utf-8").splitlines():
        if line.startswith("APP_TOKEN="):
            val=line.split("=",1)[1].strip().strip('"').strip("'")
            if len(val)>=24 and not any(c.isspace() for c in val):
                return val
    raise RuntimeError("APP_TOKEN missing")

def backup():
    spec=importlib.util.spec_from_file_location("installed_deployer",ROOT/"deploy_local.py")
    m=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    m.check_prerequisites()
    folder=m.backup()
    hashes={}
    for line in (folder/"checksums.sha256").read_text().splitlines():
        sha,name=line.split("  ",1)
        hashes[name]=sha
    for name in ("source.tar.gz","postgres.dump"):
        p=folder/name
        if not p.is_file() or not p.stat().st_size:
            raise RuntimeError("Incomplete backup: "+name)
        if hashlib.sha256(p.read_bytes()).hexdigest()!=hashes.get(name):
            raise RuntimeError("Backup integrity mismatch: "+name)
    return folder

def existing(symbol):
    query=("SELECT count(*)||'|'||coalesce(min(c.day)::text,'')||'|'||"
      "coalesce(max(c.day)::text,'') FROM candles c JOIN instruments i ON i.id=c.instrument_id "
      "WHERE i.symbol='"+symbol+"' AND c.day>='2021-01-01'")
    result=sql(query).split("|")
    return {"bars":int(result[0]),"first":result[1],"last":result[2]}

def ingest(key,symbol):
    payload=json.dumps({"mode":"history","symbols":[symbol],"scheduled":False}).encode("utf-8")
    request=Request(API+"/api/market/sync",method="POST",data=payload,headers={
        "Content-Type":"application/json","x-app-token":key})
    try:
        with urlopen(request,timeout=100) as response:
            body=json.load(response)
    except HTTPError as exc:
        try: detail=json.loads(exc.read(6000).decode())
        except Exception: detail={}
        msg=str(detail.get("detail") or detail.get("error") or "Provider failed")[:350]
        raise RuntimeError(f"HTTP {exc.code}: {msg}") from exc
    if body.get("ok") is not True or body.get("provider")!="YAHOO_UNOFFICIAL":
        raise RuntimeError("Local API did not confirm Yahoo provider")
    results=body.get("results")
    if not isinstance(results,list) or len(results)!=1 or results[0].get("symbol")!=symbol:
        raise RuntimeError("Unexpected Yahoo response")
    item=results[0]
    first=date.fromisoformat(item["first"])
    last=date.fromisoformat(item["last"])
    if not first<=date.today()-timedelta(days=365*4+180):
        raise RuntimeError("History does not span at least 4.5 years")
    if last<date.today()-timedelta(days=10) or last>date.today():
        raise RuntimeError("History is not current or future dated")
    if int(item.get("count",0))<900:
        raise RuntimeError("Five-year history has too few daily bars")
    return item

def execute(apply):
    guard()
    if not apply:
        print(json.dumps({"status":"PILOT_5Y_READY","samples":[x[0] for x in SAMPLES],
              "mode":"DRY_RUN","scheduler":"PAUSED","paper":"500_EUR"},indent=2))
        return 0
    key=token()
    paper=paper_hash()
    before={s:existing(s) for s,_ in SAMPLES}
    saved=backup()
    report={"status":"RUNNING","backup":str(saved),"before":before,
            "results":[],"scheduler":"PAUSED","paper":"500_EUR"}
    try:
        for symbol,_ in SAMPLES:
            item=ingest(key,symbol)
            counts=existing(symbol)
            if counts["bars"]<item["count"] or counts["bars"]<before[symbol]["bars"]:
                raise RuntimeError("New 5y candles were not durably written: "+symbol)
            if paper_hash()!=paper:
                raise RuntimeError("PAPER orders/stops/settings changed unexpectedly")
            report["results"].append({"symbol":symbol,"downloaded":item["count"],
                                      "first":item["first"],"last":item["last"],"stored":counts})
            print(f"{symbol}: {item['count']} five-year daily candles",flush=True)
        dashboard()
        if paper_hash()!=paper:raise RuntimeError("PAPER changed")
        report["status"]="PILOT_5Y_COMPLETE"
        report["paper_unchanged"]=True
    except Exception as exc:
        report["status"]="PILOT_5Y_BLOCKED"
        report["error"]=str(exc)[:500]
    (saved/REPORT).write_text(json.dumps(report,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    (saved/REPORT).chmod(0o600)
    print(json.dumps(report,indent=2,ensure_ascii=False),
          file=sys.stdout if report["status"]=="PILOT_5Y_COMPLETE" else sys.stderr)
    return 0 if report["status"]=="PILOT_5Y_COMPLETE" else 1

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply",action="store_true",help="Verified backup + 5y Yahoo import for three PAPER tickers")
    args=ap.parse_args()
    try:return execute(args.apply)
    except Exception as e:
        print("PILOT 5Y BLOCKED:",str(e)[:600],file=sys.stderr)
        return 1

if __name__=="__main__":
    raise SystemExit(main())
