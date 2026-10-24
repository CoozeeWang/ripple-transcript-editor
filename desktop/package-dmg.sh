#!/bin/bash
set -euo pipefail

# Package an already-built, signed Mac app. This does not rebuild or install it.
DESKTOP=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APP=${1:?Pass the verified Ripple.app path}
OUTPUT=${2:?Pass a new .dmg path}
[[ "$APP" == */Ripple.app && -d "$APP" ]]
[[ "$OUTPUT" == *.dmg && ! -e "$OUTPUT" ]]
[[ -f "$APP/Contents/Resources/backend/python/bin/python3.12" ]]
[[ -f "$APP/Contents/MacOS/ripple-desktop" ]]
codesign --verify --deep --strict --verbose=2 "$APP"

META=$(python3 - "$APP/Contents/Info.plist" <<'PY'
import plistlib
import sys
with open(sys.argv[1], "rb") as stream:
    info = plistlib.load(stream)
assert info["CFBundleIdentifier"] == "studio.ripple.app"
assert info["CFBundleName"] == "Ripple"
assert info["CFBundleExecutable"] == "ripple-desktop"
assert info["CFBundleVersion"].isdigit()
print(f'{info["RippleVersion"]} b{info["CFBundleVersion"]} {info["RippleGitCommit"]}')
PY
)
printf 'Packaging %s\n' "$META"
BUILD=$(plutil -extract CFBundleVersion raw -o - "$APP/Contents/Info.plist")
VOLUME="Ripple b$BUILD"
if mount | grep -Fq "on /Volumes/$VOLUME ("; then
    echo "Eject the existing $VOLUME disk image before packaging" >&2
    exit 1
fi

TEMP=$(mktemp -d "${TMPDIR:-/tmp/}ripple-dmg.XXXXXX")
MOUNT="$TEMP/$VOLUME"
RW="$TEMP/Ripple-rw.dmg"
mkdir -p "$MOUNT" "$TEMP/source/.background"
ATTACHED=0
CREATED_OUTPUT=0
cleanup() {
    if [[ $ATTACHED == 1 ]]; then hdiutil detach "$MOUNT" -force -quiet || return; fi
    if [[ $CREATED_OUTPUT == 1 ]]; then rm -f "$OUTPUT"; fi
    rm -rf "$TEMP"
}
trap cleanup EXIT

ditto "$APP" "$TEMP/source/Ripple.app"
ln -s /Applications "$TEMP/source/Applications"
cp "$DESKTOP/resources/dmg-background.png" "$TEMP/source/.background/Install.png"
hdiutil create -srcfolder "$TEMP/source" -volname "$VOLUME" -fs HFS+ \
    -format UDRW -size 300m "$RW"
hdiutil attach -readwrite -noverify -noautoopen -nobrowse -mountpoint "$MOUNT" "$RW" -quiet
ATTACHED=1

# Finder writes the icon positions and background into the mounted volume's .DS_Store.
# No app installation or permission setting is performed.
osascript "$DESKTOP/dmg-layout.applescript" "$VOLUME"
for attempt in 1 2 3; do
    if hdiutil detach "$MOUNT" -quiet; then ATTACHED=0; break; fi
    sleep 2
done
[[ $ATTACHED == 0 ]]
hdiutil convert "$RW" -format UDZO -imagekey zlib-level=9 -o "$OUTPUT" -quiet
CREATED_OUTPUT=1
hdiutil verify "$OUTPUT" -quiet

# Check the saved Finder view on the final, read-only image rather than racing
# Finder while it is still writing the mounted image.
MOUNT="$TEMP/check"
mkdir -p "$MOUNT"
hdiutil attach -readonly -noverify -noautoopen -nobrowse -mountpoint "$MOUNT" "$OUTPUT" -quiet
ATTACHED=1
python3 - "$MOUNT/.DS_Store" <<'PY'
import sys
from pathlib import Path

store_path = Path(sys.argv[1])
store = store_path.read_bytes() if store_path.exists() else b""
if not all(part in store for part in (b"bwsp", b"icvp", b"Install.png")) or store.count(b"Iloc") < 2:
    raise SystemExit("Finder did not save the DMG background, window, and icon positions")
PY
hdiutil detach "$MOUNT" -quiet
ATTACHED=0
CREATED_OUTPUT=0
printf '%s\n' "$OUTPUT"
