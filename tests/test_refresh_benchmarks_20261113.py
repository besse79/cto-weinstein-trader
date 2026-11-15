import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
import refresh_benchmarks_20261113 as m

BEFORE={"EXSA.DE":{"first":"2021-11-15","last":"2026-11-12","bars":1274},
        "SPY":{"first":"2021-11-15","last":"2026-11-12","bars":1255}}
AFTER={"EXSA.DE":{"first":"2021-11-15","last":"2026-11-13","bars":1275},
       "SPY":{"first":"2021-11-15","last":"2026-11-13","bars":1256}}
SYNC=[{"symbol":"EXSA.DE","count":64,"first":"2026-08-17","last":"2026-11-13"},
      {"symbol":"SPY","count":64,"first":"2026-08-17","last":"2026-11-13"}]
CANDIDATES={"as_of":"2026-11-15","benchmark_day":"2026-11-13",
            "eligible_count":0,"eligible_symbols":[],
            "order_window_open":False,"order_allowed_symbols":[]}

class BenchmarkFridayTests(unittest.TestCase):
    def test_readonly_dry_run_writes_nothing(self):
        with patch.object(m,"guard"),\
             patch.object(m,"latest_benchmarks",return_value=BEFORE),\
             patch.object(m,"verified_backup") as backup,\
             patch.object(m,"sync_benchmarks") as sync:
            self.assertEqual(m.execute(False),0)
        backup.assert_not_called()
        sync.assert_not_called()

    def test_success_paper_unchanged_even_when_no_eligible_candidates(self):
        with tempfile.TemporaryDirectory() as d:
            with patch.object(m,"guard"),\
                 patch.object(m,"latest_benchmarks",side_effect=[BEFORE,AFTER]),\
                 patch.object(m,"verified_backup",return_value=Path(d)),\
                 patch.object(m,"token",return_value="local-secret"),\
                 patch.object(m,"paper_hash",return_value="unchanged"),\
                 patch.object(m,"dashboard",return_value={"mode":"PAPER","initial":500}),\
                 patch.object(m,"sync_benchmarks",return_value=SYNC) as sync,\
                 patch.object(m,"paper_candidates",return_value=CANDIDATES):
                self.assertEqual(m.execute(True),0)
            sync.assert_called_once_with("local-secret")
            r=json.loads((Path(d)/m.REPORT).read_text())
            self.assertEqual(r["status"],"FRIDAY_BENCHMARKS_COMPLETE")
            self.assertTrue(r["paper_unchanged"])
            self.assertFalse(r["orders_placed"])
            self.assertEqual(r["paper_candidates"]["eligible_count"],0)

    def test_sync_failure_remains_blocked_and_records_verified_backup(self):
        with tempfile.TemporaryDirectory() as d:
            with patch.object(m,"guard"),\
                 patch.object(m,"latest_benchmarks",return_value=BEFORE),\
                 patch.object(m,"verified_backup",return_value=Path(d)),\
                 patch.object(m,"token",return_value="local-secret"),\
                 patch.object(m,"paper_hash",return_value="stable"),\
                 patch.object(m,"sync_benchmarks",side_effect=RuntimeError("HTTP 502: Invalid Yahoo OHLCV")):
                self.assertEqual(m.execute(True),1)
            r=json.loads((Path(d)/m.REPORT).read_text())
            self.assertEqual(r["status"],"FRIDAY_BENCHMARKS_BLOCKED")
            self.assertTrue(r["paper_unchanged"])
            self.assertIn("Invalid Yahoo OHLCV",r["reason"])

    def test_no_false_success_if_friday_missing_for_one_benchmark(self):
        with tempfile.TemporaryDirectory() as d:
            partial={"EXSA.DE":AFTER["EXSA.DE"],"SPY":BEFORE["SPY"]}
            with patch.object(m,"guard"),\
                 patch.object(m,"latest_benchmarks",side_effect=[BEFORE,partial]),\
                 patch.object(m,"verified_backup",return_value=Path(d)),\
                 patch.object(m,"token",return_value="local-secret"),\
                 patch.object(m,"paper_hash",return_value="stable"),\
                 patch.object(m,"sync_benchmarks",return_value=SYNC):
                self.assertEqual(m.execute(True),1)
            r=json.loads((Path(d)/m.REPORT).read_text())
            self.assertEqual(r["status"],"FRIDAY_BENCHMARKS_BLOCKED")
            self.assertIn("SPY",r["reason"])

    def test_no_rerequest_when_both_benchmarks_current(self):
        with patch.object(m,"guard"),\
             patch.object(m,"latest_benchmarks",return_value=AFTER),\
             patch.object(m,"paper_candidates",return_value=CANDIDATES),\
             patch.object(m,"verified_backup") as backup,\
             patch.object(m,"token") as token,\
             patch.object(m,"sync_benchmarks") as sync:
            self.assertEqual(m.execute(True),0)
        backup.assert_not_called()
        token.assert_not_called()
        sync.assert_not_called()

    def test_guarded_api_only_delta_and_two_reference_symbols(self):
        import io
        response={"ok":True,"provider":"YAHOO_UNOFFICIAL","mode":"PAPER","window":"3mo",
                  "results":SYNC}
        with patch.object(m,"urlopen",return_value=io.BytesIO(json.dumps(response).encode())) as api:
            output=m.sync_benchmarks("test-token")
        self.assertEqual(len(output),2)
        request=api.call_args.args[0]
        self.assertEqual(request.get_method(),"POST")
        self.assertEqual(json.loads(request.data),{
            "symbols":["EXSA.DE","SPY"],"mode":"delta","scheduled":False})

    def test_refuse_unconfirmed_friday_from_yahoo(self):
        import io
        report={"ok":True,"provider":"YAHOO_UNOFFICIAL","mode":"PAPER","window":"3mo",
                "results":[SYNC[0],{**SYNC[1],"last":"2026-11-12"}]}
        with patch.object(m,"urlopen",return_value=io.BytesIO(json.dumps(report).encode())):
            with self.assertRaisesRegex(RuntimeError,"Friday 13 November for SPY"):
                m.sync_benchmarks("test-token")

if __name__=="__main__":
    unittest.main()
