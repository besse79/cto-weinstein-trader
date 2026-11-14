#!/usr/bin/env python3
"""Read-only V4 paper release gate. No secrets, no writes or trade actions.

Exit 0: eligible for a MANUAL paper acceptance review (not production-certified).
Exit 1: blocker. Exit 2: endpoint / response error.
"""
import argparse
from datetime import date, timedelta
import json
import sys
from urllib.request import urlopen

def evaluate(dashboard, market, candidates, backtest, *, today):
    blockers=[]
    observations=[]
    if dashboard.get("mode")!="PAPER" or dashboard.get("initial")!=500:
        blockers.append("PAPER_MODE_OR_CAPITAL_INVALID")
    if dashboard.get("cash") is None or dashboard.get("equity") is None:
        blockers.append("PORTFOLIO_NOT_READABLE")
    coverage=market.get("coverage") or {}
    n=coverage.get("instruments",0)
    full=coverage.get("with_history",0)
    recent=coverage.get("recent",0)
    if n<26 or full!=n or recent!=n:
        blockers.append("UNIVERSE_HISTORY_INCOMPLETE_OR_STALE")
    runs=market.get("jobs") or []
    # A successful first bootstrap is necessary, but not proof future daily sync works.
    if not any(r.get("status")=="SUCCESS" for r in runs):
        blockers.append("NO_SUCCESSFUL_COLLECTION_JOB")
    if candidates.get("mode")!="PAPER" or not isinstance(candidates.get("candidates"),list):
        blockers.append("PAPER_CANDIDATES_UNAVAILABLE")
    if candidates.get("initialCash")!=500:
        blockers.append("PAPER_CANDIDATE_CAPITAL_INVALID")
    if candidates.get("eligibleCount")!=sum(c.get("eligible") is True for c in candidates.get("candidates",[])):
        blockers.append("CANDIDATE_COUNT_MISMATCH")
    for c in candidates.get("candidates",[]):
        if c.get("eligible") and (c.get("currency")!="EUR" or c.get("quantity",0)<=0 or c.get("reasons")):
            blockers.append("INCONSISTENT_PAPER_ENTRY")
            break
    result=backtest.get("result") or {}
    if result.get("mode")!="PAPER_PORTFOLIO_BACKTEST":
        blockers.append("PORTFOLIO_BACKTEST_UNAVAILABLE")
    if result.get("initialCash")!=500 or result.get("finalEquity") is None:
        blockers.append("PORTFOLIO_BACKTEST_INVALID")
    if backtest.get("instrumentsTested",0)>150:
        blockers.append("PORTFOLIO_BACKTEST_SCOPE_EXCEEDED")
    if not runs or not any(r.get("job_type") in ("EU_CLOSE","US_CLOSE") and r.get("status")=="SUCCESS" for r in runs):
        observations.append("DAILY_EOD_NOT_YET_PROVEN")
    observations += [
        "YAHOO_LICENSE_AND_SPLIT_DIVIDEND_ADJUSTMENTS_NOT_VERIFIED",
        "BROKER_EXECUTION_NOT_IN_SCOPE",
        "CURRENCY_FX_NOT_SUPPORTED_FOR_PAPER_TRADES",
        "BACKTEST_SURVIVORSHIP_BIAS_NOT_RESOLVED"
    ]
    return {"status":"BLOCKED" if blockers else "MANUAL_PAPER_REVIEW",
            "checked_day":today.isoformat(),"instruments":n,
            "history_ready":full,"recent":recent,
            "backtest_instruments":backtest.get("instrumentsTested",0),
            "paper_candidates":len(candidates.get("candidates",[])),
            "eligible_paper_candidates":candidates.get("eligibleCount"),
            "blockers":sorted(set(blockers)),"limitations":observations}

def load(base,path):
    with urlopen(base+path,timeout=20) as response:
        if response.status!=200:
            raise ValueError(f"HTTP {response.status} for {path}")
        return json.load(response)

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--url",default="http://127.0.0.1:3010")
    a=ap.parse_args()
    if a.url not in ("http://127.0.0.1:3010","http://localhost:3010"):
        print("Only local WSL application allowed",file=sys.stderr)
        return 2
    try:
        checks=evaluate(load(a.url,"/api/dashboard"),
            load(a.url,"/api/market/collection-status"),
            load(a.url,"/api/paper-candidates"),
            load(a.url,"/api/portfolio-backtest"),
            today=date.today())
        print(json.dumps(checks,indent=2,ensure_ascii=False))
        return 0 if checks["status"]=="MANUAL_PAPER_REVIEW" else 1
    except Exception as e:
        print(json.dumps({"status":"ERROR","error":str(e)},ensure_ascii=False),file=sys.stderr)
        return 2

if __name__=="__main__":
    raise SystemExit(main())
