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
