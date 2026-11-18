import json
from pathlib import Path
import tempfile
import unittest
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from release_v4_1 import read_release_manifest
from test_stage_v4_universe import create_fixture

class V41ReleaseSafetyTests(unittest.TestCase):
    def test_complete_1105_manifest_is_validated_from_git_archive_without_writes(self):
        with tempfile.TemporaryDirectory() as d:
            manifest,_=create_fixture(d)
            data=read_release_manifest(manifest,"HEAD")
            self.assertEqual(data["status"],"PREVIEWS_COMPLETE")
            self.assertEqual(data["total_rows"],1105)

    def test_tampered_manifest_is_blocked_before_deploy(self):
        with tempfile.TemporaryDirectory() as d:
            manifest,_=create_fixture(d)
            doc=json.loads(manifest.read_text())
            doc["total_rows"]=1104
            manifest.write_text(json.dumps(doc))
            with self.assertRaisesRegex(RuntimeError,"Manifest validation failed"):
                read_release_manifest(manifest,"HEAD")

    def test_incomplete_release_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            manifest,_=create_fixture(d)
            doc=json.loads(manifest.read_text())
            doc["status"]="INCOMPLETE"
            manifest.write_text(json.dumps(doc))
            with self.assertRaisesRegex(RuntimeError,"Manifest validation failed"):
                read_release_manifest(manifest,"HEAD")

if __name__=="__main__":
    unittest.main()
