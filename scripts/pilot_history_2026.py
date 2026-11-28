#!/usr/bin/env python3
"""One-shot, 2026-only Yahoo OHLCV PAPER pilot against deployed V4.1 WSL.

Intended as `git show FETCH_HEAD:scripts/pilot_history_2026.py | python3 - --apply`
from the deployed project root; it does not replace the running code.
Safeguards: strict mode, existing 503+602 index snapshots, scheduler off,
verified source+Postgres backup, three explicit single-symbol requests,
checks of per-symbol candle counts and PAPER orders/stops/settings hash.
No broker actions, no background jobs, no 2025-2021 import.
"""
import argparse
from datetime import date,datetime,timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from urllib.error import HTTPError,URLError
from urllib.request import Request,urlopen

ROOT=Path.cwd().resolve()
API="http://127.0.0.1:3010"
SYMBOLS=(("AAPL","USD"),("MSFT","USD"),("AC.PA","EUR"))
YEAR=2026

def run(*args):
    return subprocess.run(args,cwd=ROOT,check=True,capture_output=True)

def docker(*args):
    return run("docker","compose","-p","cto_weinstein",*args).stdout.decode().strip()

def sql(command):
    return docker("exec","-T","db","psql","-v","ON_ERROR_STOP=1",
                  "-At","-U","trader","-d","trader","-c",command)

def fingerprint():
    return sql("""SELECT md5(
      (SELECT COALESCE(string_agg(row_to_json(o)::text,'|' ORDER BY id),'') FROM orders o)
      || '#' ||
      (SELECT COALESCE(string_agg(row_to_json(r)::text,'|' ORDER BY instrument_id),'') FROM risk_stops r)
      || '#' ||
      (SELECT COALESCE(string_agg(row_to_json(s)::text,'|' ORDER BY key),'') FROM settings s)
    )""")

def secret():
    env=ROOT/".env"
    if not env.is_file():
        raise RuntimeError("Missing local .env")
    for line in env.read_text(encoding="utf-8").splitlines():
        if line.startswith("APP_TOKEN="):
            token=line.split("=",1)[1].strip().strip('"').strip("'")
            if len(token)>=24 and not any(x in token for x in ("\r","\n"," ")):
                return token
    raise RuntimeError("APP_TOKEN not found in installed app .env")

def check_dashboard():
    with urlopen(API+"/api/dashboard",timeout=10) as response:
        dashboard=json.load(response)
    if dashboard.get("mode")!="PAPER" or dashboard.get("initial")!=500:
        raise RuntimeError("PAPER 500 EUR dashboard guard failed")
    return dashboard

def guards():
    if not (ROOT/".git").is_dir() or not (ROOT/"docker-compose.yml").is_file():
        raise RuntimeError("Run from installed WSL project root, not an extracted archive")
    if date.today().year!=YEAR:
        raise RuntimeError("This smoke pilot is deliberately restricted to 2026")
    if docker("--profile","automation","ps","-q","scheduler"):
        raise RuntimeError("Scheduled market collector must be stopped for this pilot")
    membership=sql("""SELECT index_code||':'||count(*) FROM
      index_constituent_observations
      WHERE (index_code='SP500' AND observed_on='2026-11-14') OR
            (index_code='STOXX600_ETF_PROXY' AND observed_on='2026-11-12')
      GROUP BY index_code ORDER BY index_code""").splitlines()
    if membership!=["SP500:503","STOXX600_ETF_PROXY:602"]:
        raise RuntimeError("Expected 503 S&P and 602 EXSA observations, got "+repr(membership))
    vals=sql("SELECT symbol||':'||currency FROM instruments WHERE symbol IN "
             "('AAPL','MSFT','AC.PA') ORDER BY symbol").splitlines()
    expected=sorted(sym+":"+cur for sym,cur in SYMBOLS)
    if vals!=expected:
        raise RuntimeError("Test tickers/currencies absent or changed: "+repr(vals))
    check_dashboard()

