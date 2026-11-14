import sys
import unittest
from datetime import date
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from v4_release_gate import evaluate

def fixtures():
    dashboard={"mode":"PAPER","initial":500,"cash":500,"equity":500}
    market={"coverage":{"instruments":26,"with_history":26,"recent":26},
            "jobs":[{"job_type":"BOOTSTRAP","status":"SUCCESS"},
                    {"job_type":"EU_CLOSE","status":"SUCCESS"}]}
    candidates={"mode":"PAPER","initialCash":500,"eligibleCount":0,"candidates":[]}
    backtest={"instrumentsTested":24,"result":{
        "mode":"PAPER_PORTFOLIO_BACKTEST","initialCash":500,"finalEquity":510}}
    return dashboard,market,candidates,backtest

class V4ReleaseGateTest(unittest.TestCase):
    def check(self,rows):
        return evaluate(*rows,today=date(2026,11,14))

    def test_paper_research_ready_but_not_certified(self):
        output=self.check(fixtures())
        self.assertEqual(output["status"],"MANUAL_PAPER_REVIEW")
        self.assertIn("BACKTEST_SURVIVORSHIP_BIAS_NOT_RESOLVED",output["limitations"])

    def test_stale_incomplete_market_blocks(self):
        rows=fixtures()
        rows[1]["coverage"]["recent"]=25
        self.assertIn("UNIVERSE_HISTORY_INCOMPLETE_OR_STALE",self.check(rows)["blockers"])

    def test_bad_currency_purchase_blocks(self):
        rows=fixtures()
        rows[2]["eligibleCount"]=1
        rows[2]["candidates"]=[{"eligible":True,"currency":"USD","quantity":1,"reasons":[]}]
        self.assertIn("INCONSISTENT_PAPER_ENTRY",self.check(rows)["blockers"])

    def test_failed_jobs_block(self):
        rows=fixtures()
        rows[1]["jobs"]=[{"job_type":"EU_CLOSE","status":"FAILED"}]
        self.assertIn("NO_SUCCESSFUL_COLLECTION_JOB",self.check(rows)["blockers"])

    def test_backtest_scope_blocks(self):
        rows=fixtures()
        rows[3]["instrumentsTested"]=151
        self.assertIn("PORTFOLIO_BACKTEST_SCOPE_EXCEEDED",self.check(rows)["blockers"])

if __name__=="__main__":
    unittest.main()
