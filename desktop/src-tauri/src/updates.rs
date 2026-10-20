//! User-initiated updates. The renderer never chooses URLs, paths, or signing keys.
use serde::Serialize;
use std::{fs, path::{Path, PathBuf}, sync::{Mutex, atomic::{AtomicBool, Ordering}}, time::Duration};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};
use url::Url;

const RELEASES: &str = "https://github.com/CoozeeWang/ripple-transcript-editor/releases";
const PUBLIC_KEY: &str = include_str!("../update-public.key.pub");
const MAX_DOWNLOAD: u64 = 512 * 1024 * 1024;
const MAX_UNPACKED: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    current_version: String,
    build: Option<String>,
    phase: &'static str,
    available_version: Option<String>,
    notes: Option<String>,
    downloaded: u64,
    total: Option<u64>,
    error: Option<&'static str>,
    result: Option<serde_json::Value>,
}
struct Pending {
    info: UpdateInfo,
    candidate: Option<Update>,
    verified: Option<Vec<u8>>,
}
pub struct Updates {
    pending: Mutex<Pending>,
    cancel: AtomicBool,
}

impl Updates {
    pub fn new(app: &AppHandle) -> Self {
        let current_version = app.package_info().version.to_string();
        let result = outcome_path(app).ok().and_then(|p| fs::read(p).ok())
            .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
            .filter(|v| matches!(v["status"].as_str(), Some("installed" | "rolled_back" | "failed" | "timeout" | "blocked" | "installing" | "recovery_required")))
            .map(|v| {
                let status = match v["status"].as_str() {
                    Some("installing") if v["version"].as_str() == Some(&current_version) => "installed",
                    Some("installing") => "failed",
                    Some(status) => status,
                    None => "failed",
                };
                // Recovery paths stay in the private journal, outside renderer state.
                serde_json::json!({"status":status,"version":v["version"]})
            });
        Self { pending: Mutex::new(Pending {
            info: UpdateInfo { current_version: app.package_info().version.to_string(), build: installed_build(), phase: "idle",
                available_version: None, notes: None, downloaded: 0, total: None, error: None, result },
            candidate: None, verified: None,
        }), cancel: AtomicBool::new(false) }
    }
}

fn outcome_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(crate::app_data(app)?.join("updates").join("result.json"))
}
fn current_bundle() -> Result<PathBuf, String> {
    let executable = std::env::current_exe().map_err(|_| "update_install_failed")?;
    let contents = executable.parent().and_then(Path::parent).ok_or("update_install_failed")?;
    let bundle = contents.parent().ok_or("update_install_failed")?;
    if contents.file_name().and_then(|s| s.to_str()) != Some("Contents") || bundle.extension().and_then(|s| s.to_str()) != Some("app") {
        return Err("update_install_failed".into());
    }
    Ok(bundle.to_path_buf())
}
#[cfg(target_os = "macos")]
fn plist(bundle: &Path, key: &str) -> Result<String, String> {
    let output = std::process::Command::new("/usr/libexec/PlistBuddy")
        .args(["-c", &format!("Print {key}")]).arg(bundle.join("Contents/Info.plist"))
        .output().map_err(|_| "update_invalid_package")?;
    if !output.status.success() { return Err("update_invalid_package".into()); }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
fn installed_build() -> Option<String> {
    #[cfg(target_os = "macos")]
    { current_bundle().ok().and_then(|p| plist(&p, "CFBundleVersion").ok()) }
    #[cfg(not(target_os = "macos"))]
    { option_env!("RIPPLE_BUILD_NUMBER").map(str::to_string) }
}
fn newer(candidate: &str, current: &str) -> bool {
    match (semver::Version::parse(candidate), semver::Version::parse(current)) {
        (Ok(a), Ok(b)) => a.cmp_precedence(&b).is_gt(), _ => false,
    }
}
fn allowed_package(url: &Url, macos: bool) -> bool {
    let path = url.path();
    url.scheme() == "https" && url.host_str() == Some("github.com") && url.port().is_none()
        && url.username().is_empty() && url.password().is_none() && url.query().is_none() && url.fragment().is_none()
        && path.starts_with("/CoozeeWang/ripple-transcript-editor/releases/download/")
        && path.rsplit('/').next().is_some_and(|name| !name.is_empty() && if macos { name.ends_with(".app.tar.gz") } else { name.ends_with(".exe") })
}
fn locked(phase: &str) -> bool { matches!(phase, "checking" | "downloading" | "verifying" | "installing") }

// Same authenticated-comment format as Tauri's verifier. Read version only after
// verifying both minisign signatures; the manifest alone cannot bind a version.
fn verify_package(bytes: &[u8], signature: &str, public_key: &str, version: &str) -> Result<(), &'static str> {
    use base64::Engine;
    let decode = |s: &str| base64::engine::general_purpose::STANDARD.decode(s.trim())
        .ok().and_then(|b| String::from_utf8(b).ok()).ok_or("update_invalid_package");
    let key = minisign_verify::PublicKey::decode(&decode(public_key)?).map_err(|_| "update_invalid_package")?;
    let signature = minisign_verify::Signature::decode(&decode(signature)?).map_err(|_| "update_invalid_package")?;
    key.verify(bytes, &signature, true).map_err(|_| "update_invalid_package")?;
    let signed = signature.trusted_comment().split('\t').find_map(|s| s.strip_prefix("version:")).ok_or("update_invalid_package")?;
    if semver::Version::parse(signed).ok().filter(|v| Some(v) == semver::Version::parse(version).ok().as_ref()).is_none() { return Err("update_invalid_package"); }
    Ok(())
}

