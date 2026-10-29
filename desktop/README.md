# Ripple Mac App work area

This contains the Ripple frontend in a Tauri window and a bundled local Python backend. It is the formal desktop source; built applications and native acceptance records remain outside this repository. Use synthetic or user-approved local material for acceptance.

Windows internal builds suppress Python bytecode generation while verifying the staged runtime. Before creating an installer, `stage-backend.py --check-clean` rejects generated caches and staging probe data; installed-runtime checks repeat this assertion. A static Defender scan of the installer and extracted payload runs before installation smoke tests. These checks do not establish a Google Safe Browsing verdict or replace acceptance on a user's Windows machine.

## Local macOS build

Prepare Node.js 22.22.2+ on the 22 release line, 24.15+ on the 24 release line, or 26+, Rust/Cargo, uv, and managed Python 3.12. Install the locked dependencies, then build from the repository root:

```sh
npm --prefix frontend ci
npm --prefix desktop ci
uv sync --project backend --locked
npm --prefix frontend run build
~/.cargo/bin/cargo build --manifest-path desktop/src-tauri/Cargo.toml --release --features custom-protocol --locked
python3 desktop/stage-backend.py
```

The staging command prints the backend directory and carries the canonical product version in `product-version.json`; relocated backend diagnostics use this code resource instead of an engineering package version. `RIPPLE_DATA_DIR` must point to an absolute directory outside the repository whenever running local services. Staging is not installation or acceptance.

Choose an unused positive `RIPPLE_BUILD_NUMBER` higher than all existing delivery records and the installed app; do not infer the next number from an old example in this document. Package with `desktop/package-mac.sh <printed-backend-directory> [output-app-path]`. This writes the application version, build number, and exact Git commit to `Contents/Info.plist`; verify the finished bundle before naming a compressed delivery package. Reusing or lowering the build number when replacing an existing output app is rejected.

For a user-facing Mac package, run `desktop/package-dmg.sh <verified-Ripple.app> <new-output.dmg>` on a Mac with Finder access. It wraps the already signed app without rebuilding or installing it, and adds an Applications shortcut plus a plain drag arrow. The Finder window is configured on the temporary mounted image; packaging fails if its background and icon positions were not saved. Mount the finished DMG read-only to verify its contents, signature, version, build and Finder layout. The first install is a drag to Applications; for an update, quit Ripple first, then drag it over and choose Finder’s Replace action. This packaging step does not inspect old installations or move user data. `dmg-background.swift` is the editable source for `resources/dmg-background.png`; regenerate the PNG after a visual change.

Backend state is stored under the app's user data directory. Selected project and audio files remain in their chosen locations. Closing the window stops the owned backend. The personal internal build uses an ad hoc signature and is not notarized. As of 2026-10-20, Mac b83 has maintainer acceptance; later dependency changes require their own package verification. Windows packaging/installed acceptance and the manual release-download flow still need installed-app checks.

The main window sets `dragDropEnabled: false` so file drops reach the editor's HTML drop zones. Tauri's native drop interception must not consume these events: the app uses the same target validation and import flow as its browser version. When WebKit supplies a dropped File without a persistent file handle, audio can be copied into the project; external-reference storage still requires the file picker. This also leaves the editor's internal drag sorting available.

The desktop and web app icon uses `Icon/Ripple_app_paper_v2.png`; the macOS project-folder icon uses `Icon/Ripple_project_paper_v2.png`. Run `desktop/generate-icons.sh` to regenerate ICNS assets and the app PNG. The system ICNS uses a centered 840 × 840 visible body on a 1024 canvas, with width and height normalized separately and the raster measured at alpha > 16/255. The web PNG and project icon retain their original proportions and margins. See `pad-system-icon.swift` for the fixed system geometry. The legacy `make-icon.swift` is retained for reproducing older icon builds.

Check every built ICNS representation and the unchanged in-app PNG:

```sh
swift desktop/tests/test-system-icon.swift desktop/src-tauri/icons/icon.icns Icon/Ripple_app_paper_v2.png desktop/src-tauri/icons/icon.png
```

