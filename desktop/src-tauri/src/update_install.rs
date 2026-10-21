//! macOS helper executes from a private copy after the owning app exits.
//! RENAME_SWAP keeps the normal app path a complete bundle even across a crash.
#[cfg(target_os = "macos")]
mod mac {
    use std::{ffi::{CString, c_char, c_int}, fs::{self, File, OpenOptions}, io::Write, os::unix::{ffi::OsStrExt, fs::OpenOptionsExt}, path::{Path, PathBuf}, process::Command, time::{Duration, Instant}};
    unsafe extern "C" {
        fn renamex_np(from: *const c_char, to: *const c_char, flags: u32) -> c_int;
        fn kill(pid: c_int, signal: c_int) -> c_int;
    }
    pub fn exchange(first: &Path, second: &Path) -> Result<(), String> {
        let first = CString::new(first.as_os_str().as_bytes()).map_err(|_| "update_install_failed")?;
        let second = CString::new(second.as_os_str().as_bytes()).map_err(|_| "update_install_failed")?;
        // Darwin stdio.h: RENAME_SWAP = 0x00000002. No non-atomic fallback.
        if unsafe { renamex_np(first.as_ptr(), second.as_ptr(), 0x00000002) } != 0 { return Err("update_install_failed".into()); }
        Ok(())
    }
    fn wait_for_exit(pid: i32, timeout: Duration) -> bool {
        let start = Instant::now();
        loop {
            let exists = unsafe { kill(pid, 0) } == 0 || std::io::Error::last_os_error().raw_os_error() == Some(1);
            if !exists { return true; }
            if start.elapsed() >= timeout { return false; }
            std::thread::sleep(Duration::from_millis(10));
        }
    }
    pub fn external_processes(bundle: &Path, allowed: &[u32]) -> Result<bool, String> {
        let output = Command::new("/bin/ps").args(["-ww", "-axo", "pid=,command="]).output().map_err(|_| "update_in_use")?;
        if !output.status.success() { return Err("update_in_use".into()); }
        let binary = bundle.join("Contents/MacOS/ripple-desktop").to_string_lossy().into_owned();
        let python = bundle.join("Contents/Resources/backend/python/").to_string_lossy().into_owned();
        Ok(String::from_utf8_lossy(&output.stdout).lines().any(|line| {
            let line = line.trim_start();
            let Some((id, command)) = line.split_once(char::is_whitespace) else { return false; };
            let Ok(id) = id.parse::<u32>() else { return false; };
            !allowed.contains(&id) && (command.contains(&binary) || command.contains(&python))
        }))
    }
    fn record(path: &Path, status: &str, version: &str, prepared: &Path, backup: &Path) -> Result<(), String> {
        let value = serde_json::json!({"status":status,"version":version,"prepared":prepared,"backup":backup});
        let temp = path.with_extension("json.tmp");
        let mut file = OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(&temp).map_err(|_| "update_install_failed")?;
        file.write_all(value.to_string().as_bytes()).map_err(|_| "update_install_failed")?;
        file.sync_all().map_err(|_| "update_install_failed")?;
        fs::rename(temp, path).map_err(|_| "update_install_failed")?;
        if let Some(parent) = path.parent() { if let Ok(directory) = File::open(parent) { let _ = directory.sync_all(); } }
        Ok(())
    }
    pub fn replace(app: &Path, prepared: &Path, backup: &Path, result: &Path, version: &str,
        verify: impl Fn(&Path) -> Result<(), String>) -> Result<(), String> {
        if backup.exists() { return Err("update_busy".into()); }
        verify(prepared)?;
        record(result, "installing", version, prepared, backup)?;
        if let Err(error) = exchange(app, prepared) {
            let _ = record(result, "failed", version, prepared, backup); return Err(error);
        }
        // The app path always exists; a failed post-swap check exchanges it back.
        if let Err(error) = verify(app) {
            let status = if exchange(app, prepared).is_ok() { "rolled_back" } else { "recovery_required" };
            let _ = record(result, status, version, prepared, backup); return Err(error);
        }
        // prepared now contains the original app. A failed backup rename retains it there.
        if fs::rename(prepared, backup).is_err() {
            let status = if exchange(app, prepared).is_ok() { "rolled_back" } else { "recovery_required" };
            let _ = record(result, status, version, prepared, backup); return Err("update_install_failed".into());
        }
        record(result, "installed", version, prepared, backup)
    }
    pub fn run(args: &[std::ffi::OsString]) -> i32 {
        if args.len() != 7 { return 64; }
        let Some(pid) = args[1].to_str().and_then(|s| s.parse::<i32>().ok()).filter(|id| *id > 1) else { return 64; };
        let (app, prepared, backup, result) = (PathBuf::from(&args[2]), PathBuf::from(&args[3]), PathBuf::from(&args[4]), PathBuf::from(&args[5]));
        let Some(version) = args[6].to_str().filter(|v| semver::Version::parse(v).is_ok()) else { return 64; };
        if [&app,&prepared,&backup,&result].iter().any(|p| !p.is_absolute()) || app.parent() != prepared.parent() || app.parent() != backup.parent() || app == prepared || app == backup || prepared == backup { return 64; }
        if !wait_for_exit(pid, Duration::from_secs(60)) { let _ = record(&result,"timeout",version,&prepared,&backup); return 1; }
        let replaced = if external_processes(&app, &[]).unwrap_or(true) {
            let _ = record(&result,"blocked",version,&prepared,&backup); Err("update_in_use".into())
        } else {
            replace(&app,&prepared,&backup,&result,version,|path| crate::updates::verified_bundle(path,version))
        };
        if app.exists() { let _ = Command::new("/usr/bin/open").arg(&app).status(); }
        if replaced.is_ok() { 0 } else { 1 }
    }
    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn live_owner_times_out_before_any_replacement() {
            assert!(!wait_for_exit(std::process::id() as i32, Duration::from_millis(15)));
        }
        #[test]
        fn exchange_and_rollback_never_touch_sibling_user_data() {
            let root=tempfile::tempdir().unwrap(); let app=root.path().join("Synthetic Ripple.app"); let prepared=root.path().join(".Synthetic prepared.app");
            let backup=root.path().join(".Synthetic previous.app"); let result=root.path().join("result.json"); let settings=root.path().join("settings.json");
            fs::create_dir(&app).unwrap();fs::create_dir(&prepared).unwrap(); fs::write(app.join("version"),b"old").unwrap();fs::write(prepared.join("version"),b"new").unwrap();fs::write(&settings,b"synthetic settings").unwrap();
            replace(&app,&prepared,&backup,&result,"1.2.3",|_|Ok(())).unwrap();
            assert_eq!(fs::read(app.join("version")).unwrap(),b"new");assert_eq!(fs::read(backup.join("version")).unwrap(),b"old");assert_eq!(fs::read(&settings).unwrap(),b"synthetic settings");
            assert!(replace(&app,&prepared,&backup,&result,"1.2.3",|_|Ok(())).is_err());
        }
        #[test]
        fn failed_post_swap_validation_restores_exact_old_bundle() {
            let root=tempfile::tempdir().unwrap(); let app=root.path().join("Synthetic.app"); let prepared=root.path().join(".prepared.app");let backup=root.path().join(".backup.app");let result=root.path().join("result.json");
            fs::create_dir(&app).unwrap();fs::create_dir(&prepared).unwrap();fs::write(app.join("version"),b"old").unwrap();fs::write(prepared.join("version"),b"new").unwrap();
            assert!(replace(&app,&prepared,&backup,&result,"1.2.3",|p| if p==app {Err("synthetic failure".into())}else{Ok(())}).is_err());
            assert_eq!(fs::read(app.join("version")).unwrap(),b"old");assert_eq!(fs::read(prepared.join("version")).unwrap(),b"new");
            assert_eq!(serde_json::from_slice::<serde_json::Value>(&fs::read(result).unwrap()).unwrap()["status"],"rolled_back");
        }
        #[test]
        fn failed_initial_validation_leaves_the_current_app_unchanged() {
            let root=tempfile::tempdir().unwrap();let app=root.path().join("Synthetic.app");let prepared=root.path().join(".prepared.app");fs::create_dir(&app).unwrap();fs::create_dir(&prepared).unwrap();fs::write(app.join("sentinel"),b"unchanged").unwrap();
            assert!(replace(&app,&prepared,&root.path().join(".backup.app"),&root.path().join("result.json"),"1.2.3",|_|Err("invalid".into())).is_err());assert_eq!(fs::read(app.join("sentinel")).unwrap(),b"unchanged");
        }
    }
}
#[cfg(target_os = "macos")]
pub use mac::{external_processes, run};
#[cfg(all(test, target_os = "macos"))]
pub(crate) use mac::replace;