enum Checked { Available(Box<Update>), Current, Unavailable }
async fn check_releases(app: &AppHandle) -> Result<Checked, &'static str> {
    let client = crate::update_releases::client(Duration::from_secs(20))?;
    let catalogs = crate::update_releases::discover(&client).await?;
    if catalogs.is_empty() { return Ok(Checked::Unavailable); }
    let current = app.package_info().version.to_string();
    let mut found_newer = false;
    for catalog in catalogs.into_iter().filter(|c| newer(&c.version.to_string(), &current)) {
        found_newer = true;
        let exit_app = app.clone();
        let updater = app.updater_builder().pubkey(PUBLIC_KEY.trim())
            .on_before_exit(move || { crate::stop_backend(&exit_app); exit_app.cleanup_before_exit(); })
            .timeout(Duration::from_secs(20)).endpoints(vec![catalog.url.clone()])
            .map_err(|_| "update_check_failed")?.build().map_err(|_| "update_check_failed")?;
        match updater.check().await {
            Ok(Some(update)) => {
                let same_release = update.download_url.path().rsplit_once('/').map(|p|p.0)
                    == catalog.url.path().rsplit_once('/').map(|p|p.0);
                if update.version != catalog.version.to_string() || update.signature.trim().is_empty()
                    || !same_release || !allowed_package(&update.download_url, cfg!(target_os = "macos")) { return Err("update_invalid_package"); }
                return Ok(Checked::Available(Box::new(update)));
            }
            Ok(None) => return Err("update_invalid_package"),
            Err(tauri_plugin_updater::Error::ReleaseNotFound | tauri_plugin_updater::Error::TargetNotFound(_) | tauri_plugin_updater::Error::TargetsNotFound(_)) => continue,
            Err(_) => return Err("update_check_failed"),
        }
    }
    Ok(if found_newer { Checked::Unavailable } else { Checked::Current })
}

