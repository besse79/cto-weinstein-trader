#!/usr/bin/env python3
"""Read-only Monday PAPER screen audit for 2026-11-16, EUR only.

A successful backfill is not a Weinstein entry signal. Inspect the actual
deployed /api/paper-candidates rejection reasons and phase-1 watchlist
without modifying prices, orders, account state or running the scheduler.
This deliberately uses the exact application screening rules, not a second
implementation of Weinstein.
"""
from collections import Counter
from datetime import date
import json
import sys
import time
from urllib.error import HTTPError,URLError
from urllib.request import urlopen

API="http://127.0.0.1:3010/api/paper-candidates"
FRIDAY="2026-11-13"
AUDIT_DAYS={"2026-11-15","2026-11-16"}
CANDIDATE_FIELDS=("symbol","signal","signalDay","signalWeek","quoteDay",
                  "quotePrice","stop","quantity","watchScore",
                  "relativeStrength","volumeRatio","reasons","eligible",
                  "orderAllowed","maxPlannedLoss")
REQUIRED=("mode","asOf","benchmarkDay","eligibleCount","candidates",
          "orderWindowOpen")

def summarize(data):
    if not isinstance(data,dict) or any(k not in data for k in REQUIRED):
        raise ValueError("Incomplete deployed candidate API response")
    if data["mode"]!="PAPER" or data["asOf"] not in AUDIT_DAYS:
        raise ValueError("Unexpected PAPER mode or audited weekend/Monday date")
    if data["benchmarkDay"]!=FRIDAY:
        raise ValueError("Required Friday 13 Nov benchmark is not current")
    candidates=data["candidates"]
    if not isinstance(candidates,list):
        raise ValueError("Invalid candidate list")
    if len(candidates)<200 or len(candidates)>1000:
        raise ValueError("Unexpected number of EUR PAPER candidates")
    if any(x.get("currency")!="EUR" for x in candidates):
        raise ValueError("Non-EUR instrument erroneously admitted into PAPER candidate screen")
    if len({x.get("symbol") for x in candidates})!=len(candidates):
        raise ValueError("Duplicate candidate ticker")
    eligible=[x for x in candidates if x.get("eligible") is True]
    if len(eligible)!=data["eligibleCount"]:
        raise ValueError("Eligible count is inconsistent with candidates")
    if date.fromisoformat(data["asOf"]).weekday()>=5 and (
        data["orderWindowOpen"] is not False or
        any(x.get("orderAllowed") for x in candidates)):
        raise ValueError("Weekend order window unexpectedly enabled")
    phases=Counter(str(x.get("signal") or "MISSING") for x in candidates)
    reasons=Counter(reason for x in candidates for reason in x.get("reasons",[]))
    quote_days=Counter(str(x.get("quoteDay") or "NO_DATA") for x in candidates)
    rejected_breakouts=[x for x in candidates if
        x.get("signal")=="PHASE2_BREAKOUT" and x.get("eligible") is not True]
    late=[x for x in candidates if x.get("signal")=="PHASE1_LATE"]
    def view(x):
        return {field:x.get(field) for field in CANDIDATE_FIELDS if field in x}
    def rank(x):
        return (-(x.get("watchScore") if isinstance(x.get("watchScore"),(int,float)) else -1),
                -(x.get("relativeStrength") if isinstance(x.get("relativeStrength"),(int,float)) else -1),
                str(x.get("symbol")))
    return {
        "status":"READ_ONLY_PAPER_SELECTION_AUDIT",
        "as_of":data["asOf"],"benchmark_day":data["benchmarkDay"],
        "expected_signal_week":data.get("signalWeekExpected"),
        "order_window_open":data["orderWindowOpen"],
        "paper_initial_eur":data.get("initialCash"),
        "paper_cash_eur":data.get("cash"),
        "paper_equity_eur":data.get("equity"),
        "positions_open":data.get("positionsOpen"),
        "eur_candidates_total":len(candidates),
        "signals_by_type":dict(sorted(phases.items())),
        "rejection_reasons":dict(reasons.most_common()),
        "quotes_by_day":dict(quote_days.most_common(8)),
        "confirmed_breakouts":phases["PHASE2_BREAKOUT"],
        "rejected_confirmed_breakouts":len(rejected_breakouts),
        "eligible_count":len(eligible),
        "eligible_symbols":[view(x) for x in eligible[:20]],
        "rejected_breakout_examples":[view(x) for x in rejected_breakouts[:20]],
        "phase1_late_count":len(late),
        "phase1_research_only":[view(x) for x in sorted(late,key=rank)[:15]],
        "orders_placed_by_audit":False,
        "decision":"NO_NEW_ORDER" if not eligible or not data["orderWindowOpen"]
            else "ELIGIBLE_PAPER_SIGNALS_FOR_MANUAL_REVIEW_ONLY"
    }

def main():
    started=time.monotonic()
    try:
        with urlopen(API,timeout=120) as response:
            data=json.load(response)
        report=summarize(data)
        report["endpoint_seconds"]=round(time.monotonic()-started,2)
        print(json.dumps(report,ensure_ascii=False,indent=2))
        return 0
    except (HTTPError,URLError,TimeoutError,ValueError,TypeError) as exc:
        print(json.dumps({
            "status":"READ_ONLY_PAPER_SELECTION_BLOCKED",
            "error":str(exc)[:400],
            "orders_placed_by_audit":False,
            "decision":"NO_NEW_ORDER"
        },ensure_ascii=False,indent=2),file=sys.stderr)
        return 1

if __name__=="__main__":
    raise SystemExit(main())
