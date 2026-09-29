"""Check metadata in a synthetic macOS bundle without building or signing an app."""

import json
import os
import plistlib
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "package-mac.sh"


class PackageMacTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        desktop = self.root / "desktop"
        (desktop / "src-tauri/target/release").mkdir(parents=True)
        (desktop / "src-tauri/icons").mkdir(parents=True)
        (self.root / "frontend/dist").mkdir(parents=True)
        (self.root / "stage/python/bin").mkdir(parents=True)
        (self.root / "fake-bin").mkdir()
        shutil.copy2(SCRIPT, desktop / "package-mac.sh")
        (desktop / "src-tauri/tauri.conf.json").write_text(json.dumps({"version": "0.2.3"}))
        for path in (
            desktop / "src-tauri/target/release/ripple-desktop",
            desktop / "src-tauri/icons/icon.icns",
            desktop / "src-tauri/icons/icon.png",
            self.root / "frontend/dist/index.html",
            self.root / "stage/python/bin/python3.12",
        ):
            path.write_bytes(b"synthetic test fixture")
        (self.root / "fake-bin/codesign").write_text("#!/bin/sh\nexit 0\n")
        (self.root / "fake-bin/codesign").chmod(0o755)
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        subprocess.run(["git", "-C", str(self.root), "add", "desktop/src-tauri/tauri.conf.json"], check=True)
        subprocess.run(
            ["git", "-C", str(self.root), "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture"],
            check=True,
        )
        self.app = self.root / "Ripple.app"

    def package(self, build):
        env = os.environ.copy()
        env["PATH"] = f"{self.root / 'fake-bin'}:{env['PATH']}"
        if build is None:
            env.pop("RIPPLE_BUILD_NUMBER", None)
        else:
            env["RIPPLE_BUILD_NUMBER"] = build
        return subprocess.run(
            ["sh", str(self.root / "desktop/package-mac.sh"), str(self.root / "stage"), str(self.app)],
            env=env,
            text=True,
            capture_output=True,
        )

    def test_metadata_increments_and_matches_source(self):
        self.assertEqual(self.package("8").returncode, 0)
        self.assertEqual(self.package("9").returncode, 0)
        with (self.app / "Contents/Info.plist").open("rb") as stream:
            metadata = plistlib.load(stream)
        expected_commit = subprocess.check_output(["git", "-C", str(self.root), "rev-parse", "HEAD"], text=True).strip()
        self.assertEqual(metadata["CFBundleVersion"], "9")
        self.assertEqual(metadata["CFBundleShortVersionString"], "0.2.3")
        self.assertEqual(metadata["RippleGitCommit"], expected_commit)
        subprocess.run(["plutil", "-lint", str(self.app / "Contents/Info.plist")], check=True, capture_output=True)

    def test_missing_invalid_or_reused_build_is_rejected_before_overwrite(self):
        for build in (None, "0", "07", "7", "8x"):
            self.assertNotEqual(self.package(build).returncode, 0)
            self.assertFalse(self.app.exists())
        self.assertEqual(self.package("8").returncode, 0)
        original = (self.app / "Contents/Info.plist").read_bytes()
        self.assertNotEqual(self.package("8").returncode, 0)
        self.assertNotEqual(self.package("7").returncode, 0)
        self.assertEqual((self.app / "Contents/Info.plist").read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