#[tauri::command]
pub fn update_status(state: State<'_, Updates>) -> Result<UpdateInfo, String> {
    Ok(state.pending.lock().map_err(|_| "update_busy")?.info.clone())
}
#[tauri::command]
pub async fn update_check(app: AppHandle, state: State<'_, Updates>) -> Result<UpdateInfo, String> {
    if crate::development(&app) { return Err("update_development".into()); }
    {
        let mut p = state.pending.lock().map_err(|_| "update_busy")?;
        if locked(p.info.phase) || p.verified.is_some() { return Err("update_busy".into()); }
        p.info.phase = "checking"; p.info.error = None; p.info.available_version = None; p.info.notes = None; p.candidate = None;
    }
    let result = tokio::time::timeout(Duration::from_secs(60), check_releases(&app)).await.unwrap_or(Err("update_check_failed"));
    let mut p = state.pending.lock().map_err(|_| "update_busy")?;
    match result {
        Ok(Checked::Available(update)) => {
            p.info.available_version = Some(update.version.clone());
            p.info.notes = update.body.as_deref().map(|s| s.chars().take(16000).collect());
            p.info.phase = "available"; p.candidate = Some(*update);
        }
        Ok(Checked::Current) => p.info.phase = "current",
        Ok(Checked::Unavailable) => p.info.phase = "unavailable",
        Err(code) => { p.info.phase = "error"; p.info.error = Some(code); }
    }
    Ok(p.info.clone())
}
#[tauri::command]
pub async fn update_download(state: State<'_, Updates>) -> Result<UpdateInfo, String> {
    let update = {
        let mut p = state.pending.lock().map_err(|_| "update_busy")?;
        if locked(p.info.phase) || p.verified.is_some() { return Err("update_busy".into()); }
        let update = p.candidate.clone().ok_or("update_check_first")?;
        p.info.phase = "downloading"; p.info.error = None; p.info.downloaded = 0; p.info.total = None;
        state.cancel.store(false, Ordering::Release); update
    };
    // Bound bytes before appending. A timer around the plugin's Vec download is
    // insufficient when a ready stream yields many chunks in the same poll.
    let download = async {
        let mut response = crate::update_releases::client(Duration::from_secs(600))
            .map_err(|_| "update_download_failed")?.get(update.download_url.clone())
            .header("Accept", "application/octet-stream").header("User-Agent", "Ripple-Updater")
            .send().await.map_err(|_| "update_download_failed")?.error_for_status().map_err(|_| "update_download_failed")?;
        let total = response.content_length().filter(|n| *n > 0);
        if total.is_some_and(|n| n > MAX_DOWNLOAD) { return Err("update_too_large"); }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| "update_download_failed")? {
            if (bytes.len() as u64).saturating_add(chunk.len() as u64) > MAX_DOWNLOAD { return Err("update_too_large"); }
            if state.cancel.load(Ordering::Acquire) { return Err("update_cancelled"); }
            bytes.extend_from_slice(&chunk);
            if let Ok(mut p) = state.pending.lock() { p.info.downloaded = bytes.len() as u64; p.info.total = total; }
        }
        if let Ok(mut p) = state.pending.lock() { p.info.phase = "verifying"; }
        verify_package(&bytes, &update.signature, PUBLIC_KEY, &update.version)?;
        Ok(bytes)
    };
    tokio::pin!(download);
    let interrupted = async {
        loop {
            tokio::time::sleep(Duration::from_millis(25)).await;
            if state.cancel.load(Ordering::Acquire) { break "update_cancelled"; }
        }
    };
    let result = tokio::select! {
        bytes = &mut download => bytes,
        reason = interrupted => Err(reason),
    };
    let mut p = state.pending.lock().map_err(|_| "update_busy")?;
    match result {
        Ok(bytes) if !bytes.is_empty() && (bytes.len() as u64) <= MAX_DOWNLOAD && !state.cancel.load(Ordering::Acquire) => {
            p.verified = Some(bytes); p.info.phase = "ready";
        }
        Ok(_) => { p.info.phase = "error"; p.info.error = Some("update_invalid_package"); }
        Err("update_cancelled") => { p.info.phase = "available"; p.info.error = None; }
        Err(code) => { p.info.phase = "error"; p.info.error = Some(code); }
    }
    Ok(p.info.clone())
}
#[tauri::command]
pub fn update_cancel(state: State<'_, Updates>) -> Result<(), String> {
    let mut p = state.pending.lock().map_err(|_| "update_busy")?;
    if matches!(p.info.phase, "checking" | "verifying" | "installing") { return Err("update_busy".into()); }
    state.cancel.store(true, Ordering::Release);
    if p.info.phase != "downloading" {
        p.verified = None; p.info.phase = if p.candidate.is_some() { "available" } else { "idle" }; p.info.error = None;
    }
    Ok(())
}
#[tauri::command]
pub fn update_open_releases() -> Result<(), String> { crate::install_target::open(RELEASES, None) }
#[tauri::command]
pub fn update_dismiss_result(app: AppHandle, state: State<'_, Updates>) -> Result<(), String> {
    let path = outcome_path(&app)?;
    if path.exists() { fs::remove_file(path).map_err(|_| "update_install_failed")?; }
    state.pending.lock().map_err(|_| "update_busy")?.info.result = None;
    Ok(())
}

