import csv
from datetime import date
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from stage_v4_universe import validate,transactional_sql

def create_fixture(folder,*,date_us=None,date_europe=None):
    folder=Path(folder)
    dates={"SP500":date_us or date.today().isoformat(),
           "STOXX600_ETF_PROXY":date_europe or date.today().isoformat()}
    files={}
    for code,n in [("SP500",503),("STOXX600_ETF_PROXY",602)]:
        dest=folder/(code+".csv")
        with dest.open("x",encoding="utf-8",newline="") as stream:
            writer=csv.writer(stream)
            writer.writerow(["index_code","symbol","name","currency"])
            for i in range(n):
                symbol=("US"+str(i)) if code=="SP500" else ("EU"+str(i)+".PA")
                writer.writerow([code,symbol,"Fixture "+str(i),"USD" if code=="SP500" else "EUR"])
        files[code]=(dest,hashlib.sha256(dest.read_bytes()).hexdigest())
    manifest={
        "status":"PREVIEWS_COMPLETE",
        "sources":{
            "SP500_PUBLIC_THIRD_PARTY":{"file":str(files["SP500"][0]),
                "snapshot_day":dates["SP500"],"source_sha256":files["SP500"][1]},
            "STOXX600_ETF_PROXY":{"file":str(files["STOXX600_ETF_PROXY"][0]),
                "snapshot_day":dates["STOXX600_ETF_PROXY"],
                "output_sha256":files["STOXX600_ETF_PROXY"][1]}
        },
        "validated_rows":{"SP500":503,"STOXX600_ETF_PROXY":602},
        "total_rows":1105
    }
    file=folder/"manifest.json"
    file.write_text(json.dumps(manifest),encoding="utf-8")
    return file,files

class V4StageTests(unittest.TestCase):
    def test_all_1105_snapshot_rows_are_one_atomic_sql_transaction(self):
        with tempfile.TemporaryDirectory() as d:
            manifest,_=create_fixture(d)
            parts,currencies=validate(manifest)
            self.assertEqual([len(p["rows"]) for p in parts],[503,602])
            self.assertEqual(currencies,{"USD":503,"EUR":602})
            sql=transactional_sql(parts)
            self.assertEqual(sql.count("BEGIN;"),1)
            self.assertEqual(sql.count("COMMIT;"),1)
            self.assertEqual(sql.count("INSERT INTO index_constituent_observations"),1105)
            self.assertIn("pg_advisory_xact_lock",sql)
            self.assertIn("STOXX600_ETF_PROXY",str(parts))

    def test_checksum_tampering_blocks_before_any_import(self):
        with tempfile.TemporaryDirectory() as d:
            manifest,files=create_fixture(d)
            with files["SP500"][0].open("a") as out:
                out.write("SP500,EVIL,No provenance,USD\n")
            with self.assertRaisesRegex(ValueError,"SHA256"):
                validate(manifest)

    def test_unverified_or_future_date_blocks(self):
        with tempfile.TemporaryDirectory() as d:
            manifest,_=create_fixture(d,date_europe="2025-01-01")
            with self.assertRaisesRegex(ValueError,"stale"):
                validate(manifest)
        with tempfile.TemporaryDirectory() as d:
            manifest,_=create_fixture(d)
            raw=json.loads(manifest.read_text())
            raw["sources"]["SP500_PUBLIC_THIRD_PARTY"]["snapshot_day"]="SEE_PRIOR_PROVENANCE_REPORT"
            manifest.write_text(json.dumps(raw))
            with self.assertRaises(ValueError):
                validate(manifest)

    def test_incomplete_manifest_refuses_staging(self):
        with tempfile.TemporaryDirectory() as d:
            manifest,_=create_fixture(d)
            raw=json.loads(manifest.read_text())
            raw["status"]="INCOMPLETE"
            manifest.write_text(json.dumps(raw))
            with self.assertRaisesRegex(ValueError,"not complete"):
                validate(manifest)

if __name__=="__main__":
    unittest.main()
