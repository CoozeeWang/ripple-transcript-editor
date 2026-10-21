"""Prepare signed updater assets locally. Never creates or uploads a GitHub Release."""
import argparse
import datetime
import json
import os
import plistlib
import re
import subprocess
import sys
import tarfile
from pathlib import Path

REPOSITORY = "https://github.com/CoozeeWang/ripple-transcript-editor"
VERSION = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+(?:-beta\.[1-9][0-9]*)?")
PLATFORMS = {"darwin-aarch64", "darwin-x86_64", "windows-x86_64"}


def validate_input(artifact, platform, version):
    if not VERSION.fullmatch(version) or platform not in PLATFORMS:
        raise ValueError("Unsupported version or platform")
    if platform.startswith("darwin-"):
        metadata = plistlib.loads((artifact / "Contents/Info.plist").read_bytes())
        if (metadata.get("CFBundleIdentifier"), metadata.get("CFBundleExecutable"), metadata.get("RippleVersion")) != ("studio.ripple.app", "ripple-desktop", version):
            raise ValueError("App identity/version does not match the update")
        subprocess.run(["/usr/bin/codesign", "--verify", "--deep", "--strict", str(artifact)], check=True, capture_output=True)
        architecture = "arm64" if platform.endswith("aarch64") else "x86_64"
        actual = subprocess.check_output(["/usr/bin/lipo", "-archs", str(artifact / "Contents/MacOS/ripple-desktop")], text=True).strip()
        if actual != architecture:
            raise ValueError("App architecture does not match the update platform")
    else:
        if sys.platform != "win32" or artifact.suffix.lower() != ".exe":
            raise ValueError("Prepare Windows updates on Windows using a verified NSIS EXE")
        # Environment variable keeps paths out of PowerShell source interpolation.
        environment = {**os.environ, "RIPPLE_UPDATE_EXE": str(artifact)}
        actual = subprocess.check_output(["powershell", "-NoProfile", "-NonInteractive", "-Command", "(Get-Item -LiteralPath $env:RIPPLE_UPDATE_EXE).VersionInfo.ProductVersion"], text=True, env=environment).strip()
        if actual != version:
            raise ValueError("Installer version does not match the update")


def prepare(artifact, platform, version, tag, key, output, notes, signer):
    if tag != "v" + version:
        raise ValueError("Release tag must match v<version>")
    if not key.is_file():
        raise ValueError("Provide the private signing key outside the repository")
    if sys.platform != "win32" and key.stat().st_mode & 0o077:
        raise ValueError("Private signing key must be readable by its owner only")
    validate_input(artifact, platform, version)
    if output.exists():
        raise ValueError("Use a new output directory to preserve prior signed assets")
    output.mkdir(parents=True, mode=0o700)
    name = f"Ripple-{version}-{platform}" + (".app.tar.gz" if platform.startswith("darwin-") else ".exe")
    package = output / name
    if platform.startswith("darwin-"):
        with tarfile.open(package, "w:gz", format=tarfile.GNU_FORMAT) as archive:
            archive.add(artifact, arcname="Ripple.app")
    else:
        import shutil
        shutil.copyfile(artifact, package)
    # No key contents, password, or signing output in logs.
    subprocess.run([str(signer), "signer", "sign", "--private-key-path", str(key), "--app-version", version, str(package)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    signature = package.with_suffix(package.suffix + ".sig").read_text(encoding="utf-8").strip()
    manifest = {"version": version, "notes": notes, "pub_date": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "platforms": {platform: {"url": f"{REPOSITORY}/releases/download/{tag}/{name}", "signature": signature}}}
    (output / "latest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return package


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("artifact", "key", "output", "notes"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--platform", choices=sorted(PLATFORMS), required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--signer", type=Path, default=Path(__file__).parent / "node_modules/.bin/tauri")
    args = parser.parse_args()
    try:
        prepare(args.artifact.resolve(), args.platform, args.version, args.tag, args.key.resolve(), args.output.resolve(), args.notes.read_text(encoding="utf-8"), args.signer.resolve())
    except (OSError, ValueError, subprocess.SubprocessError):
        parser.exit(1, "Update preparation failed; check identity, version, architecture, signing key, and output location. Nothing was uploaded.\n")
    print("Signed assets prepared locally. Review latest.json and platform coverage before publishing.")


if __name__ == "__main__":
    main()
