import csv
import tempfile
import unittest
from datetime import date,timedelta
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from prepare_exsa_holdings_preview import convert,snapshot_date,exchange_suffix
from import_index_universe import parse_csv
from fetch_exsa_preview import fetch_preview,SOURCE,URLS
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

    def test_real_blackrock_market_aliases_have_unambiguous_yahoo_suffixes(self):
        examples=[
            ("Omx Nordic Exchange Copenhagen A/S","DKK",".CO"),
            ("Omx Nordic Exchange Stockholm AB","SEK",".ST"),
            ("Omx Nordic Exchange Helsinki Oy","EUR",".HE"),
            ("Wiener Boer","EUR",".VI"),
            ("Wiener Boerse Ag","EUR",".VI"),
            ("Nasdaq OMX Copenhagen A/S","DKK",".CO"),
            ("Oslo Boers ASA","NOK",".OL"),
            ("Athens Exchange S.A. Cash Market","EUR",".AT"),
            ("Irish Stock Exchange - All Market","EUR",".IR")
        ]
        for place,currency,suffix in examples:
            with self.subTest(place=place):
                self.assertEqual(exchange_suffix(place,currency),suffix)
        self.assertIsNone(exchange_suffix("Unverified Arbitrary Exchange","EUR"))

    def test_49_legacy_nordic_and_vienna_listings_normalize_without_loss(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/"realish.csv"
            with path.open("w",newline="",encoding="utf-8") as fp:
                w=csv.writer(fp)
                w.writerow(["Fund Holdings as of",date.today().isoformat()])
                w.writerow(["Ticker","Name","Asset Class","Market Currency","Exchange"])
                for i in range(600):
                    ticker=f"EXSA{i:03d}"
                    currency="EUR";market="Euronext Paris"
                    if i<24:
                        currency="DKK";market="Omx Nordic Exchange Copenhagen A/S"
                        if i==0:ticker="NOVO B"
                    elif i<44:
                        currency="SEK";market="Omx Nordic Exchange Stockholm AB"
                    elif i<49:
                        currency="EUR";market="Wiener Boerse Ag"
                        if i==44:ticker="EBS"
                    w.writerow([ticker,f"Sample {i}","Equity",currency,market])
            result=Path(d)/"normalized.csv"
            report=convert(path,result,date.today().isoformat())
            self.assertEqual(report["holdings"],600)
            symbols={row[1] for row in parse_csv(result)}
            self.assertIn("NOVO-B.CO",symbols)
            self.assertIn("EBS.VI",symbols)
            self.assertEqual(len(symbols),600)

    def test_blackrock_athens_and_irish_markets_preserve_complete_universe(self):
        with tempfile.TemporaryDirectory() as d:
            input_csv=Path(d)/"exsa_source.csv"
            output_csv=Path(d)/"exsa_normalized.csv"
            with input_csv.open("w",newline="",encoding="utf-8") as fp:
                writer=csv.writer(fp)
                writer.writerow(["Fund Holdings as of",date.today().isoformat()])
                writer.writerow(["Ticker","Name","Asset Class","Market Currency","Exchange"])
                for n in range(600):
                    if n<10:
                        symbol="ALPHA" if n==0 else f"GREEK{n}"
                        venue="Athens Exchange S.A. Cash Market"
                    elif n<16:
                        symbol="KRZ" if n==10 else f"IRISH{n}"
                        venue="Irish Stock Exchange - All Market"
                    else:
                        symbol=f"EURO{n}"
                        venue="Euronext Paris"
                    writer.writerow([symbol,f"Fixture {n}","Equity","EUR",venue])
            report=convert(input_csv,output_csv,date.today().isoformat())
            self.assertEqual(report["holdings"],600)
            symbols={row[1] for row in parse_csv(output_csv)}
            self.assertIn("ALPHA.AT",symbols)
            self.assertIn("KRZ.IR",symbols)
            self.assertEqual(len(symbols),600)

    def test_last_two_blackrock_rejections_are_security_verified(self):
        self.assertEqual(exchange_suffix("Deutsche Börse AG","EUR"),".DE")
        self.assertEqual(exchange_suffix("Deutsche Boerse AG","EUR"),".DE")
        self.assertEqual(exchange_suffix("Nasdaq Omx Nordic","EUR",
                                         "VSURE","Verisure plc"),".ST")
        self.assertIsNone(exchange_suffix("Nasdaq Omx Nordic","EUR",
                                           "UNKNOWN","Other security"))
        self.assertIsNone(exchange_suffix("Nasdaq Omx Nordic","EUR",
                                           "VSURE","Unrelated security"))

    def test_600_components_with_qia_and_eur_verisure(self):
        with tempfile.TemporaryDirectory() as d:
            source=Path(d)/"special.csv"
            destination=Path(d)/"normalized.csv"
            with source.open("w",newline="",encoding="utf-8") as out:
                w=csv.writer(out)
                w.writerow(["Fund Holdings as of",date.today().isoformat()])
                w.writerow(["Ticker","Name","Asset Class","Market Currency","Exchange"])
                for i in range(600):
                    ticker,name,exchange="EUR"+str(i),"European company", "Euronext Paris"
                    if i==0:
                        ticker,name,exchange="QIA","Qiagen N.V.","Deutsche Börse AG"
                    if i==1:
                        ticker,name,exchange="VSURE","Verisure plc","Nasdaq Omx Nordic"
                    w.writerow([ticker,name,"Equity","EUR",exchange])
            result=convert(source,destination,date.today().isoformat())
            self.assertEqual(result["holdings"],600)
            rows=parse_csv(destination)
            symbols={x[1]:x[3] for x in rows}
            self.assertEqual(symbols["QIA.DE"],"EUR")
            self.assertEqual(symbols["VSURE.ST"],"EUR")
            self.assertEqual(len(rows),600)

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

    def test_first_published_url_404_then_legacy_official_fallback(self):
        import urllib.error
        with tempfile.TemporaryDirectory() as d:
            source=self.fixture(d)
            destination=Path(d)/"fallback.csv"
            raw=source.read_bytes()
            requested=[]
            class Response:
                status=200
                def geturl(self):return URLS[1]
                def read(self,n):return raw[:n]
                def __enter__(self):return self
                def __exit__(self,*args):return False
            def fetch(req,timeout):
                requested.append(req.full_url)
                if len(requested)==1:
                    raise urllib.error.HTTPError(req.full_url,404,"Not Found",{},None)
                return Response()
            with patch("fetch_exsa_preview.urllib.request.urlopen",side_effect=fetch):
                result=fetch_preview(destination)
            self.assertEqual(len(requested),2)
            self.assertEqual(result["holdings"],600)
            self.assertEqual(result["source_url"],URLS[1])

    def test_authorized_local_file_can_be_used_without_request(self):
        with tempfile.TemporaryDirectory() as d:
            source=self.fixture(d)
            destination=Path(d)/"local.csv"
            with patch("fetch_exsa_preview.urllib.request.urlopen") as remote:
                result=fetch_preview(destination,local_file=source)
                remote.assert_not_called()
            self.assertEqual(result["holdings"],600)
            self.assertEqual(result["source_url"],"LOCAL_AUTHORIZED_ISHARES_CSV")

    def test_provider_rate_limit_does_not_cascade_to_other_endpoints(self):
        import urllib.error
        with tempfile.TemporaryDirectory() as d:
            destination=Path(d)/"blocked.csv"
            def refuse(req,timeout):
                raise urllib.error.HTTPError(req.full_url,429,"Rate limited",{},None)
            with patch("fetch_exsa_preview.urllib.request.urlopen",side_effect=refuse) as remote:
                with self.assertRaisesRegex(ValueError,"refused/rate limited"):
                    fetch_preview(destination)
                self.assertEqual(remote.call_count,1)
            self.assertFalse(destination.exists())

if __name__=="__main__":
    unittest.main()
