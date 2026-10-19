# Desktop updates

The installed app provides **Ripple → Check for Updates…** on macOS and **Help → Check for Updates…** on Windows. This opens one standalone update window, including from the welcome screen. General settings contains no duplicate update section. Opening the window first checks for updates; reopening an existing check, download or result preserves its state. Closing this window leaves the editor and backend running; downloads continue. After a newer version is found, **Update and restart…** downloads and verifies the package, asks the editor to save and check for active work, then installs and reopens Ripple without another confirmation. The consequences and preservation of projects/settings are shown before this action. A ready package uses the same action without downloading again. Cancelling or closing during download revokes automatic installation for that click; reopening requires a new explicit click to install. Startup does not query the update service. The browser preview does not install desktop updates. Update result messages have no acknowledgement button; the footer Close action closes the window.

## Source and release versions

Ripple lists published GitHub Releases in [CoozeeWang/ripple-transcript-editor](https://github.com/CoozeeWang/ripple-transcript-editor/releases) through the fixed public repository API. It includes stable releases and `X.Y.Z-beta.N` releases, skips drafts and other prerelease types, and orders candidates by semantic version. Internal builds at the same product version are installed manually; their build numbers do not trigger this updater.

Each eligible Release must attach `latest.json`. Ripple reads that Release's own catalog, verifies its version matches the Release tag, and chooses the highest newer version with a package for this platform. A release missing a catalog or the current platform does not hide an older usable update. GitHub's `/releases/latest` route is not used because it excludes prereleases. Pagination and response size are bounded; an incomplete or failed lookup is not reported as current.

The catalog uses Tauri's static JSON format: `version`, `notes`, `pub_date` and `platforms`, with a `url` and base64 minisign `signature` for each supported target, such as `darwin-aarch64` or `windows-x86_64`. A missing catalog does not mean the installed version is current. Ripple shows an unavailable or retry state and offers the official releases page. Uploading a ZIP or installer alone does not enable automatic detection.

## Authentication and preservation

The native process fixes the repository, endpoint and public key. It accepts only a strictly newer semantic version and an HTTPS asset URL inside this repository's Release downloads. The renderer cannot supply a URL, key, filesystem destination or executable. Notes are plain text.

Downloads are bounded to 512 MiB before each chunk is appended. Verification uses the same minisign primitive and authenticated version-comment format as Tauri's updater. The private signing key authenticates both package bytes and the announced version, so an old signed package cannot be relabeled as a new version. A wrong signature, version or platform cannot reach installation. The manifest itself is not signed; HTTPS and the authenticated package/version remain the trust boundary.

Before quitting, the update window requests a token-matched save/busy acknowledgement from the main editor; a missing response or timeout blocks installation. Critical preparation prevents closing either window or quitting. The editor flushes pending changes. Unfinished project forms, transcription, imports and AI editing block installation. Save failure leaves Ripple open with a focused retry action. A preparation timeout has its own message: Ripple has not quit; return to the main window, check that saving and other work have finished, then retry **Update and restart…**. A late acknowledgement cannot authorize installation after timeout. On Mac, another client using the installed bundle also blocks replacement; disable that client's Ripple connector and retry. No unrelated client is terminated.

Mac stages a single verified `.app`, checks its identity, product version and code signature, then waits for the owning app to quit. Darwin `RENAME_SWAP` exchanges the complete installed and prepared bundles atomically. Unsupported volumes fail without a non-atomic fallback. Post-swap validation failure swaps the original back. The previous bundle remains beside the installed app as `.Ripple-<transaction>.previous.app`; an interrupted operation may retain it under `.prepared.app`. The private application-data `updates/result.json` records the transaction paths for recovery. Backups are retained and are not automatically deleted. A temporary helper copy and staging data remain in that private update directory for diagnosis.

If automatic rollback fails, the window explicitly says that the previous app could not be restored and provides recovery guidance. Use **Official releases** to download a compatible installer and reinstall Ripple. If necessary, use a retained, previously accepted installer to restore the earlier app. Keep projects and application data. If Ripple cannot open to show this message, follow the same manual reinstall procedure; the private journal and retained bundles remain available for diagnosis.

Only application resources are replaced. The app identifier, installation path, WebView profile, projects, recent items, preferences, credentials and connector data locations stay the same. This change adds no data-format migration. If a future release changes a format, its migration and backward recovery require separate validation. An expired folder authorization still needs the user to choose that folder again.

Windows dispatches the verified EXE through Tauri's NSIS updater in `basicUi` mode and the existing install preflight. Its installer and hardware acceptance are separate from Mac validation.

## Preparing a release

Use the pinned desktop Tauri CLI (2.12.3 or newer with `signer sign --app-version`). Keep the private key outside Git, readable only by its owner. Back it up securely: future updates must verify against `desktop/src-tauri/update-public.key.pub`. Replacing that public key after an app has shipped requires a deliberate trust-key transition.

After building and verifying the release app, run the local preparation tool, for example:

```sh
python3 desktop/prepare-update.py \
  --artifact /private/release/Ripple.app \
  --platform darwin-aarch64 \
  --version 1.2.3 --tag v1.2.3 \
  --key /private/signing/ripple-updater.key \
  --notes /private/release/notes.txt \
  --output /private/release/updater-assets
```

Paths above are fictional. The tool checks bundle metadata, architecture and code signature, writes a `.app.tar.gz`, signs it with the version in its authenticated comment, and writes `latest.json`. Windows preparation runs on Windows against a verified EXE and checks its product version. The signing command does not print private key material or signer output.

Prepare each accepted platform separately, then combine the `platforms` entries into one catalog with the same version and notes. Verify that each URL names an uploaded asset in that exact Release. Do not list platforms that have not been built and accepted. Publish the reviewed catalog, packages and signature files together only after the maintainer approves the Release. This tool never uploads or creates a Release. A published Beta with its own catalog is discoverable; internal builds without a new product version are still manual installations.

Synthetic source tests check consent, stale replies, signature tampering, version substitution, archive traversal, app-only replacement and rollback. These do not establish a public Release or a real Windows installation result. Full feed-to-installed-app acceptance additionally requires an actually published, signed release newer than the installed product version.