Daily builds must use `--release --features custom-protocol`. Release optimization alone does not disable Tauri's development behavior: without this feature, Tauri replaces the Dock icon with its embedded PNG. The compiler rejects that combination, and the packaging script checks `--ripple-build-info` before writing the bundle. Production Dock and Launchpad icons both use the bundle ICNS; do not compensate for different icon sources by repeatedly changing artwork size.

macOS can also retain an old image under a pinned Dock entry's cache identity. If a verified bundle update still shows stale artwork, quit Ripple and refresh only its entry with `swift desktop/refresh-mac-icon.swift /Applications/Ripple.app /absolute/private/tile-backup.plist`, then restart Dock with `killall Dock`. Use a new backup filename. The script preserves the position and other application entries, and refuses ambiguous matches or a running Ripple. Do not reset the entire Dock or Launchpad layout. Compare actual native Dock and Launchpad displays before delivering an icon change; resource tests alone do not establish native appearance.

On macOS, creating or opening a valid `.ripple` project automatically sets its Finder custom icon using NSWorkspace. The icon is embedded in the native executable. Projects remain ordinary folders, so native selection and cross-platform project contents keep their existing structure. If decoration fails, the project remains usable with a visible notice. Portable project copies receive their own icon; no icon change is attempted for browser storage or on Windows. macOS may create a hidden `Icon` metadata file and resource forks; those are system decoration, not interview content. Finder appearance and metadata preservation when copied between filesystems still require native acceptance.

## Desktop updates

The installed app offers **Check for Updates…** from the Ripple menu on Mac or Help menu on Windows, in a standalone update window. It shows release notes and opens the matching official release page for manual download and installation. See [desktop update checks](../docs/DESKTOP_UPDATES.md). Internal build numbers do not trigger a public version update.

## Native development on macOS

Double-click `start-dev.command` at the repository root, or run `npm --prefix desktop run dev`. This opens **Ripple Dev** in the native Tauri window using the checkout's current code. It requires macOS 14+, a supported Node.js version as listed above, Rust/Cargo, and prepared dependencies:

```sh
npm --prefix frontend ci
npm --prefix desktop ci
cd backend && uv sync --locked
```

Frontend edits refresh in the open window. Python files under `backend/app` reload the API; Rust edits rebuild and restart the native window. A restart can interrupt an in-progress operation, so finish imports, transcription and saving before editing backend or native code. The first native debug build takes longer; later builds reuse Cargo's cache.

The managed launcher stores development data and its source-backed `Ripple Dev.app` in the private sibling `ripple-segment-dev-data/` directory. Its distinct app identifier and macOS WebKit store isolate settings, recent items and credentials from the installed Ripple. Files deliberately selected through a native picker are still real files: use synthetic projects for development. The generated app is a source-backed runtime bundle. `start-dev.command` supervises development; a cold launch can restore its isolated services from the bundled runtime configuration. It is not a daily distribution package.

Close the native window or press Ctrl+C in its terminal to stop the owned development services. Keep that terminal open while developing. The launcher refuses occupied ports without stopping their owners. Ripple Dev uses frontend port 5184 and backend port 18712; the installed Ripple keeps port 18701, so both can run at the same time. Keep Dev on synthetic projects: separate app data does not isolate a real project deliberately opened in both windows. Do not configure Dev with the daily app’s ChatGPT tunnel or overwrite its external-client registration. Rust restarts leave the supervised Vite and Python services running. After changing Node/Python dependencies, update them and restart the launcher.

This development window does not replace installed-build acceptance, packaging or release checks. Windows native development through this entry point is not supported yet; the existing `start.bat` browser launcher remains available. External AI client setup must be performed separately for Dev; end-to-end external client compatibility is a separate acceptance check.

Desktop file selections are persisted in a private, atomically written permission registry beside app data. On restart, the native bridge checks the selected resource identity before restoring access. macOS uses Foundation bookmarks for resolution and volume/inode identity; Windows uses volume/file identity. These bookmarks do not create App Sandbox entitlements: OS access restrictions still apply. Old selections made before this registry existed may need one explicit reselection; new selections and successful recovery persist. Failed, missing or replaced selections never authorize a different resource at the same path.

## Segment transfer and return links

