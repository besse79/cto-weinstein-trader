import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
import check_eurusd_readiness as m

def data(symbol="SAMPO.HE",bars=2):
    return {"chart":{"result":[{
        "meta":{"symbol":symbol,"currency":m.EXPECTED_CURRENCY[symbol],
                "instrumentType":"EQUITY","exchangeTimezoneName":"Europe/Helsinki"},
        "timestamp":[1735776000,1735862400][:bars],
        "indicators":{"quote":[{
            "open":[100.0,100.0][:bars],
            "high":[102.0,102.0][:bars],
            "low":[99.0,99.0][:bars],
            "close":[101.0,101.0][:bars],
            "volume":[1000,1000][:bars]}]}
    }]}}

class CompletionTests(unittest.TestCase):
    def test_detect_real_source_low_above_close_without_adjusting_it(self):
        chart=data()
        q=chart["chart"]["result"][0]["indicators"]["quote"][0]
        q["close"][1]=95.0
        raw=json.dumps(chart)
        out=m.inspect_chart(chart,"SAMPO.HE")
        self.assertEqual(out["status"],"INVALID_OHLCV")
        self.assertEqual(out["invalid_rows"],1)
        self.assertEqual(out["reasons"]["LOW_TOO_HIGH"],1)
        self.assertEqual(out["first_examples"][0]["ohlcv"]["close"],95.0)
        self.assertEqual(json.dumps(chart),raw)

    def test_newly_listed_stock_under_40_not_reclassified_as_invalid_price(self):
        out=m.inspect_chart(data("VYLR"),"VYLR")
        self.assertEqual(out["status"],"HISTORY_UNDER_40")
        self.assertEqual(out["quote_type"],"EQUITY")
        self.assertEqual(out["invalid_rows"],0)

    def test_non_eur_usd_currency_is_rejected_by_raw_catalog_guard(self):
        chart=data()
        chart["chart"]["result"][0]["meta"]["currency"]="GBP"
        out=m.inspect_chart(chart,"SAMPO.HE")
        self.assertEqual(out["status"],"SYMBOL_OR_CURRENCY_MISMATCH")

    def test_raw_http_404_reported_not_retried_as_empty_candle_import(self):
        class Result:
            returncode=4
            stderr="YAHOO_HTTP_404"
            stdout=""
        with patch.object(m,"process",return_value=Result()) as execute:
            out=m.diagnose_one("KESKOBU0126.HE")
        self.assertEqual(out["status"],"YAHOO_FETCH_BLOCKED")
        self.assertIn("404",out["reason"])
        cmd=execute.call_args.args
        self.assertEqual(cmd[:8],("docker","compose","-p","cto_weinstein",
                                   "exec","-T","web","node"))
        self.assertEqual(cmd[-2:],("--","KESKOBU0126.HE"))

    def test_readonly_queries_report_coverage_and_two_benchmarks(self):
        def query(sql):
            self.assertTrue(sql.lstrip().startswith(("WITH","SELECT")))
            if "SELECT count(*)||'|'" in sql:
                self.assertIn("i.currency IN('USD','EUR')",sql)
                return "806|779|800|25|2"
            return "EXSA.DE|2026-11-13|1281\nSPY|2026-11-13|1255"
        with patch.object(m,"pg",side_effect=query):
            coverage=m.catalog_snapshot()
            reference=m.benchmark_snapshot()
        self.assertEqual(coverage["total"],806)
        self.assertEqual(coverage["fully_audited_5y"],779)
        self.assertTrue(reference["SPY"]["has_friday_close"])
        self.assertTrue(reference["EXSA.DE"]["has_friday_close"])

    def test_paper_candidates_snapshot_preserves_weekend_order_block(self):
        with patch.object(m,"local_json",return_value={
            "mode":"PAPER","asOf":"2026-11-15","orderWindowOpen":False,
            "benchmarkDay":"2026-11-13","eligibleCount":1,
            "candidates":[{"symbol":"AC.PA","eligible":True,"orderAllowed":False}]}):
            result=m.candidate_snapshot()
        self.assertFalse(result["order_window_open"])
        self.assertEqual(result["eligible_symbols"],["AC.PA"])
        self.assertEqual(result["eligible_order_allowed"],0)

if __name__=="__main__":
    unittest.main()
