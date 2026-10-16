# Ripple Mac App work area

This contains the Ripple frontend in a Tauri window and a bundled local Python backend. It is the formal desktop source; built applications and native acceptance records remain outside this repository. Use synthetic or user-approved local material for acceptance.

Windows internal builds suppress Python bytecode generation while verifying the staged runtime. Before creating an installer, `stage-backend.py --check-clean` rejects generated caches and staging probe data; installed-runtime checks repeat this assertion. A static Defender scan of the installer and extracted payload runs before installation smoke tests. These checks do not establish a Google Safe Browsing verdict or replace acceptance on a user's Windows machine.

Build locally:

```sh
cd frontend && npm run build
cd ../desktop/src-tauri && ~/.cargo/bin/cargo build --release --features custom-protocol --offline
cd ../.. && python3 desktop/stage-backend.py
RIPPLE_BUILD_NUMBER=9 desktop/package-mac.sh /path/printed/by/stage-backend
```

Choose a build number higher than every previous internal build; `8` was used by a separate session-navigation test app, so use `9` for the next Ripple test build. The packaging script requires this number, writes `desktop/dist/Ripple.app`, and stores the build number, Tauri application version, and Git commit in `Contents/Info.plist`. Check those three values in the finished app before naming or recording a test package. Reusing or lowering the build number when overwriting an existing app is rejected. Backend state is stored under the app's user data directory. Selected project and audio files remain in their chosen locations. Closing the window stops the owned backend. The personal test build uses an ad hoc signature and is not notarized.

The main window sets `dragDropEnabled: false` so file drops reach the editor's HTML drop zones. Tauri's native drop interception must not consume these events: the app uses the same target validation and import flow as its browser version. When WebKit supplies a dropped File without a persistent file handle, audio can be copied into the project; external-reference storage still requires the file picker. This also leaves the editor's internal drag sorting available.

The desktop and web app icon uses `Icon/Ripple_app_paper_v2.png`; the macOS project-folder icon uses `Icon/Ripple_project_paper_v2.png`. Run `desktop/generate-icons.sh` to regenerate ICNS assets and the app PNG. The system ICNS uses a centered 840 × 840 visible body on a 1024 canvas, with width and height normalized separately and the raster measured at alpha > 16/255. The web PNG and project icon retain their original proportions and margins. See `pad-system-icon.swift` for the fixed system geometry. The legacy `make-icon.swift` is retained for reproducing older icon builds.

Check every built ICNS representation and the unchanged in-app PNG:

```sh
swift desktop/tests/test-system-icon.swift desktop/src-tauri/icons/icon.icns Icon/Ripple_app_paper_v2.png desktop/src-tauri/icons/icon.png
```

Daily builds must use `--release --features custom-protocol`. Release optimization alone does not disable Tauri's development behavior: without this feature, Tauri replaces the Dock icon with its embedded PNG. The compiler rejects that combination, and the packaging script checks `--ripple-build-info` before writing the bundle. Production Dock and Launchpad icons both use the bundle ICNS; do not compensate for different icon sources by repeatedly changing artwork size.

macOS can also retain an old image under a pinned Dock entry's cache identity. If a verified bundle update still shows stale artwork, quit Ripple and refresh only its entry with `swift desktop/refresh-mac-icon.swift /Applications/Ripple.app /absolute/private/tile-backup.plist`, then restart Dock with `killall Dock`. Use a new backup filename. The script preserves the position and other application entries, and refuses ambiguous matches or a running Ripple. Do not reset the entire Dock or Launchpad layout. Compare actual native Dock and Launchpad displays before delivering an icon change; resource tests alone do not establish native appearance.

On macOS, creating or opening a valid `.ripple` project automatically sets its Finder custom icon using NSWorkspace. The icon is embedded in the native executable. Projects remain ordinary folders, so native selection and cross-platform project contents keep their existing structure. If decoration fails, the project remains usable with a visible notice. Portable project copies receive their own icon; no icon change is attempted for browser storage or on Windows. macOS may create a hidden `Icon` metadata file and resource forks; those are system decoration, not interview content. Finder appearance and metadata preservation when copied between filesystems still require native acceptance.

## Native development on macOS

Double-click `start-dev.command` at the repository root, or run `npm --prefix desktop run dev`. This opens **Ripple Dev** in the native Tauri window using the checkout's current code. It requires macOS 14+, Node.js 22.15+, Rust/Cargo, and prepared dependencies:

```sh
npm --prefix frontend ci
npm --prefix desktop ci
cd backend && uv sync --locked
```

Frontend edits refresh in the open window. Python files under `backend/app` reload the API; Rust edits rebuild and restart the native window. A restart can interrupt an in-progress operation, so finish imports, transcription and saving before editing backend or native code. The first native debug build takes longer; later builds reuse Cargo's cache.

The managed launcher stores development data and its source-backed `Ripple Dev.app` in the private sibling `ripple-work/dev/` directory. Its distinct app identifier and macOS WebKit store isolate settings, recent items and credentials from the installed Ripple. Files deliberately selected through a native picker are still real files: use synthetic projects for development. The generated app is a runtime bundle; launch with `start-dev.command`, not by opening that bundle directly.

Close the native window or press Ctrl+C in its terminal to stop the owned development services. Keep that terminal open while developing. The launcher refuses occupied ports without stopping their owners. Ripple Dev uses frontend port 5174 and backend port 18702; the installed Ripple keeps port 18701, so both can run at the same time. Keep Dev on synthetic projects: separate app data does not isolate a real project deliberately opened in both windows. Do not configure Dev with the daily app’s ChatGPT tunnel or overwrite its external-client registration. Rust restarts leave the supervised Vite and Python services running. After changing Node/Python dependencies, update them and restart the launcher.

This development window does not replace installed-build acceptance, packaging or release checks. Windows native development through this entry point is not supported yet; the existing `start.bat` browser launcher remains available. External AI client setup must be performed separately for Dev; end-to-end external client compatibility is a separate acceptance check.

Desktop file selections are persisted in a private, atomically written permission registry beside app data. On restart, the native bridge checks the selected resource identity before restoring access. macOS uses Foundation bookmarks for resolution and volume/inode identity; Windows uses volume/file identity. These bookmarks do not create App Sandbox entitlements: OS access restrictions still apply. Old selections made before this registry existed may need one explicit reselection; new selections and successful recovery persist. Failed, missing or replaced selections never authorize a different resource at the same path.
