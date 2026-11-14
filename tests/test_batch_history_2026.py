import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
import batch_history_2026 as b

def catalog_fixture():
    rows=[]
    for currency,count in [("USD",90),("EUR",90),("GBP",20),("CHF",20),
                           ("SEK",20),("DKK",20),("NOK",20),("PLN",20)]:
        for n in range(count):
            bars=219 if currency=="USD" and n==0 else 0
            rows.append(f"{currency}{n:03d}.PA\t{currency}\t{bars}")
    return "\n".join(rows)

class BatchHistory2026Tests(unittest.TestCase):
    def test_balanced_24_and_excludes_completed_pilot(self):
        with patch.object(b,"sql",return_value=catalog_fixture()) as query:
            selected,pending,unique=b.candidates()
        self.assertEqual(len(selected),24)
        self.assertEqual(unique,300)
        self.assertEqual(pending,299)
        self.assertEqual({currency:sum(x[1]==currency for x in selected)
                          for currency in b.QUOTAS},b.QUOTAS)
        self.assertFalse(any(x[0]=="USD000.PA" for x in selected))
        self.assertIn("SELECT DISTINCT instrument_id",query.call_args.args[0])
        self.assertNotIn("JOIN index_constituent_observations o",query.call_args.args[0])

    def test_dry_run_no_backup_or_network(self):
        with patch.object(b,"guard"),patch.object(b,"candidates",
                return_value=([("AAPL","USD",0)],1,1105)),\
             patch.object(b,"backup") as backup,patch.object(b,"token_request") as fetch:
            self.assertEqual(b.execute(apply=False),0)
        backup.assert_not_called()
        fetch.assert_not_called()

    def test_one_complete_batch_keeps_paper_and_audits(self):
        with tempfile.TemporaryDirectory() as d:
            selection=[("USA","USD",0),("EU.PA","EUR",0)]
            def fake_sql(q):
                if "count(*) FROM candles" in q:return "219"
                raise AssertionError("Unexpected SQL: "+q)
            def result(token,symbol):
                return {"symbol":symbol,"count":219,"first":"2026-01-02",
                        "last":"2026-11-13"}
            with patch.object(b,"guard"),patch.object(b,"candidates",
                    return_value=(selection,1100,1105)),\
                 patch.object(b,"get_token",return_value="unit-token"),\
                 patch.object(b,"backup",return_value=Path(d)),\
                 patch.object(b,"paper_hash",return_value="stable"),\
                 patch.object(b,"token_request",side_effect=result) as client,\
                 patch.object(b,"sql",side_effect=fake_sql),\
                 patch.object(b,"time") as clock,\
                 patch.object(b,"urlopen") as openurl:
                class Payload:
                    def __enter__(self):return self
                    def __exit__(self,*args):return False
                    def read(self):return b''
                openurl.return_value=Payload()
                with patch.object(b,"json") as js:
                    js.dumps=json.dumps
                    js.dump=json.dump
                    js.load=lambda response:{"mode":"PAPER","initial":500}
                    # json mocked for endpoint only, report needs original dump
                    with patch.object(b,"report",side_effect=lambda folder,value:
                         (Path(folder)/"batch.json").write_text(json.dumps(value))):
                        self.assertEqual(b.execute(apply=True),0)
            self.assertEqual([c.args[1] for c in client.call_args_list],["USA","EU.PA"])
            self.assertEqual(json.loads((Path(d)/"batch.json").read_text())["status"],"COMPLETE")
            self.assertEqual(clock.sleep.call_count,1)

    def test_429_halts_without_second_symbol(self):
        with tempfile.TemporaryDirectory() as d:
            with patch.object(b,"guard"),patch.object(b,"candidates",
                    return_value=([("A","USD",0),("B","EUR",0)],2,1105)),\
                 patch.object(b,"get_token",return_value="token"),\
                 patch.object(b,"backup",return_value=Path(d)),\
                 patch.object(b,"paper_hash",return_value="stable"),\
                 patch.object(b,"token_request",side_effect=RuntimeError("HTTP 502: Yahoo provider unavailable (HTTP 429)")) as client,\
                 patch.object(b,"urlopen") as network,\
                 patch.object(b.time,"sleep") as sleep:
                network.return_value.read.return_value=b'{"mode":"PAPER","initial":500}'
                self.assertEqual(b.execute(apply=True),1)
            self.assertEqual(client.call_count,1)
            sleep.assert_not_called()
            report=json.loads((Path(d)/"v4_1_batch_2026.json").read_text())
            self.assertEqual(report["status"],"STOPPED_PROVIDER_REFUSAL")
            self.assertEqual(len(report["blocked"]),1)

if __name__=="__main__":
    unittest.main()
