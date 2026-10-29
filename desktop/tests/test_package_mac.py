"""Check metadata in a synthetic macOS bundle without building or signing an app."""

import json
import os
import plistlib
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "package-mac.sh"


@unittest.skipUnless(sys.platform == "darwin", "macOS packaging requires macOS shell tools")
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
        shutil.copy2(SCRIPT.parent / "segment-link-config.json", desktop / "segment-link-config.json")
        channel = json.loads((desktop / "segment-link-config.json").read_text())["production"]
        (self.root / "frontend/dist/segment-link-channel.json").write_text(json.dumps({"channel": "production", **channel}))
        (desktop / "src-tauri/tauri.conf.json").write_text(json.dumps({"version": "0.2.3"}))
        for path in (
            desktop / "src-tauri/icons/icon.icns",
            desktop / "src-tauri/icons/icon.png",
            self.root / "frontend/dist/index.html",
            self.root / "stage/python/bin/python3.12",
        ):
            path.write_bytes(b"synthetic test fixture")
        self.binary = desktop / "src-tauri/target/release/ripple-desktop"
        self.binary.write_text('#!/bin/sh\nprintf \'%s\\n\' \'{"custom_protocol":true,"debug":false,"bundle_id":"studio.ripple.app","segment_scheme":"ripple-transcript"}\'\n')
        self.binary.chmod(0o755)
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
        env.pop("CARGO_TARGET_DIR", None)
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
        self.assertEqual(self.package("9").returncode, 0)
        self.assertEqual(self.package("10").returncode, 0)
        with (self.app / "Contents/Info.plist").open("rb") as stream:
            metadata = plistlib.load(stream)
        expected_commit = subprocess.check_output(["git", "-C", str(self.root), "rev-parse", "HEAD"], text=True).strip()
        self.assertEqual(metadata["CFBundleVersion"], "10")
        self.assertEqual(metadata["CFBundleShortVersionString"], "0.2.3")
        self.assertEqual(metadata["RippleGitCommit"], expected_commit)
        self.assertEqual(metadata["CFBundleURLTypes"][0]["CFBundleURLSchemes"], ["ripple-transcript"])
        self.assertIsInstance(metadata["RippleSourceDirty"], bool)
        self.assertEqual(len(metadata["RippleSourceFingerprint"]), 64)
        subprocess.run(["plutil", "-lint", str(self.app / "Contents/Info.plist")], check=True, capture_output=True)

    def test_beta_version_keeps_full_label_and_numeric_macos_version(self):
        config = self.root / "desktop/src-tauri/tauri.conf.json"
        config.write_text(json.dumps({"version": "0.2.0-beta.1"}))
        self.assertEqual(self.package("60").returncode, 0)
        metadata = plistlib.loads((self.app / "Contents/Info.plist").read_bytes())
        self.assertEqual(metadata["CFBundleShortVersionString"], "0.2.0")
        self.assertEqual(metadata["RippleVersion"], "0.2.0-beta.1")
        self.assertEqual(metadata["CFBundleVersion"], "60")
        original = (self.app / "Contents/Info.plist").read_bytes()
        for invalid in ("0.2.0-beta.0", "0.2.0-beta", "bad-version"):
            config.write_text(json.dumps({"version": invalid}))
            self.assertNotEqual(self.package("61").returncode, 0)
            self.assertEqual((self.app / "Contents/Info.plist").read_bytes(), original)

    def test_missing_invalid_or_reused_build_is_rejected_before_overwrite(self):
        for build in (None, "0", "07", "7", "8", "9x"):
            self.assertNotEqual(self.package(build).returncode, 0)
            self.assertFalse(self.app.exists())
        self.assertEqual(self.package("9").returncode, 0)
        original = (self.app / "Contents/Info.plist").read_bytes()
        self.assertNotEqual(self.package("9").returncode, 0)
        self.assertNotEqual(self.package("8").returncode, 0)
        self.assertEqual((self.app / "Contents/Info.plist").read_bytes(), original)

    def test_changed_icon_gets_a_new_bundle_resource_reference(self):
        self.assertEqual(self.package("9").returncode, 0)
        before = plistlib.loads((self.app / "Contents/Info.plist").read_bytes())
        icon = self.root / "desktop/src-tauri/icons/icon.icns"
        icon.write_bytes(b"updated synthetic icon")
        self.assertEqual(self.package("10").returncode, 0)
        after = plistlib.loads((self.app / "Contents/Info.plist").read_bytes())
        self.assertNotEqual(before["CFBundleIconFile"], after["CFBundleIconFile"])
        self.assertEqual((self.app / "Contents/Resources" / after["CFBundleIconFile"]).read_bytes(), icon.read_bytes())

    def test_mismatched_segment_channels_do_not_overwrite_existing_app(self):
        self.assertEqual(self.package("9").returncode, 0)
        original = (self.app / "Contents/Info.plist").read_bytes()
        manifest = self.root / "frontend/dist/segment-link-channel.json"
        good = manifest.read_text()
        manifest.write_text(json.dumps({"channel": "development", "bundleId": "studio.ripple.app.segmentdev", "scheme": "ripple-segment-dev"}))
        self.assertNotEqual(self.package("10").returncode, 0)
        self.assertEqual((self.app / "Contents/Info.plist").read_bytes(), original)
        manifest.write_text(good)
        self.binary.write_text(self.binary.read_text().replace("ripple-transcript", "ripple-segment-dev"))
        self.assertNotEqual(self.package("10").returncode, 0)
        self.assertEqual((self.app / "Contents/Info.plist").read_bytes(), original)

    def test_development_binary_is_rejected_before_overwriting_bundle(self):
        self.assertEqual(self.package("9").returncode, 0)
        original = (self.app / "Contents/Info.plist").read_bytes()
        for info in ('{"custom_protocol":false,"debug":false}', '{"custom_protocol":true,"debug":true}'):
            self.binary.write_text("#!/bin/sh\nprintf '%s\\n' '" + info + "'\n")
            self.assertNotEqual(self.package("10").returncode, 0)
            self.assertEqual((self.app / "Contents/Info.plist").read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
