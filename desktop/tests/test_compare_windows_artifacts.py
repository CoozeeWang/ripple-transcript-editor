"""Synthetic inventories establish which package files actually changed."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("compare_windows", Path(__file__).resolve().parents[1] / "compare-windows-artifacts.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CompareWindowsArtifactsTest(unittest.TestCase):
    def test_normalizes_windows_paths_and_rejects_collisions(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "inventory.json"
            path.write_text(json.dumps([{"name": "Backend\\Runtime.DLL", "sha256": "a"}]), encoding="utf-8-sig")
            self.assertIn("backend/runtime.dll", module.load_manifest(path))
            path.write_text(json.dumps([{"name": "A.exe"}, {"name": "a.exe"}]))
            with self.assertRaises(ValueError):
                module.load_manifest(path)

    def test_reports_dependency_binary_and_source_changes_separately(self):
        old = {"app.exe": {"sha256": "a"}, "runtime.dll": {"sha256": "same"},
               "backend/app.py": {"sha256": "old"}, "site/foo-1.dist-info/metadata": {"sha256": "old"}}
        new = {"app.exe": {"sha256": "b"}, "runtime.dll": {"sha256": "same"},
               "backend/app.py": {"sha256": "new"}, "site/foo-2.dist-info/metadata": {"sha256": "new"},
               "new.pyd": {"sha256": "added"}}
        result = module.compare(old, new)
        self.assertEqual(result["identicalFileCount"], 1)
        self.assertEqual(result["binaryChanges"], {"added": ["new.pyd"], "removed": [], "changed": ["app.exe"]})
        self.assertEqual(result["oldPackages"], ["foo-1.dist-info"])
        self.assertEqual(result["newPackages"], ["foo-2.dist-info"])
        self.assertIn("backend/app.py", result["changed"])
