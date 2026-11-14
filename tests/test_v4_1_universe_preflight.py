import csv
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from v4_1_universe_preflight import run

def fixture(dest,count,code):
    with dest.open("x",newline="",encoding="utf-8") as f:
        w=csv.writer(f)
        w.writerow(["index_code","symbol","name","currency"])
        for i in range(count):
            suffix=".PA" if code!="SP500" else ""
            w.writerow([code,"TEST"+str(i)+suffix,"Company"+str(i),"EUR" if suffix else "USD"])
    return {"count":count,"source_sha256":"fixture_sha"}

class SourcePreflightTest(unittest.TestCase):
    def test_two_public_sources_are_prepared_without_database_access(self):
        with tempfile.TemporaryDirectory() as d:
            with patch("v4_1_universe_preflight.fetch_us",side_effect=lambda p,day:fixture(p,503,"SP500")),\
                 patch("v4_1_universe_preflight.fetch_europe",side_effect=lambda p,as_of:fixture(p,600,"STOXX600_ETF_PROXY")):
                out=run(output_base=Path(d))
            self.assertEqual(out["status"],"PREVIEWS_COMPLETE")
            self.assertEqual(out["total_rows"],1103)
            self.assertEqual(out["validated_rows"]["SP500"],503)
            self.assertEqual(out["validated_rows"]["STOXX600_ETF_PROXY"],600)

    def test_one_source_failure_is_not_disguised_as_complete(self):
        with tempfile.TemporaryDirectory() as d:
            with patch("v4_1_universe_preflight.fetch_us",side_effect=lambda p,day:fixture(p,503,"SP500")),\
                 patch("v4_1_universe_preflight.fetch_europe",side_effect=ValueError("Access denied")):
                out=run(output_base=Path(d))
            self.assertEqual(out["status"],"INCOMPLETE")
            self.assertEqual(out["total_rows"],503)
            self.assertEqual(out["sources"]["STOXX600_ETF_PROXY"]["status"],"BLOCKED")

if __name__=="__main__":
    unittest.main()