Managed Dev uses the independent `studio.ripple.app.segmentdev` identity, WebKit store `ripple-seg-00001`, frontend port 5184 and backend port 18712. The launcher puts its runtime bundle and synthetic data in the sibling `ripple-segment-dev-data` directory. Use synthetic projects for development. Its `ripple-segment-dev` URL scheme is separate from daily Ripple. The runtime plist records the source commit, whether source was dirty, and build time; it is not a numbered daily release.

Copy the entire segment with the button to the left of Delete or Cmd+Shift+C / Ctrl+Shift+C; hold Cmd on Mac (Ctrl on Windows/Linux) and drag the segment body for whole-segment export; its number also remains a direct drag entry. Ordinary text selection is unchanged without the modifier. Once dragging starts, the source remains latched until native session completion (DOM dragend on other platforms), including after modifier release or window blur; Mac desktop exports use an AppKit NSDraggingSession with an eager NSPasteboardItem (plain text, HTML and RTF), copy-only semantics and modifier keys ignored after initiation. The DOM session is cancelled and the native source/item are retained through completion. Other platforms retain DOM plain/HTML transfer. Source text is never removed on drag completion. Actual desktop drop acceptance is separate from native decoding tests. Read-only manuscripts support copying too. HTML contains a named source link; macOS native copy also provides RTF, verifies these formats immediately after writing them, and keeps the source name and full URL in plain text. Metadata, body and source use compact consecutive blocks, preserving internal body paragraphs; rich source links explicitly use purple underline. Export numbers use ASCII parentheses without zero-padding, such as `(2)`. Protocol delivery and external application acceptance require desktop testing; passing TypeScript or native compilation is not that evidence. When a linked project cannot be accessed, the user may select its folder again; the project ID must match before it is used. A currently selected copy of a project is preferred explicitly; unavailable targets never fall back to a matching title or row number.

The v2 link format uses a persistent UUID per version in manuscript index metadata. Legacy versions receive it once; no link is returned before the metadata write succeeds. Original transcript files, text, timestamps, annotations and highlights remain untouched. A new editable copy gets a new UUID. Renames, project-folder moves and reassociation preserve it; lookup checks only active material indexed by the selected project, and refuses duplicate UUID matches. Local model/edit numbers may be reused after deletion, so early v1 test links are rejected with a request to copy again. Known project copies require an explicit active or recently selected directory binding; the app never scans disks for matching titles.

External links wait while the editor loads, an input method is composing, a dialog is open, or annotations await explicit submission. Opening is serialized through pending-save completion, and a failed open retains the source editor lease.

### Daily-build readiness

Production builds use `ripple-transcript://open/v2` with bundle identity `studio.ripple.app`; managed Dev uses `ripple-segment-dev` with `studio.ripple.app.segmentdev`. The shared `segment-link-config.json` defines both channels. Frontend production builds emit a channel manifest; macOS packaging rejects disagreement between that manifest and the native binary. Native commands and incoming URLs require the expected build/identity combination. The macOS bundle declares only its production scheme; Windows NSIS registration is production-identity guarded and uninstall removes only its own command. Windows second-instance URLs are forwarded to the existing window.

Existing Dev cards retain their Dev URLs and are not automatically converted. Production keeps its existing app data directory; Dev retains separate preferences, WebKit storage and backend data. The packaged build reports the base Git commit plus dirty-source status and a source fingerprint for uncommitted candidates. Release compilation and package inspection do not establish installed-app cold/warm URL handling or external drop acceptance. Verify these behaviors on the installed build for each target platform.

### Isolated release transfer checks

`segment-transfer-test` is an explicit test-only Cargo feature for a release/custom-protocol build under `studio.ripple.app.segmentcheck`. It uses port 18713 and a separate WebKit store; the matching frontend is built with `VITE_RIPPLE_RELEASE_TEST=1`. Its channel manifest is rejected by production packaging. A test bundle must declare no URL schemes. Only synthetic projects belong in this environment. Its last native drag attempt records event types and completion/copy flags in `segment-drag-probe.json` beside its isolated app data, without text or source paths. Normal release builds do not write this probe. The mouse source retains real local down/drag events from the main window and clears them on release; asynchronous IPC must not depend on `NSApplication.currentEvent`, which may already be an event-loop wake event.
