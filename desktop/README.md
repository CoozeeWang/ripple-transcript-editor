# Ripple Mac App work area

This contains the Ripple frontend in a Tauri window and a bundled local Python backend. It is the formal desktop source; built applications and native acceptance records remain outside this repository. Use synthetic or user-approved local material for acceptance.

Build locally:

```sh
cd frontend && npm run build
cd ../desktop/src-tauri && ~/.cargo/bin/cargo build --release --offline
cd ../.. && python3 desktop/stage-backend.py
RIPPLE_BUILD_NUMBER=9 desktop/package-mac.sh /path/printed/by/stage-backend
```

Choose a build number higher than every previous internal build; `8` was used by a separate session-navigation test app, so use `9` for the next Ripple test build. The packaging script requires this number, writes `desktop/dist/Ripple.app`, and stores the build number, Tauri application version, and Git commit in `Contents/Info.plist`. Check those three values in the finished app before naming or recording a test package. Reusing or lowering the build number when overwriting an existing app is rejected. Backend state is stored under the app's user data directory. Selected project and audio files remain in their chosen locations. Closing the window stops the owned backend. The personal test build uses an ad hoc signature and is not notarized.

The main window sets `dragDropEnabled: false` so file drops reach the editor's HTML drop zones. Tauri's native drop interception must not consume these events: the app uses the same target validation and import flow as its browser version. When WebKit supplies a dropped File without a persistent file handle, audio can be copied into the project; external-reference storage still requires the file picker. This also leaves the editor's internal drag sorting available.

The desktop and web icons use `Icon/Ripple_logo_1024.png` as the transparent master. `desktop/make-icon.swift` centers the mark with an 80 px inset on the 1024 px Mac icon canvas, giving roughly 820 px of visible artwork; then use macOS `sips` and `iconutil` to build `desktop/src-tauri/icons/icon.icns` from standard iconset sizes. Both generated icon assets are stored in `src-tauri/icons` so regular packaging does not need to regenerate them.

## Native development on macOS

Double-click `start-dev.command` at the repository root, or run `npm --prefix desktop run dev`. This opens **Ripple Dev** in the native Tauri window using the checkout's current code. It requires macOS 14+, Node.js 22.15+, Rust/Cargo, and prepared dependencies:

```sh
npm --prefix frontend ci
npm --prefix desktop ci
cd backend && uv sync --locked
```

Frontend edits refresh in the open window. Python files under `backend/app` reload the API; Rust edits rebuild and restart the native window. A restart can interrupt an in-progress operation, so finish imports, transcription and saving before editing backend or native code. The first native debug build takes longer; later builds reuse Cargo's cache.

The managed launcher stores development data and its source-backed `Ripple Dev.app` in the private sibling `ripple-work/dev/` directory. Its distinct app identifier and macOS WebKit store isolate settings, recent items and credentials from the installed Ripple. Files deliberately selected through a native picker are still real files: use synthetic projects for development. The generated app is a runtime bundle; launch with `start-dev.command`, not by opening that bundle directly.

Close the native window or press Ctrl+C in its terminal to stop the owned development services. Keep that terminal open while developing. The launcher refuses occupied ports without stopping their owners. Ripple Dev uses frontend port 5174 and backend port 18701, so close the installed Ripple before starting it. Rust restarts leave the supervised Vite and Python services running. After changing Node/Python dependencies, update them and restart the launcher.

This development window does not replace installed-build acceptance, packaging or release checks. Windows native development through this entry point is not supported yet; the existing `start.bat` browser launcher remains available. External AI client setup must be performed separately for Dev; end-to-end external client compatibility is a separate acceptance check.
