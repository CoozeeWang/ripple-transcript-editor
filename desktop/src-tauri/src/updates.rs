//! User-initiated release lookup. No package is downloaded or installed by Ripple.
use serde::Serialize;
use std::{sync::Mutex, time::Duration};
use tauri::{AppHandle, State};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    current_version: String,
    build: Option<String>,
    phase: &'static str,
    available_version: Option<String>,
    notes: Option<String>,
    error: Option<&'static str>,
    release_url: Option<String>,
}
pub struct Updates(Mutex<UpdateInfo>);
impl Updates {
    pub fn new(app: &AppHandle) -> Self {
        Self(Mutex::new(UpdateInfo {
            current_version: app.package_info().version.to_string(),
            build: option_env!("RIPPLE_BUILD_NUMBER").map(str::to_owned),
            phase: "idle", available_version: None, notes: None, error: None, release_url: None,
        }))
    }
}
#[tauri::command]
pub fn update_status(state: State<'_, Updates>) -> Result<UpdateInfo, String> {
    Ok(state.0.lock().map_err(|_| "update_busy")?.clone())
}
#[tauri::command]
pub async fn update_check(app: AppHandle, state: State<'_, Updates>) -> Result<UpdateInfo, String> {
    if crate::development(&app) { return Err("update_development".into()); }
    {
        let mut info = state.0.lock().map_err(|_| "update_busy")?;
        if info.phase == "checking" { return Err("update_busy".into()); }
        info.phase = "checking"; info.error = None; info.available_version = None;
        info.notes = None; info.release_url = None;
    }
    let result = tokio::time::timeout(Duration::from_secs(60), async {
        let client = crate::update_releases::client(Duration::from_secs(20))?;
        crate::update_releases::discover(&client).await
    }).await.unwrap_or(Err("update_check_failed"));
    let mut info = state.0.lock().map_err(|_| "update_busy")?;
    match result {
        Ok(releases) => {
            let current = semver::Version::parse(&info.current_version).map_err(|_| "update_check_failed")?;
            if releases.is_empty() {
                info.phase = "no_releases";
                return Ok(info.clone());
            }
            let newer: Vec<_> = releases.into_iter().filter(|release| release.version.cmp_precedence(&current).is_gt()).collect();
            if let Some(release) = newer.iter().find(|release| release.platform_available) {
                info.phase = "available";
                info.available_version = Some(release.version.to_string());
                info.notes = release.notes.clone().map(|s| s.chars().take(16000).collect());
                info.release_url = Some(release.url.to_string());
            } else { info.phase = if newer.is_empty() { "current" } else { "unavailable" }; }
        }
        Err(code) => { info.phase = "error"; info.error = Some(code); }
    }
    Ok(info.clone())
}
#[tauri::command]
pub fn update_open_releases(state: State<'_, Updates>) -> Result<(), String> {
    let url = state.0.lock().map_err(|_| "update_busy")?.release_url.clone()
        .unwrap_or_else(|| crate::update_releases::RELEASES.to_owned());
    crate::install_target::open(&url, None)
}