#[cfg(target_os = "macos")]
pub(crate) fn verified_bundle(bundle: &Path, version: &str) -> Result<(), String> {
    if plist(bundle, "CFBundleIdentifier")? != "studio.ripple.app" || plist(bundle, "RippleVersion")? != version
        || plist(bundle, "CFBundleExecutable")? != "ripple-desktop" { return Err("update_invalid_package".into()); }
    if !std::process::Command::new("/usr/bin/codesign").args(["--verify", "--deep", "--strict"]).arg(bundle)
        .stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null())
        .status().map_err(|_| "update_invalid_package")?.success() { return Err("update_invalid_package".into()); }
    Ok(())
}

/// Only files, directories and safe relative symlinks inside the one .app are allowed.
fn unpack_app(bytes: &[u8], destination: &Path) -> Result<PathBuf, String> {
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(bytes));
    let mut total = 0_u64;
    let mut count = 0_u32;
    let mut top: Option<std::ffi::OsString> = None;
    for entry in archive.entries().map_err(|_| "update_invalid_package")? {
        count += 1;
        if count > 50_000 { return Err("update_too_large".into()); }
        let mut entry = entry.map_err(|_| "update_invalid_package")?;
        let path = entry.path().map_err(|_| "update_invalid_package")?.into_owned();
        if path.components().any(|c| !matches!(c, std::path::Component::Normal(_))) { return Err("update_invalid_package".into()); }
        let root = path.components().next().ok_or("update_invalid_package")?.as_os_str().to_os_string();
        if Path::new(&root).extension().and_then(|s| s.to_str()) != Some("app") || top.as_ref().is_some_and(|p| p != &root) { return Err("update_invalid_package".into()); }
        top = Some(root);
        total = total.checked_add(entry.size()).ok_or("update_too_large")?;
        if total > MAX_UNPACKED { return Err("update_too_large".into()); }
        let kind = entry.header().entry_type();
        if !(kind.is_file() || kind.is_dir() || kind.is_symlink()) { return Err("update_invalid_package".into()); }
        // tar checks symlink traversal while unpacking. Reject absolute and escaping targets up front.
        if kind.is_symlink() {
            let target = entry.link_name().map_err(|_| "update_invalid_package")?.ok_or("update_invalid_package")?;
            if target.is_absolute() { return Err("update_invalid_package".into()); }
            let mut depth = path.parent().map_or(0, |p| p.components().count());
            for part in target.components() {
                match part {
                    std::path::Component::Normal(_) => depth += 1,
                    std::path::Component::CurDir => {},
                    std::path::Component::ParentDir if depth > 1 => depth -= 1,
                    _ => return Err("update_invalid_package".into()),
                }
            }
        }
        if !entry.unpack_in(destination).map_err(|_| "update_invalid_package")? { return Err("update_invalid_package".into()); }
    }
    let app = destination.join(top.ok_or("update_invalid_package")?);
    if !app.is_dir() { return Err("update_invalid_package".into()); }
    Ok(app)
}

