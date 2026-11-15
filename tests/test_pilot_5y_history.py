import io
import json
from datetime import date,timedelta
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
import pilot_5y_history as pilot

class PilotFiveYearTests(unittest.TestCase):
    def test_dry_run_writes_nothing(self):
        with patch.object(pilot,"guard"),patch.object(pilot,"backup") as saved,\
             patch.object(pilot,"ingest") as send:
            self.assertEqual(pilot.execute(False),0)
        saved.assert_not_called()
        send.assert_not_called()

    def test_rolling_five_year_response_and_paper_preserved(self):
        with tempfile.TemporaryDirectory() as d:
            empty={"bars":0,"first":"","last":""}
            complete={"bars":1200,"first":"2021-11-15","last":date.today().isoformat()}
            counts=iter([empty,complete,empty,complete,empty,complete])
            def remote(token,symbol):
                return {"symbol":symbol,"count":1200,"first":"2021-11-15",
                        "last":(date.today()-timedelta(days=2)).isoformat()}
            with patch.object(pilot,"guard"),patch.object(pilot,"token",return_value="unit-key"),\
                 patch.object(pilot,"paper_hash",return_value="unchanged"),\
                 patch.object(pilot,"backup",return_value=Path(d)),\
                 patch.object(pilot,"existing",side_effect=counts),\
                 patch.object(pilot,"ingest",side_effect=remote) as fetch,\
                 patch.object(pilot,"dashboard",return_value={"mode":"PAPER","initial":500}):
                self.assertEqual(pilot.execute(True),0)
            self.assertEqual([c.args[1] for c in fetch.call_args_list],
                             ["AAPL","AC.PA","ABBN.SW"])
            report=json.loads((Path(d)/"pilot_5y_history.json").read_text())
            self.assertEqual(report["status"],"PILOT_5Y_COMPLETE")
            self.assertEqual(len(report["results"]),3)
            self.assertTrue(report["paper_unchanged"])

    def test_failed_provider_does_not_continue_other_samples(self):
        with tempfile.TemporaryDirectory() as d:
            with patch.object(pilot,"guard"),patch.object(pilot,"token",return_value="unit-key"),\
                 patch.object(pilot,"paper_hash",return_value="stable"),\
                 patch.object(pilot,"backup",return_value=Path(d)),\
                 patch.object(pilot,"existing",return_value={"bars":0,"first":"","last":""}),\
                 patch.object(pilot,"ingest",side_effect=RuntimeError("HTTP 502: Yahoo 429")) as fetch:
                self.assertEqual(pilot.execute(True),1)
            self.assertEqual(fetch.call_count,1)
            report=json.loads((Path(d)/"pilot_5y_history.json").read_text())
            self.assertEqual(report["status"],"PILOT_5Y_BLOCKED")
            self.assertEqual(report["results"],[])
            self.assertIn("429",report["error"])

    def test_five_year_chart_has_minimum_span_guard(self):
        original=pilot.date.today()
        short={"ok":True,"provider":"YAHOO_UNOFFICIAL",
               "results":[{"symbol":"AAPL","count":300,
                           "first":(original-timedelta(days=365)).isoformat(),
                           "last":(original-timedelta(days=2)).isoformat()}]}
        with patch.object(pilot,"urlopen",return_value=io.BytesIO(json.dumps(short).encode())):
            with self.assertRaisesRegex(RuntimeError,"at least 4.5 years"):
                pilot.ingest("safe","AAPL")

if __name__=="__main__":
    unittest.main()
