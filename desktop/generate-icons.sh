#!/bin/sh
set -eu
DESKTOP=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO=$(CDPATH= cd -- "$DESKTOP/.." && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/ripple-icons.XXXXXX")
trap 'rm -rf "$WORK"' EXIT HUP INT TERM
make_icon() {
  master=$1
  output=$2
  iconset="$WORK/$(basename "$output").iconset"
  mkdir -p "$iconset"
  for size in 16 32 128 256 512; do
    sips -z "$size" "$size" "$master" --out "$iconset/icon_${size}x${size}.png" >/dev/null
    double=$((size * 2))
    sips -z "$double" "$double" "$master" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
  done
  iconutil -c icns "$iconset" -o "$output"
}
# Paper masters already include their intended transparent margins.
cp "$REPO/Icon/Ripple_app_paper_v2.png" "$DESKTOP/src-tauri/icons/icon.png"
make_icon "$REPO/Icon/Ripple_app_paper_v2.png" "$DESKTOP/src-tauri/icons/icon.icns"
make_icon "$REPO/Icon/Ripple_project_paper_v2.png" "$DESKTOP/src-tauri/icons/project.icns"