#[cfg(target_os = "macos")]
fn prepare_mac(app: &AppHandle, bytes: &[u8], version: &str) -> Result<(PathBuf, PathBuf, PathBuf, PathBuf), String> {
    use std::os::unix::fs::PermissionsExt;
    let installed = current_bundle()?;
    verified_bundle(&installed, &app.package_info().version.to_string())?;
    let root = crate::app_data(app)?.join("updates");
    fs::create_dir_all(&root).map_err(|_| "update_install_failed")?;
    fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).map_err(|_| "update_install_failed")?;
    let working = tempfile::Builder::new().prefix("install-").tempdir_in(&root).map_err(|_| "update_install_failed")?;
    let staged = unpack_app(bytes, working.path())?;
    verified_bundle(&staged, version)?;
    let name = working.path().file_name().ok_or("update_install_failed")?.to_string_lossy();
    let parent = installed.parent().ok_or("update_install_failed")?;
    let prepared = parent.join(format!(".Ripple-{name}.prepared.app"));
    let backup = parent.join(format!(".Ripple-{name}.previous.app"));
    if prepared.exists() || backup.exists() { return Err("update_busy".into()); }
    if !std::process::Command::new("/usr/bin/ditto").arg(&staged).arg(&prepared)
        .status().map(|s| s.success()).unwrap_or(false) { let _ = fs::remove_dir_all(&prepared); return Err("update_install_failed".into()); }
    if let Err(error) = verified_bundle(&prepared, version) { let _ = fs::remove_dir_all(&prepared); return Err(error); }
    let helper = working.path().join("apply-update");
    let copy_helper = || -> Result<(), String> {
        fs::copy(std::env::current_exe().map_err(|_| "update_install_failed")?, &helper).map_err(|_| "update_install_failed")?;
        fs::set_permissions(&helper, fs::Permissions::from_mode(0o700)).map_err(|_| "update_install_failed")?;
        Ok(())
    };
    if let Err(error) = copy_helper() { let _ = fs::remove_dir_all(&prepared); return Err(error); }
    // Keep the authenticated staging/transaction after this app exits.
    let _ = working.keep();
    Ok((installed, prepared, backup, helper))
}

