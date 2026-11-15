import sys
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
import audit_paper_selection_20261116 as m

def candidate(symbol,signal="WATCH",**extras):
    return {"symbol":symbol,"currency":"EUR","signal":signal,
            "eligible":False,"orderAllowed":False,"quoteDay":"2026-11-13",
            "reasons":["NO_CONFIRMED_BREAKOUT"],"watchScore":45,
            "relativeStrength":3.0,**extras}
def payload(*,day="2026-11-15",n=300,eligible=0):
    items=[candidate("CITEST"+str(i).zfill(3)+".PA") for i in range(n)]
    if eligible:
        items[0]={**items[0],"signal":"PHASE2_BREAKOUT","eligible":True,
                 "orderAllowed":day=="2026-11-16","reasons":[],
                 "quantity":1,"quotePrice":100,"stop":98}
    return {"mode":"PAPER","asOf":day,"benchmarkDay":"2026-11-13",
            "eligibleCount":eligible,"candidates":items,
            "orderWindowOpen":day=="2026-11-16",
            "initialCash":500,"cash":500,"equity":500,
            "positionsOpen":0,"signalWeekExpected":"2026-11-09"}
class PaperSelectionAuditTests(unittest.TestCase):
    def test_zero_signals_is_different_from_weekend_closed(self):
        s=m.summarize(payload())
        self.assertEqual(s["eligible_count"],0)
        self.assertEqual(s["eur_candidates_total"],300)
        self.assertEqual(s["signals_by_type"]["WATCH"],300)
        self.assertEqual(s["rejection_reasons"]["NO_CONFIRMED_BREAKOUT"],300)
        self.assertEqual(s["decision"],"NO_NEW_ORDER")
        self.assertFalse(s["orders_placed_by_audit"])

    def test_weekend_eligible_signal_is_for_research_not_orders(self):
        d=payload(eligible=1)
        s=m.summarize(d)
        self.assertEqual(s["eligible_count"],1)
        self.assertFalse(s["order_window_open"])
        self.assertEqual(s["decision"],"NO_NEW_ORDER")
        self.assertFalse(s["eligible_symbols"][0]["orderAllowed"])

    def test_monday_valid_signal_is_not_an_executed_order(self):
        d=payload(day="2026-11-16",eligible=1)
        s=m.summarize(d)
        self.assertTrue(s["order_window_open"])
        self.assertEqual(s["decision"],"ELIGIBLE_PAPER_SIGNALS_FOR_MANUAL_REVIEW_ONLY")
        self.assertFalse(s["orders_placed_by_audit"])

    def test_breakout_rejected_for_cash_size_is_visible(self):
        d=payload()
        d["candidates"][0]={**d["candidates"][0],"signal":"PHASE2_BREAKOUT",
                            "reasons":["MAX_ALLOCATION"],"quotePrice":400}
        s=m.summarize(d)
        self.assertEqual(s["confirmed_breakouts"],1)
        self.assertEqual(s["rejected_confirmed_breakouts"],1)
        self.assertEqual(s["rejection_reasons"]["MAX_ALLOCATION"],1)
        self.assertEqual(s["rejected_breakout_examples"][0]["symbol"],"CITEST000.PA")

    def test_phase1_watch_not_mislabeled_as_order(self):
        d=payload()
        d["candidates"][0]={**d["candidates"][0],"signal":"PHASE1_LATE",
                            "watchScore":92}
        s=m.summarize(d)
        self.assertEqual(s["phase1_late_count"],1)
        self.assertEqual(s["phase1_research_only"][0]["symbol"],"CITEST000.PA")
        self.assertEqual(s["eligible_count"],0)

    def test_fail_closed_on_outdated_benchmark_or_invalid_counts(self):
        d=payload()
        d["benchmarkDay"]="2026-11-12"
        with self.assertRaisesRegex(ValueError,"Required Friday"):
            m.summarize(d)
        d=payload()
        d["eligibleCount"]=1
        with self.assertRaisesRegex(ValueError,"inconsistent"):
            m.summarize(d)

    def test_fail_closed_on_usd_in_eur_selection_and_weekend_order(self):
        d=payload()
        d["candidates"][0]["currency"]="USD"
        with self.assertRaisesRegex(ValueError,"Non-EUR"):
            m.summarize(d)
        d=payload()
        d["candidates"][0]["orderAllowed"]=True
        with self.assertRaisesRegex(ValueError,"Weekend"):
            m.summarize(d)

if __name__=="__main__":
    unittest.main()
