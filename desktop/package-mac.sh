#!/bin/sh
set -eu

DESKTOP=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO=$(CDPATH= cd -- "$DESKTOP/.." && pwd)
STAGED_BACKEND=${1:?Pass the directory printed by desktop/stage-backend.py}
APP=${2:-"$DESKTOP/dist/Ripple.app"}
BINARY="$DESKTOP/src-tauri/target/release/ripple-desktop"
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
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Ripple</string>
  <key>CFBundleDisplayName</key><string>Ripple</string>
  <key>CFBundleIdentifier</key><string>studio.ripple.app</string>
  <key>CFBundleExecutable</key><string>ripple-desktop</string>
  <key>CFBundleIconFile</key><string>Ripple-v015.icns</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>6</string>
  <key>CFBundleShortVersionString</key><string>0.1.5</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
codesign --force --deep --sign - "$APP"
printf '%s\n' "$APP"
