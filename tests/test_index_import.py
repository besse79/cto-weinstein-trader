import csv
import tempfile
import unittest
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1] / "scripts"))
from import_index_universe import parse_csv, statement
from prepare_sp500_snapshot import convert
from fetch_sp500_preview import fetch_preview
from unittest.mock import patch
import io

class IndexImportTests(unittest.TestCase):
    def write(self, rows):
        fd=tempfile.NamedTemporaryFile(mode="w",newline="",encoding="utf-8",suffix=".csv",delete=False)
        try:
            writer=csv.writer(fd)
            writer.writerow(["index_code","symbol","name","currency"])
            writer.writerows(rows)
            fd.close()
            self.addCleanup(lambda: Path(fd.name).unlink(missing_ok=True))
            return Path(fd.name)
        except:
            fd.close()
            raise

    def test_two_indices_and_non_eur_members(self):
        rows=parse_csv(self.write([
            ["SP500","AAPL","Apple","USD"],
            ["STOXX600","NESN.SW","Nestle","CHF"],
            ["STOXX600","AZN.L","AstraZeneca","GBP"]]))
        self.assertEqual(len(rows),3)
        sql=statement(rows,"2026-11-14","Approved issuer CSV")
        self.assertIn("pg_advisory_xact_lock",sql)
        self.assertIn("ON CONFLICT(symbol) DO NOTHING",sql)
        self.assertIn("index_constituent_observations",sql)
        self.assertIn("BEGIN;",sql)
        self.assertIn("COMMIT;",sql)

    def test_sql_literal_escaped(self):
        sql=statement(parse_csv(self.write([["STOXX600","AI.PA","L'Oreal","EUR"]])),
                      "2026-11-14","Source's file")
        self.assertIn("4c274f7265616c",sql)
        self.assertIn("536f7572636527732066696c65",sql)
        self.assertNotIn("L'Oreal",sql)

    def test_duplicate_refused(self):
        file=self.write([["SP500","AAPL","Apple","USD"],["SP500","AAPL","Apple","USD"]])
        with self.assertRaisesRegex(ValueError,"Duplicate"):
            parse_csv(file)

    def test_currency_conflict_refused(self):
        file=self.write([["SP500","ABC","Corp","USD"],["STOXX600","ABC","Corp","EUR"]])
        with self.assertRaisesRegex(ValueError,"Conflicting currency"):
            parse_csv(file)

    def test_reject_invalid_symbols(self):
        for symbol in ["AAPL;DROP","../SECRET","AAAA AAA",""]:
            with self.subTest(symbol=symbol):
                with self.assertRaises(ValueError):
                    parse_csv(self.write([["SP500",symbol,"Invalid","USD"]]))

    def test_sp500_normalization_offline(self):
        rows=[["X"+str(i).zfill(3), "Company "+str(i)] for i in range(503)]
        with tempfile.TemporaryDirectory() as d:
            src=Path(d)/"source.csv"
            dst=Path(d)/"snapshot.csv"
            with src.open("w",newline="",encoding="utf-8") as stream:
                writer=csv.writer(stream)
                writer.writerow(["Symbol","Name"])
                writer.writerows(rows)
            self.assertEqual(convert(src,dst),503)
            normalized=parse_csv(dst)
            self.assertEqual(len(normalized),503)
            self.assertEqual(normalized[0],("SP500","X000","Company 0","USD"))
            with self.assertRaises(FileExistsError):
                convert(src,dst)

    def test_bad_sp500_snapshot_never_writes(self):
        with tempfile.TemporaryDirectory() as d:
            src=Path(d)/"invalid.csv"
            dst=Path(d)/"result.csv"
            src.write_text("Symbol,Name\\nABC,Example\\n")
            with self.assertRaisesRegex(ValueError,"component count"):
                convert(src,dst)
            self.assertFalse(dst.exists())

    def test_preview_download_mock_has_no_database_effect(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            dest=Path(d)/"preview.csv"
            source="symbol,security,date\\n"+ "".join(
                f"T{i:03d},Test Company {i},2026-11-14\\n" for i in range(503))
            class FakeResponse:
                status=200
                def geturl(self):
                    from fetch_sp500_preview import SOURCE
                    return SOURCE
                def read(self,n):
                    return source.encode()[:n]
                def __enter__(self): return self
                def __exit__(self,*args): return False
            with patch("fetch_sp500_preview.urllib.request.urlopen",return_value=FakeResponse()):
                result=fetch_preview(dest,day="2026-11-14")
            self.assertEqual(result["count"],503)
            self.assertEqual(len(parse_csv(dest)),503)

    def test_preview_rejects_stale_source(self):
        with tempfile.TemporaryDirectory() as d:
            dest=Path(d)/"preview.csv"
            source="symbol,security,date\\n"+ "".join(
                f"T{i:03d},Test Company {i},2026-11-13\\n" for i in range(503))
            class FakeResponse:
                status=200
                def geturl(self):
                    from fetch_sp500_preview import SOURCE
                    return SOURCE
                def read(self,n):
                    return source.encode()[:n]
                def __enter__(self): return self
                def __exit__(self,*args): return False
            with patch("fetch_sp500_preview.urllib.request.urlopen",return_value=FakeResponse()):
                with self.assertRaisesRegex(ValueError,"date mismatch"):
                    fetch_preview(dest,day="2026-11-14")
            self.assertFalse(dest.exists())

if __name__=="__main__":
    unittest.main()
