#!/bin/sh
set -eu

DESKTOP=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO=$(CDPATH= cd -- "$DESKTOP/.." && pwd)
STAGED_BACKEND=${1:?Pass the directory printed by desktop/stage-backend.py}
APP=${2:-"$DESKTOP/dist/Ripple.app"}
BINARY="$DESKTOP/src-tauri/target/release/ripple-desktop"
BUILD_NUMBER=${RIPPLE_BUILD_NUMBER:?Set RIPPLE_BUILD_NUMBER to the next positive integer (for example, 8)}

# Validate metadata before changing an existing app bundle.
VERSION=$(python3 - "$DESKTOP/src-tauri/tauri.conf.json" "$APP" "$BUILD_NUMBER" <<'PY'
import json
import plistlib
import re
import sys
from pathlib import Path

config_path, app_path, build = sys.argv[1:]
if not re.fullmatch(r"[1-9][0-9]*", build):
    raise SystemExit("RIPPLE_BUILD_NUMBER must be a positive integer without leading zeroes")
if int(build) < 8:
    raise SystemExit("RIPPLE_BUILD_NUMBER must exceed the last fixed build number 7")
version = json.loads(Path(config_path).read_text(encoding="utf-8"))["version"]
if not re.fullmatch(r"[0-9]+(?:\.[0-9]+){1,2}", version):
    raise SystemExit("Tauri version must have two or three numeric components for macOS")
old_plist = Path(app_path) / "Contents/Info.plist"
if old_plist.exists():
    with old_plist.open("rb") as stream:
        old_build = plistlib.load(stream).get("CFBundleVersion")
    if old_build is not None and (not str(old_build).isdigit() or int(build) <= int(old_build)):
        raise SystemExit(f"RIPPLE_BUILD_NUMBER must exceed the existing app build {old_build}")
print(version)
PY
)
COMMIT=$(git -C "$REPO" rev-parse --verify HEAD)
test -f "$STAGED_BACKEND/python/bin/python3.12"
test -f "$REPO/frontend/dist/index.html"
test -f "$BINARY"
test -f "$DESKTOP/src-tauri/icons/icon.icns"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BINARY" "$APP/Contents/MacOS/ripple-desktop"
cp "$DESKTOP/src-tauri/icons/icon.png" "$APP/Contents/Resources/icon.png"
rm -f "$APP/Contents/Resources/icon.icns" "$APP/Contents/Resources/Ripple.icns" "$APP/Contents/Resources/Ripple-v014.icns"
cp "$DESKTOP/src-tauri/icons/icon.icns" "$APP/Contents/Resources/Ripple-v015.icns"
rm -rf "$APP/Contents/Resources/backend"
cp -R "$STAGED_BACKEND" "$APP/Contents/Resources/backend"
rm -rf "$APP/Contents/Resources/backend/data"
python3 - "$APP/Contents/Info.plist" "$VERSION" "$BUILD_NUMBER" "$COMMIT" <<'PY'
import plistlib
import sys
from pathlib import Path

path, version, build, commit = sys.argv[1:]
metadata = {
    "CFBundleName": "Ripple",
    "CFBundleDisplayName": "Ripple",
    "CFBundleIdentifier": "studio.ripple.app",
    "CFBundleExecutable": "ripple-desktop",
    "CFBundleIconFile": "Ripple-v015.icns",
    "CFBundlePackageType": "APPL",
    "CFBundleVersion": build,
    "CFBundleShortVersionString": version,
    "RippleGitCommit": commit,
    "NSHighResolutionCapable": True,
}
with Path(path).open("wb") as stream:
    plistlib.dump(metadata, stream)
with Path(path).open("rb") as stream:
    actual = plistlib.load(stream)
for key in ("CFBundleVersion", "CFBundleShortVersionString", "RippleGitCommit"):
    if actual[key] != metadata[key]:
        raise SystemExit(f"Packaged {key} does not match the requested build")
PY
codesign --force --deep --sign - "$APP"
printf '%s\n' "$APP"
