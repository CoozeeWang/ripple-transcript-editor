#!/bin/sh
set -eu

DESKTOP=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO=$(CDPATH= cd -- "$DESKTOP/.." && pwd)
STAGED_BACKEND=${1:?Pass the directory printed by desktop/stage-backend.py}
APP=${2:-"$DESKTOP/dist/Ripple.app"}
BINARY="$DESKTOP/src-tauri/target/release/ripple-desktop"
BUILD_NUMBER=${RIPPLE_BUILD_NUMBER:?Set RIPPLE_BUILD_NUMBER to the next unused positive integer (for example, 9)}

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
if int(build) < 9:
    raise SystemExit("RIPPLE_BUILD_NUMBER must exceed the existing internal build number 8")
version = json.loads(Path(config_path).read_text(encoding="utf-8"))["version"]
if not re.fullmatch(r"[0-9]+(?:\.[0-9]+){1,2}(?:-beta\.[1-9][0-9]*)?", version):
    raise SystemExit("Tauri version must be numeric or use a beta.N prerelease suffix")
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
python3 - "$BINARY" <<'PY'
import json
import subprocess
import sys
info = json.loads(subprocess.check_output([sys.argv[1], "--ripple-build-info"], text=True, timeout=10))
if info != {"custom_protocol": True, "debug": False}:
    raise SystemExit("Refusing to package a development binary; build --release --features custom-protocol")
PY
test -f "$DESKTOP/src-tauri/icons/icon.icns"
ICON_NAME=$(python3 - "$DESKTOP/src-tauri/icons/icon.icns" <<'PY'
import hashlib
import sys
from pathlib import Path
print("Ripple-" + hashlib.sha256(Path(sys.argv[1]).read_bytes()).hexdigest()[:12] + ".icns")
PY
)
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BINARY" "$APP/Contents/MacOS/ripple-desktop"
cp "$DESKTOP/src-tauri/icons/icon.png" "$APP/Contents/Resources/icon.png"
rm -f "$APP/Contents/Resources/icon.icns" "$APP/Contents/Resources/Ripple.icns" "$APP/Contents/Resources/Ripple-v014.icns"
cp "$DESKTOP/src-tauri/icons/icon.icns" "$APP/Contents/Resources/$ICON_NAME"
rm -rf "$APP/Contents/Resources/backend"
cp -R "$STAGED_BACKEND" "$APP/Contents/Resources/backend"
rm -rf "$APP/Contents/Resources/backend/data"
rm -f "$APP/Contents/Resources/backend/verify.py"
python3 - "$APP/Contents/Info.plist" "$VERSION" "$BUILD_NUMBER" "$COMMIT" "$ICON_NAME" <<'PY'
import plistlib
import sys
from pathlib import Path

path, version, build, commit, icon_name = sys.argv[1:]
metadata = {
    "CFBundleName": "Ripple",
    "CFBundleDisplayName": "Ripple",
    "CFBundleIdentifier": "studio.ripple.app",
    "CFBundleExecutable": "ripple-desktop",
    "CFBundleIconFile": icon_name,
    "CFBundlePackageType": "APPL",
    "CFBundleVersion": build,
    "CFBundleShortVersionString": version.split("-", 1)[0],
    "RippleVersion": version,
    "RippleGitCommit": commit,
    "NSHighResolutionCapable": True,
}
with Path(path).open("wb") as stream:
    plistlib.dump(metadata, stream)
with Path(path).open("rb") as stream:
    actual = plistlib.load(stream)
for key in ("CFBundleVersion", "CFBundleShortVersionString", "RippleVersion", "RippleGitCommit"):
    if actual[key] != metadata[key]:
        raise SystemExit(f"Packaged {key} does not match the requested build")
PY
codesign --force --deep --sign - "$APP"
printf '%s\n' "$APP"