#[tauri::command]
pub async fn update_install(app: AppHandle, window: tauri::WebviewWindow, state: State<'_, Updates>) -> Result<(), String> {
    app.state::<crate::update_window::UpdateWindow>().begin_install(window.label())?;
    let result = install_prepared(app.clone(), state).await;
    if result.is_err() { crate::update_window::release(&app); }
    result
}
pub fn installing(app: &AppHandle) -> bool {
    app.state::<Updates>().pending.lock().map(|p|p.info.phase == "installing").unwrap_or(false)
}
async fn install_prepared(app: AppHandle, state: State<'_, Updates>) -> Result<(), String> {
    let (candidate, bytes) = {
        let mut p = state.pending.lock().map_err(|_| "update_busy")?;
        if p.info.phase != "ready" { return Err("update_download_first".into()); }
        let candidate = p.candidate.clone().ok_or("update_download_first")?;
        let bytes = p.verified.take().ok_or("update_download_first")?;
        p.info.phase = "installing"; (candidate, bytes)
    };
    let result = install_verified(app.clone(), candidate, bytes).await;
    if let Err(error) = &result {
        let mut p = state.pending.lock().map_err(|_| "update_busy")?;
        p.info.phase = "error"; p.info.error = Some(if error == "update_in_use" { "update_in_use" } else { "update_install_failed" });
    }
    result
}
async fn install_verified(app: AppHandle, candidate: Update, bytes: Vec<u8>) -> Result<(), String> {
    if crate::development(&app) || !newer(&candidate.version, &app.package_info().version.to_string()) { return Err("update_invalid_package".into()); }
    #[cfg(target_os = "macos")]
    {
        let bundle = current_bundle()?;
        if crate::update_install::external_processes(&bundle, &crate::owned_process_ids(&app))? { return Err("update_in_use".into()); }
        let owner = app.clone();
        let version = candidate.version.clone();
        let (installed, prepared, backup, helper) = tauri::async_runtime::spawn_blocking(move || prepare_mac(&owner, &bytes, &version))
            .await.map_err(|_| "update_install_failed")??;
        let result_path = outcome_path(&app)?;
        let mut child = crate::backend_runtime::background_command(&helper);
        child.arg("--ripple-apply-update").arg(std::process::id().to_string()).arg(&installed).arg(&prepared).arg(&backup).arg(&result_path).arg(&candidate.version)
            .stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
        if child.spawn().is_err() { let _ = fs::remove_dir_all(prepared); return Err("update_install_failed".into()); }
        crate::stop_backend(&app);
        app.exit(0);
        Ok(())
    }
    #[cfg(target_os = "windows")]
    { candidate.install(bytes).map_err(|_| "update_install_failed".to_string()) }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    { let _ = (app, candidate, bytes); Err("update_platform_unavailable".into()) }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shipped_plugin_configuration_deserializes_before_builder_overrides() {
        let app: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let config: tauri_plugin_updater::Config = serde_json::from_value(app["plugins"]["updater"].clone()).expect("plugin config must load before builder pubkey override");
        assert_eq!(config.pubkey.trim(), PUBLIC_KEY.trim());
        assert!(config.require_signed_version);
    }
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "requires an explicitly prepared private synthetic signed bundle"]
    fn signed_bundle_upgrade_and_rollback_preserve_data() {
        let package = PathBuf::from(std::env::var_os("RIPPLE_TEST_UPDATE_PACKAGE").expect("synthetic package path"));
        let previous = PathBuf::from(std::env::var_os("RIPPLE_TEST_PREVIOUS_APP").expect("previous test app path"));
        let version = "1.2.3";
        let bytes = fs::read(&package).unwrap();
        let signature = fs::read_to_string(format!("{}.sig", package.display())).unwrap();
        verify_package(&bytes, &signature, PUBLIC_KEY, version).unwrap();
        let root = tempfile::tempdir().unwrap();
        let prepared = unpack_app(&bytes, root.path()).unwrap();
        verified_bundle(&prepared, version).unwrap();
        let installed = root.path().join("Installed.app");
        assert!(std::process::Command::new("/usr/bin/ditto").arg(&previous).arg(&installed).status().unwrap().success());
        let old_metadata = fs::read(installed.join("Contents/Info.plist")).unwrap();
        let user_data = root.path().join("user-data");fs::create_dir(&user_data).unwrap();
        for name in ["preferences.json", "recents.json", "credentials.json", "connector.json", "project.ripple"] {
            fs::write(user_data.join(name), format!("Public synthetic sentinel: {name}")).unwrap();
        }
        let backup = root.path().join("Previous.app");let result = root.path().join("result.json");
        crate::update_install::replace(&installed,&prepared,&backup,&result,version,|p|verified_bundle(p,version)).unwrap();
        assert_eq!(plist(&installed,"RippleVersion").unwrap(), version);
        assert_eq!(fs::read(backup.join("Contents/Info.plist")).unwrap(),old_metadata);
        // A second prepared bundle fails after swap; restore the exact successful app.
        let retry = root.path().join("Retry.app");
        assert!(std::process::Command::new("/usr/bin/ditto").arg(&installed).arg(&retry).status().unwrap().success());
        assert!(crate::update_install::replace(&installed,&retry,&root.path().join("Retry-backup.app"),&result,version,|p|{
            if p == installed {Err("synthetic post-swap failure".into())}else{verified_bundle(p,version)}
        }).is_err());
        verified_bundle(&installed,version).unwrap();
        assert_eq!(serde_json::from_slice::<serde_json::Value>(&fs::read(result).unwrap()).unwrap()["status"],"rolled_back");
        for name in ["preferences.json", "recents.json", "credentials.json", "connector.json", "project.ripple"] {
            assert_eq!(fs::read_to_string(user_data.join(name)).unwrap(),format!("Public synthetic sentinel: {name}"));
        }
    }
    #[test]
    fn only_strictly_newer_semver_is_an_update() {
        assert!(newer("0.2.0", "0.2.0-beta.1"));
        for version in ["0.2.0-beta.1", "0.2.0-beta.1+75", "0.1.6", "invalid"] { assert!(!newer(version, "0.2.0-beta.1")); }
    }
    #[test]
    fn signature_authenticates_payload_and_version_not_just_manifest() {
        let bytes = include_bytes!("../../tests/fixtures/updater/synthetic-package.txt");
        let sig = include_str!("../../tests/fixtures/updater/synthetic-package.txt.sig");
        let key = include_str!("../../tests/fixtures/updater/synthetic-public.key.pub");
        assert!(verify_package(bytes, sig, key, "1.2.3").is_ok());
        // Signed data is byte-exact: Windows checkout must not rewrite LF to CRLF.
        let rewritten = String::from_utf8_lossy(bytes).replace('\n', "\r\n");
        assert!(verify_package(rewritten.as_bytes(), sig, key, "1.2.3").is_err());
        assert!(verify_package(b"tampered", sig, key, "1.2.3").is_err());
        assert!(verify_package(bytes, sig, key, "9.9.9").is_err());
        assert!(verify_package(bytes, sig, PUBLIC_KEY, "1.2.3").is_err());
        assert!(verify_package(bytes, "invalid", key, "1.2.3").is_err());
    }
    #[test]
    fn source_is_fixed_to_this_repository_and_platform() {
        assert!(allowed_package(&Url::parse("https://github.com/CoozeeWang/ripple-transcript-editor/releases/download/v1.0.0/Ripple.app.tar.gz").unwrap(), true));
        assert!(allowed_package(&Url::parse("https://github.com/CoozeeWang/ripple-transcript-editor/releases/download/v1.0.0/Ripple.exe").unwrap(), false));
        for name in ["Ripple.zip", "Ripple.msi", "Ripple.app.tar.gz"] {
            let url = Url::parse(&format!("https://github.com/CoozeeWang/ripple-transcript-editor/releases/download/v1.0.0/{name}")).unwrap();
            assert!(!allowed_package(&url, false));
        }
        for url in ["http://github.com/CoozeeWang/ripple-transcript-editor/releases/download/v1/a.app.tar.gz", "https://github.com/other/repo/releases/download/v1/a.app.tar.gz", "https://github.com@invalid.example/CoozeeWang/ripple-transcript-editor/releases/download/v1/a.app.tar.gz", "https://github.com/CoozeeWang/ripple-transcript-editor/releases/download/v1/a.exe", "https://github.com/CoozeeWang/ripple-transcript-editor/releases/download/v1/a.app.tar.gz?redirect=other"] {
            assert!(!allowed_package(&Url::parse(url).unwrap(), true));
        }
    }
    #[test]
    fn package_must_contain_only_one_app_and_no_escaping_symlinks() {
        fn pack(entries: &[(&str, Option<&str>)]) -> Vec<u8> {
            let mut tar = tar::Builder::new(flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast()));
            for (path, link) in entries {
                let mut header = tar::Header::new_gnu(); header.set_size(0); header.set_mode(0o755);
                if let Some(target) = link { header.set_entry_type(tar::EntryType::Symlink); header.set_link_name(target).unwrap(); }
                else { header.set_entry_type(tar::EntryType::Directory); }
                header.set_cksum(); tar.append_data(&mut header, path, std::io::empty()).unwrap();
            }
            tar.into_inner().unwrap().finish().unwrap()
        }
        for entries in [vec![("Other/", None)], vec![("A.app/",None),("B.app/",None)], vec![("A.app/",None),("A.app/escape",Some("../../outside"))], vec![("A.app/",None),("A.app/absolute",Some("/outside"))]] {
            let out=tempfile::tempdir().unwrap(); assert!(unpack_app(&pack(&entries),out.path()).is_err());
        }
        let out=tempfile::tempdir().unwrap(); assert!(unpack_app(&pack(&[("A.app/",None),("A.app/Contents/",None)]),out.path()).is_ok());
    }
}
