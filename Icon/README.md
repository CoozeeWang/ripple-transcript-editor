# Ripple icon

## Paper icon artwork

The new application and project artwork is saved as two 1024 × 1024 RGBA PNG masters:

- `Ripple_app_paper_v2.png`: slate-blue application tile with an ivory paper ribbon.
- `Ripple_project_paper_v2.png`: ivory project folder with a slate-blue paper ribbon.

Both have transparent exteriors, clean contours, no presentation background, and no external cast shadow. The transparent margin is intentional; it is not a visible frame. Their internal material shading is preserved. The assets were checked on light and dark backgrounds and at reduced sizes. The app artwork is used by the desktop application, development window, welcome screen, top bar and browser favicon. The project artwork is applied automatically to valid `.ripple` directories on macOS when created or opened. Projects remain ordinary folders; no document-package association is registered.

## Currently integrated artwork

Current masters: `Ripple_app_paper_v2.png` and `Ripple_project_paper_v2.png`. Their existing transparent margins are preserved.

`frontend/public/ripple-icon.svg` embeds the app PNG without cropping or stretching. Run `desktop/generate-icons.sh` on macOS to regenerate `desktop/src-tauri/icons/icon.png`, `icon.icns` and `project.icns` from the masters. The native project icon is embedded in the executable and applied with NSWorkspace; missing write access does not block opening the project.

`Ripple_logo_1024.png` is the earlier artwork retained for reference.
