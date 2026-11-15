import sys
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from diagnose_yahoo_ohlcv import audit_series

def mock_chart():
    return {"chart":{"result":[{
        "meta":{"symbol":"AAF.L","currency":"GBp","exchangeTimezoneName":"Europe/London"},
        "timestamp":[1735776000,1735862400,1735948800,1736208000,1736294400],
        "indicators":{"quote":[{
          "open":[100.0,100.0,100.0,100.0,100.0],
          "high":[102.0,102.0,102.0,102.0,102.0],
          "low":[99.0,99.0,99.0,99.0,99.0],
          "close":[101.0,101.0,101.0,101.0,101.0],
          "volume":[100000,100000,100000,100000,100000]
        }]}
    }]}}

class DiagnoseYahooOHLCVTests(unittest.TestCase):
    def test_clean_quoted_pence_series_without_mutation(self):
        data=mock_chart()
        before=str(data)
        report=audit_series(data,"AAF.L")
        self.assertEqual(report["meta_currency"],"GBp")
        self.assertEqual(report["daily_rows"],5)
        self.assertEqual(report["invalid_rows_by_reason"],{})
        self.assertEqual(report["first_examples"],[])
        self.assertEqual(str(data),before)

    def test_precise_market_day_high_low_issue_and_raw_values(self):
        data=mock_chart()
        q=data["chart"]["result"][0]["indicators"]["quote"][0]
        q["high"][1]=99.9
        q["low"][3]=103.0
        report=audit_series(data,"AAF.L")
        self.assertEqual(report["invalid_rows_by_reason"],
                         {"HIGH_BELOW_OPEN_LOW_CLOSE":1,
                          "LOW_ABOVE_OPEN_HIGH_CLOSE":1})
        self.assertEqual(len(report["first_examples"]),2)
        self.assertGreater(report["relative_gaps"]["high_max_relative_gap"],0)
        self.assertGreater(report["relative_gaps"]["low_max_relative_gap"],0)

    def test_missing_partial_prices_and_fractional_volume_are_not_silenced(self):
        data=mock_chart()
        q=data["chart"]["result"][0]["indicators"]["quote"][0]
        q["close"][2]=None
        q["volume"][4]=1.5
        report=audit_series(data,"AAF.L")
        self.assertEqual(report["invalid_rows_by_reason"],
                         {"NON_POSITIVE_OR_NULL_PRICE":1,"INVALID_VOLUME":1})

    def test_fetch_runs_only_read_only_node_inside_deployed_web_container(self):
        import json
        from unittest.mock import patch
        import diagnose_yahoo_ohlcv as diagnosis
        response={"chart":{"result":[]}}
        class Result:
            returncode=0
            stdout=json.dumps(response)
            stderr=""
        with patch.object(diagnosis.subprocess,"run",return_value=Result()) as call:
            self.assertEqual(diagnosis.fetch_chart("AAF.L"),response)
        cmd=call.call_args.args[0]
        self.assertEqual(cmd[:8],["docker","compose","-p","cto_weinstein",
                                  "exec","-T","web","node"])
        self.assertEqual(cmd[-2:],["--","AAF.L"])
        self.assertIn("range','5y'",cmd[9])

    def test_reject_currency_source_symbol_mismatch_and_bad_columns(self):
        data=mock_chart()
        with self.assertRaisesRegex(ValueError,"ticker mismatch"):
            audit_series(data,"AKER.OL")
        data["chart"]["result"][0]["indicators"]["quote"][0]["high"].pop()
        with self.assertRaisesRegex(ValueError,"Incomplete column"):
            audit_series(data,"AAF.L")

if __name__=="__main__":
    unittest.main()