def backup_verified():
    # Import from the installed app's deploy tool without running an installer.
    import deploy_local
    deploy_local.check_prerequisites()
    folder=deploy_local.backup()
    expected=["source.tar.gz","postgres.dump"]
    manifest={}
    for line in (folder/"checksums.sha256").read_text().splitlines():
        digest,name=line.split("  ",1)
        manifest[name]=digest
    if any(name not in manifest for name in expected):
        raise RuntimeError("Verified complete backup absent; refused")
    for name in expected:
        file=folder/name
        if not file.is_file() or not file.stat().st_size:
            raise RuntimeError("Missing nonempty backup "+name)
        if hashlib.sha256(file.read_bytes()).hexdigest()!=manifest[name]:
            raise RuntimeError("Backup digest mismatch: "+name)
    return folder

def history_counts():
    command="""SELECT i.symbol||':'||COUNT(c.day)
       FROM instruments i
       LEFT JOIN candles c ON c.instrument_id=i.id
        AND c.day>='2026-01-01' AND c.day<'2027-01-01'
       WHERE i.symbol IN ('AAPL','MSFT','AC.PA')
       GROUP BY i.symbol ORDER BY i.symbol"""
    return {x.split(":")[0]:int(x.split(":")[1]) for x in sql(command).splitlines()}

def post_one(token,symbol):
    payload=json.dumps({"mode":"year","year":YEAR,
                        "symbols":[symbol],"scheduled":False}).encode("utf-8")
    request=Request(API+"/api/market/sync",data=payload,method="POST",
                    headers={"Content-Type":"application/json","x-app-token":token})
    try:
        with urlopen(request,timeout=65) as response:
            if response.status!=200:
                raise RuntimeError("Unexpected HTTP status")
            out=json.load(response)
    except HTTPError as error:
        try: detail=json.loads(error.read(6000).decode("utf-8"))
        except Exception: detail={}
        raise RuntimeError(f"Yahoo 2026 batch {symbol} blocked: HTTP {error.code}, "
                           +str(detail.get("detail") or detail.get("error") or "provider refused")[:350]) from error
    if out.get("ok") is not True or out.get("provider")!="YAHOO_UNOFFICIAL" or not out.get("results"):
        raise RuntimeError("Invalid Yahoo 2026 import confirmation for "+symbol)
    item=out["results"][0]
    if item.get("symbol")!=symbol or int(item.get("count",0))<100 or not (
        item.get("first","").startswith("2026-") and item.get("last","").startswith("2026-")
    ):
        raise RuntimeError("Invalid 2026 candle import response for "+symbol)
    return item

def execute():
    guards()
    token=secret()
    previous=fingerprint()
    before=history_counts()
    folder=backup_verified()
    results=[]
    report_path=folder/"pilot_2026.json"
    try:
        for symbol,_ in SYMBOLS:
            item=post_one(token,symbol)
            after=history_counts()
            if after.get(symbol,0)<max(100,before.get(symbol,0)):
                raise RuntimeError(f"Candle count failed validation for {symbol}")
            if fingerprint()!=previous:
                raise RuntimeError("PAPER order/stop/settings changed unexpectedly")
            results.append({**item,"stored_2026":after[symbol]})
        check_dashboard()
        final=fingerprint()
        if final!=previous:
            raise RuntimeError("Final PAPER fingerprint changed")
        report={"status":"PILOT_2026_COMPLETE","symbols":results,
                "before":before,"after":history_counts(),
                "verified_backup":str(folder),"scheduler":"PAUSED",
                "paper_unchanged":True,
                "note":"Three tickers only; other 2026 and 2021-2025 data NOT yet imported."}
        report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
        report_path.chmod(0o600)
        print(json.dumps(report,ensure_ascii=False,indent=2))
        return 0
    except Exception as e:
        report={"status":"PILOT_2026_BLOCKED","completed":results,
                "verified_backup":str(folder),"error":str(e)[:500],
                "scheduler":"PAUSED","note":"No automatic rollback: each successful per-symbol batch is audited, and a full verified backup is retained."}
        report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
        report_path.chmod(0o600)
        print(json.dumps(report,ensure_ascii=False,indent=2),file=sys.stderr)
        return 1

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply",action="store_true",help="Backup then import just 3 known PAPER tickers' 2026 data")
    args=parser.parse_args()
    try:
        guards()
        if not args.apply:
            print("PILOT_READY: PAPER/indices/scheduler OK. No change; --apply needed.")
            return 0
        return execute()
    except Exception as exc:
        print("PILOT BLOCKED: "+str(exc),file=sys.stderr)
        return 1

if __name__=="__main__":
    raise SystemExit(main())
