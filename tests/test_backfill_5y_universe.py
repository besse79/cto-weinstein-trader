import json
from datetime import date,timedelta
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
import backfill_5y_universe as m

def item(symbol,currency="USD",audited=False):
    return {"symbol":symbol,"currency":currency,"bars":0,"first":"","last":"","audited_5y":audited}

def sample_chart(symbol,count=1200,short=False):
    start=date.today()-timedelta(days=450 if short else 365*4+220)
    return {"symbol":symbol,"first":start.isoformat(),
            "last":(date.today()-timedelta(days=2)).isoformat(),
            "count":count}

class BackfillFiveYearTests(unittest.TestCase):
    def test_three_prior_five_year_pilots_are_skipped(self):
        rows={}
        for i in range(1105):
            s="X"+str(i).zfill(4)
            rows[s]=item(s,audited=i<3)
        state={"version":1,"completed":{},"blocked":{}}
        pending=m.available(rows,state)
        self.assertEqual(len(pending),1102)
        self.assertFalse(any(x["audited_5y"] for x in pending))
        self.assertEqual(len(m.balanced(pending,48)),48)

    def test_six_raw_yahoo_defects_stay_quarantined_until_explicit_retry(self):
        tickers=("AAF.L","AAL.L","ABDN.L","AKER.OL","ABF.L","ADM.L")
        rows={s:item(s,"GBP" if s.endswith(".L") else "NOK") for s in tickers}
        rows["AAPL"]=item("AAPL")
        state={"version":1,"completed":{},"blocked":{}}
        self.assertEqual([v["symbol"] for v in m.available(rows,state)],["AAPL"])
        self.assertEqual(len(m.available(rows,state,retry_blocked=True)),1)
        self.assertEqual(sum(len(v) for v in m.KNOWN_OHLCV_QUARANTINE.values()),10)
        self.assertEqual(len(m.KNOWN_OHLCV_QUARANTINE),6)

    def test_weighted_eur_usd_only_even_across_large_waves(self):
        rows=[]
        for currency in m.CURRENCIES:
            rows.extend([item(currency+str(i).zfill(3),currency) for i in range(200)])
        chosen=m.balanced(rows,180)
        self.assertEqual(len(chosen),180)
        self.assertEqual(len({x["symbol"] for x in chosen}),180)
        self.assertEqual({x["currency"] for x in chosen},{"USD","EUR"})
        self.assertEqual(sum(x["currency"]=="USD" for x in chosen),104)
        self.assertEqual(sum(x["currency"]=="EUR" for x in chosen),76)

    def test_available_rejects_non_target_currencies_even_explicit_retry(self):
        rows={c:item("CURRENCY"+c,c) for c in m.CURRENCIES}
        state={"version":1,"completed":{},"blocked":{}}
        self.assertEqual({r["currency"] for r in m.available(rows,state)},
                         {"USD","EUR"})
        self.assertEqual({r["currency"] for r in m.available(rows,state,retry_blocked=True)},
                         {"USD","EUR"})

    def test_excluded_currencies_are_not_requested_in_execute(self):
        rows={"AAPL":item("AAPL","USD"),"AC.PA":item("AC.PA","EUR"),
              "BP.L":item("BP.L","GBP")}
        with patch.object(m,"guards"),patch.object(m,"catalog_rows",return_value=rows),\
             patch.object(m,"load_state",return_value={"version":1,"completed":{},"blocked":{}}),\
             patch.object(m,"verified_backup") as save,\
             patch.object(m,"request_5y") as request:
            self.assertEqual(m.execute(limit=10),0)
        save.assert_not_called()
        request.assert_not_called()

    def test_last_week_provider_error_is_temporarily_skipped_not_hidden(self):
        entries={"AAPL":item("AAPL"),"MSFT":item("MSFT")}
        now=date.today()
        checkpoint={"version":1,"completed":{},"blocked":{
            "AAPL":{"reason":"HTTP 404","retry_after":(now+timedelta(days=1)).isoformat()}
        }}
        self.assertEqual([x["symbol"] for x in m.available(entries,checkpoint)],["MSFT"])
        self.assertEqual(len(m.available(entries,checkpoint,retry_blocked=True)),2)
        checkpoint["completed"]["MSFT"]={
            "currency":"USD","checked":now.isoformat(),
            "last":(now-timedelta(days=2)).isoformat()
        }
        self.assertEqual(m.available(entries,checkpoint),[])

    def test_dry_run_never_reads_secret_or_writes_database(self):
        rows={"AAPL":item("AAPL"),"MSFT":item("MSFT")}
        with patch.object(m,"guards"),patch.object(m,"catalog_rows",return_value=rows),\
             patch.object(m,"load_state",return_value={"version":1,"completed":{},"blocked":{}}),\
             patch.object(m,"verified_backup") as save,\
             patch.object(m,"get_token") as key,\
             patch.object(m,"request_5y") as sync:
            self.assertEqual(m.execute(limit=2),0)
        save.assert_not_called()
        key.assert_not_called()
        sync.assert_not_called()

    def test_successes_and_short_ipo_are_checkpointed_without_paper_changes(self):
        rows={"AAPL":item("AAPL"),"IPO.PA":item("IPO.PA","EUR")}
        with tempfile.TemporaryDirectory() as d:
            home=Path(d)
            response=lambda token,symbol:sample_chart(symbol,300,True) if symbol=="IPO.PA" else sample_chart(symbol)
            with patch.object(m,"guards"),patch.object(m,"catalog_rows",return_value=rows),\
                 patch.object(m,"load_state",return_value={"version":1,"completed":{},"blocked":{}}),\
                 patch.object(m,"get_token",return_value="unit-token"),\
                 patch.object(m,"paper_hash",return_value="stable"),\
                 patch.object(m,"verified_backup",return_value=home),\
                 patch.object(m,"request_5y",side_effect=response) as sync,\
                 patch.object(m,"check_import",return_value=1200),\
                 patch.object(m,"dashboard",return_value={"mode":"PAPER","initial":500}),\
                 patch.object(m.time,"sleep"),\
                 patch.object(m,"STATE_FILE",home/"state.json"):
                self.assertEqual(m.execute(apply=True,limit=2),0)
            self.assertEqual(sync.call_count,2)
            report=json.loads((home/"backfill_5y_wave.json").read_text())
            self.assertEqual(report["status"],"COMPLETE")
            self.assertEqual(len(report["successful"]),1)
            self.assertEqual(len(report["short_history"]),1)
            self.assertTrue(report["paper_unchanged"])
            state=json.loads((home/"state.json").read_text())
            self.assertTrue(state["completed"]["AAPL"]["full_5y"])
            self.assertFalse(state["completed"]["IPO.PA"]["full_5y"])
            self.assertEqual(m.available(rows,state),[])

    def test_429_stops_immediately_and_does_not_retry(self):
        rows={"AAPL":item("AAPL"),"MSFT":item("MSFT")}
        with tempfile.TemporaryDirectory() as d:
            home=Path(d)
            with patch.object(m,"guards"),patch.object(m,"catalog_rows",return_value=rows),\
                 patch.object(m,"load_state",return_value={"version":1,"completed":{},"blocked":{}}),\
                 patch.object(m,"get_token",return_value="unit-token"),\
                 patch.object(m,"paper_hash",return_value="stable"),\
                 patch.object(m,"verified_backup",return_value=home),\
                 patch.object(m,"request_5y",side_effect=RuntimeError("HTTP 502: Yahoo provider unavailable (HTTP 429)")) as sync,\
                 patch.object(m,"dashboard",return_value={"mode":"PAPER","initial":500}),\
                 patch.object(m.time,"sleep") as sleep,\
                 patch.object(m,"STATE_FILE",home/"state.json"):
                self.assertEqual(m.execute(apply=True,limit=2),1)
            self.assertEqual(sync.call_count,1)
            sleep.assert_not_called()
            report=json.loads((home/"backfill_5y_wave.json").read_text())
            self.assertEqual(report["status"],"STOPPED_PROVIDER_REFUSAL")
            self.assertFalse(report["successful"])

    def test_invalid_count_and_stale_data_are_rejected(self):
        body={"ok":True,"mode":"PAPER","provider":"YAHOO_UNOFFICIAL",
              "results":[{"symbol":"AAPL","count":41,"first":"2023-01-01","last":"2024-01-01"}]}
        class Response:
            status=200
            def __enter__(self):return self
            def __exit__(self,*a):pass
            def read(self):return json.dumps(body).encode()
        with patch.object(m,"urlopen",return_value=Response()):
            with self.assertRaisesRegex(RuntimeError,"stale or future"):
                m.request_5y("test","AAPL")

if __name__=="__main__":
    unittest.main()
