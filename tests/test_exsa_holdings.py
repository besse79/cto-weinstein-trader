import csv
import tempfile
import unittest
from datetime import date,timedelta
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from prepare_exsa_holdings_preview import convert,snapshot_date,exchange_suffix
from import_index_universe import parse_csv
from fetch_exsa_preview import fetch_preview,SOURCE
from unittest.mock import patch

class ExsaHoldingsTests(unittest.TestCase):
    def fixture(self,d,as_of=None,bad_exchange=False):
        as_of=as_of or date.today().isoformat()
        src=Path(d)/"exsa.csv"
        with src.open("w",encoding="utf-8",newline="") as f:
            writer=csv.writer(f)
            writer.writerow(["EXSA Fund Holdings","research source"])
            writer.writerow(["Fund Holdings as of",as_of])
            writer.writerow([])
            writer.writerow(["Ticker","Name","Asset Class","Market Currency","Exchange"])
            for i in range(600):
                x=i%3
                exchange=["Euronext Paris","London Stock Exchange","SIX Swiss Exchange"][x]
                if bad_exchange and i==0:exchange="UNKNOWN EXCHANGE"
                currency=["EUR","GBP","CHF"][x]
                writer.writerow(["TEST"+str(i),"Company "+str(i),"Equity",currency,exchange])
            writer.writerow(["GBP CASH","Cash","Cash","GBP","-"])
        return src

    def test_600_equities_exported_as_proxy_not_official(self):
        with tempfile.TemporaryDirectory() as d:
            src=self.fixture(d)
            dest=Path(d)/"preview.csv"
            report=convert(src,dest,date.today().isoformat())
            rows=parse_csv(dest)
            self.assertEqual(len(rows),600)
            self.assertEqual(report["holdings"],600)
            self.assertEqual(report["non_equities"],1)
            self.assertEqual({r[0] for r in rows},{"STOXX600_ETF_PROXY"})
            self.assertTrue(any(r[1].endswith(".L") and r[3]=="GBP" for r in rows))
            self.assertTrue(any(r[1].endswith(".SW") and r[3]=="CHF" for r in rows))
            self.assertIn("source_sha256",report)
            with self.assertRaises(ValueError):
                convert(src,dest,date.today().isoformat())

    def test_stale_and_mismatched_snapshot_refused(self):
        with tempfile.TemporaryDirectory() as d:
            src=self.fixture(d)
            dest=Path(d)/"preview.csv"
            with self.assertRaisesRegex(ValueError,"mismatched"):
                convert(src,dest,(date.today()-timedelta(days=1)).isoformat())
            self.assertFalse(dest.exists())

    def test_unknown_exchange_fail_closed(self):
        with tempfile.TemporaryDirectory() as d:
            src=self.fixture(d,bad_exchange=True)
            dest=Path(d)/"preview.csv"
            with self.assertRaisesRegex(ValueError,"Unresolved"):
                convert(src,dest,date.today().isoformat())
            self.assertFalse(dest.exists())

    def test_german_month_and_known_markets(self):
        self.assertEqual(snapshot_date([["Fondspositionen per","14.Nov.2026"]]),date(2026,11,14))
        self.assertEqual(exchange_suffix("NASDAQ OMX COPENHAGEN","DKK"),".CO")
        self.assertIsNone(exchange_suffix("UNKNOWN","EUR"))

    def test_one_shot_official_domain_download_mock(self):
        with tempfile.TemporaryDirectory() as d:
            src=self.fixture(d)
            dest=Path(d)/"online-preview.csv"
            raw=src.read_bytes()
            class Response:
                status=200
                def geturl(self): return SOURCE
                def read(self,n): return raw[:n]
                def __enter__(self): return self
                def __exit__(self,*args): return False
            with patch("fetch_exsa_preview.urllib.request.urlopen",return_value=Response()):
                result=fetch_preview(dest)
            self.assertEqual(result["holdings"],600)
            self.assertEqual(len(parse_csv(dest)),600)
            with self.assertRaises(FileExistsError):
                fetch_preview(dest)

    def test_untrusted_redirect_is_refused_without_writing(self):
        with tempfile.TemporaryDirectory() as d:
            src=self.fixture(d)
            dest=Path(d)/"blocked.csv"
            raw=src.read_bytes()
            class Response:
                status=200
                def geturl(self): return "https://untrusted.example/download"
                def read(self,n): return raw[:n]
                def __enter__(self): return self
                def __exit__(self,*args): return False
            with patch("fetch_exsa_preview.urllib.request.urlopen",return_value=Response()):
                with self.assertRaisesRegex(ValueError,"redirected"):
                    fetch_preview(dest)
            self.assertFalse(dest.exists())

if __name__=="__main__":
    unittest.main()
