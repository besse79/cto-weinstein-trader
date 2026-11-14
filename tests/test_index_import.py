import csv
import tempfile
import unittest
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1] / "scripts"))
from import_index_universe import parse_csv, statement

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

if __name__=="__main__":
    unittest.main()
