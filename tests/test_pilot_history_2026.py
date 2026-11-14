import json
from pathlib import Path
from unittest.mock import patch
import tempfile
import unittest
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
import pilot_history_2026 as pilot

class Pilot2026Tests(unittest.TestCase):
    def test_strict_dry_run_without_mutations(self):
        with patch("pilot_history_2026.guards") as guard,\
             patch("pilot_history_2026.execute") as execute:
            with patch("sys.argv",["pilot_history_2026.py"]):
                result=pilot.main()
        self.assertEqual(result,0)
        guard.assert_called_once()
        execute.assert_not_called()

    def test_three_symbols_and_paper_guards_preserved(self):
        with tempfile.TemporaryDirectory() as d:
            folder=Path(d)
            before={"AAPL":0,"MSFT":0,"AC.PA":0}
            current=before.copy()
            def fetch(tok,symbol):
                current[symbol]=215
                return {"symbol":symbol,"count":215,"first":"2026-01-02","last":"2026-11-13"}
            with patch("pilot_history_2026.guards"),\
                 patch("pilot_history_2026.secret",return_value="safe-token"),\
                 patch("pilot_history_2026.fingerprint",return_value="stable"),\
                 patch("pilot_history_2026.backup_verified",return_value=folder),\
                 patch("pilot_history_2026.history_counts",side_effect=lambda:current.copy()),\
                 patch("pilot_history_2026.post_one",side_effect=fetch) as calls,\
                 patch("pilot_history_2026.check_dashboard",return_value={"mode":"PAPER","initial":500}):
                self.assertEqual(pilot.execute(),0)
            self.assertEqual([c.args[1] for c in calls.call_args_list],["AAPL","MSFT","AC.PA"])
            report=json.loads((folder/"pilot_2026.json").read_text())
            self.assertEqual(report["status"],"PILOT_2026_COMPLETE")
            self.assertTrue(report["paper_unchanged"])
            self.assertEqual(len(report["symbols"]),3)

    def test_failure_stops_batches_and_persists_partial_diagnostic(self):
        with tempfile.TemporaryDirectory() as d:
            folder=Path(d)
            calls=[]
            def sync(token,symbol):
                calls.append(symbol)
                raise RuntimeError("Provider refused HTTP 429")
            with patch("pilot_history_2026.guards"),\
                 patch("pilot_history_2026.secret",return_value="safe-token"),\
                 patch("pilot_history_2026.fingerprint",return_value="stable"),\
                 patch("pilot_history_2026.backup_verified",return_value=folder),\
                 patch("pilot_history_2026.history_counts",return_value={"AAPL":0,"MSFT":0,"AC.PA":0}),\
                 patch("pilot_history_2026.post_one",side_effect=sync):
                self.assertEqual(pilot.execute(),1)
            self.assertEqual(calls,["AAPL"])
            report=json.loads((folder/"pilot_2026.json").read_text())
            self.assertEqual(report["status"],"PILOT_2026_BLOCKED")
            self.assertIn("429",report["error"])

if __name__=="__main__":
    unittest.main()
