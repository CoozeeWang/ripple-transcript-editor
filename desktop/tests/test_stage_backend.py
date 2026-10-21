"""Synthetic staging verifies relocation inputs and refuses overwrites."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "stage_backend", Path(__file__).resolve().parents[1] / "stage-backend.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class StageBackendTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for name in ("python", "packages", "repo/backend/app", "repo/mock-data", "repo/data"):
            (self.root / name).mkdir(parents=True)
        for name in ("sample-transcript.json", "sample-metadata.json"):
            (self.root / "repo/mock-data" / name).write_text("{}", encoding="utf-8")
        (self.root / "repo/backend/app/main.py").write_text("# synthetic", encoding="utf-8")
        (self.root / "repo/data/private.txt").write_text("must not ship", encoding="utf-8")
        (self.root / "python/python.exe").write_bytes(b"synthetic")
        (self.root / "packages/synthetic.py").write_text("# synthetic", encoding="utf-8")
        self.info = {"base": str(self.root / "python"), "packages": str(self.root / "packages"), "version": [3, 12]}

    def test_staging_copies_runtime_without_project_data_and_refuses_overwrite(self):
        stage = self.root / "relocated 合成 runtime"
        with patch.object(module.subprocess, "check_output", return_value=json.dumps(self.info)):
            module.stage_backend(self.root / "repo", stage)
            self.assertTrue((stage / "python/python.exe").is_file())
            self.assertTrue((stage / "backend/app/main.py").is_file())
            self.assertEqual(list((stage / "data").iterdir()), [])
            self.assertFalse((stage / "data/private.txt").exists())
            (stage / "marker.txt").write_text("keep", encoding="utf-8")
            with self.assertRaises(FileExistsError):
                module.stage_backend(self.root / "repo", stage)
            self.assertEqual((stage / "marker.txt").read_text(encoding="utf-8"), "keep")

    def test_wrong_python_version_fails_before_creating_output(self):
        self.info["version"] = [3, 13]
        stage = self.root / "wrong"
        with patch.object(module.subprocess, "check_output", return_value=json.dumps(self.info)):
            with self.assertRaises(ValueError):
                module.stage_backend(self.root / "repo", stage)
        self.assertFalse(stage.exists())

    def test_packaging_guard_rejects_caches_created_after_staging(self):
        stage = self.root / "stage"
        with patch.object(module.subprocess, "check_output", return_value=json.dumps(self.info)):
            module.stage_backend(self.root / "repo", stage)
        with self.assertRaisesRegex(ValueError, "probe"):
            module.assert_clean_backend(stage)
        (stage / "data").rmdir()
        (stage / "verify.py").unlink()
        module.assert_clean_backend(stage)
        cache = stage / "site-packages/__pycache__"
        cache.mkdir()
        (cache / "synthetic.cpython-312.pyc").write_bytes(b"synthetic bytecode")
        with self.assertRaisesRegex(ValueError, "bytecode"):
            module.assert_clean_backend(stage)
        (cache / "synthetic.cpython-312.pyc").unlink()
        cache.rmdir()
        (stage / "backend/app/legacy.pyo").write_bytes(b"synthetic bytecode")
        with self.assertRaisesRegex(ValueError, "bytecode"):
            module.assert_clean_backend(stage)

    def test_staging_does_not_copy_existing_source_caches(self):
        cache = self.root / "packages/__pycache__"
        cache.mkdir()
        (cache / "synthetic.pyc").write_bytes(b"not source")
        (self.root / "python/legacy.pyo").write_bytes(b"not source")
        stage = self.root / "clean"
        with patch.object(module.subprocess, "check_output", return_value=json.dumps(self.info)):
            module.stage_backend(self.root / "repo", stage)
        self.assertFalse((stage / "site-packages/__pycache__").exists())
        self.assertFalse((stage / "python/legacy.pyo").exists())
