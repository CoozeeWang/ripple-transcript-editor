"""Public synthetic metadata fixtures; no real signing key or app installation."""
import importlib.util
import json
import plistlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("prepare_update", Path(__file__).resolve().parents[1] / "prepare-update.py")
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class PrepareUpdateTest(unittest.TestCase):
    def test_mismatched_identity_and_version_fail_before_signing(self):
        with tempfile.TemporaryDirectory() as temp:
            app = Path(temp) / "Synthetic.app"
            (app / "Contents").mkdir(parents=True)
            for identity, version in (("invalid.example", "1.2.3"), ("studio.ripple.app", "0.1.0")):
                (app / "Contents/Info.plist").write_bytes(plistlib.dumps({"CFBundleIdentifier": identity, "CFBundleExecutable": "ripple-desktop", "RippleVersion": version}))
                with self.assertRaises(ValueError), patch.object(module.subprocess, "run") as run:
                    module.validate_input(app, "darwin-aarch64", "1.2.3")
                run.assert_not_called()

    def test_signed_asset_catalog_has_exact_repository_version_and_platform(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            key = root / "synthetic.key"
            key.write_text("synthetic placeholder, not a signing key")
            key.chmod(0o600)
            app = root / "Synthetic.app"
            app.mkdir()
            (app / "public.txt").write_text("synthetic payload")
            output = root / "output"

            def fake_sign(args, **kwargs):
                self.assertEqual(args[args.index("--app-version") + 1], "1.2.3")
                self.assertEqual(kwargs["stdout"], module.subprocess.DEVNULL)
                Path(args[-1] + ".sig").write_text("synthetic signature")

            with patch.object(module, "validate_input"), patch.object(module.subprocess, "run", side_effect=fake_sign):
                module.prepare(app, "darwin-aarch64", "1.2.3", "v1.2.3", key, output, "Synthetic notes", root / "signer")
                with self.assertRaises(ValueError):
                    module.prepare(app, "darwin-aarch64", "1.2.3", "v1.2.3", key, output, "", root / "signer")
            catalog = json.loads((output / "latest.json").read_text())
            self.assertEqual(catalog["version"], "1.2.3")
            self.assertEqual(list(catalog["platforms"]), ["darwin-aarch64"])
            self.assertEqual(catalog["platforms"]["darwin-aarch64"]["url"], module.REPOSITORY + "/releases/download/v1.2.3/Ripple-1.2.3-darwin-aarch64.app.tar.gz")

    def test_invalid_tag_or_missing_key_does_not_create_output(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for tag in ("unrelated", "v1.2.3"):
                with self.assertRaises(ValueError):
                    module.prepare(root / "Synthetic.app", "darwin-aarch64", "1.2.3", tag, root / "missing.key", root / "output", "", root / "signer")
            self.assertFalse((root / "output").exists())


if __name__ == "__main__":
    unittest.main()
