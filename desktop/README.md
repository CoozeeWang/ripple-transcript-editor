# Ripple Mac App work area

This contains the Ripple frontend in a Tauri window and a bundled local Python backend. It is the formal desktop source; built applications and native acceptance records remain outside this repository. Use synthetic or user-approved local material for acceptance.

Build locally:

```sh
cd frontend && npm run build
cd ../desktop/src-tauri && ~/.cargo/bin/cargo build --release --offline
cd ../.. && python3 desktop/stage-backend.py
desktop/package-mac.sh /path/printed/by/stage-backend
```

The packaging script writes `desktop/dist/Ripple.app`. Backend state is stored under the app's user data directory. Selected project and audio files remain in their chosen locations. Closing the window stops the owned backend. The personal test build uses an ad hoc signature and is not notarized.

The desktop and web icons use `Icon/Ripple_logo_1024.png` as the transparent master. `desktop/make-icon.swift` centers the mark with an 80 px inset on the 1024 px Mac icon canvas, giving roughly 820 px of visible artwork; then use macOS `sips` and `iconutil` to build `desktop/src-tauri/icons/icon.icns` from standard iconset sizes. Both generated icon assets are stored in `src-tauri/icons` so regular packaging does not need to regenerate them.
