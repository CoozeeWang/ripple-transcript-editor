use std::sync::{atomic::{AtomicU64, Ordering}, Mutex};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow, WebviewWindowBuilder, WebviewUrl};
use tokio::sync::oneshot;

pub const LABEL: &str = "desktop-update";
type Reply = Result<(), String>;
struct Pending { token: u64, reply: oneshot::Sender<Reply> }
#[derive(Default)]
pub struct UpdateWindow {
    language: Mutex<String>,
    pending: Mutex<Option<Pending>>,
    phase: Mutex<&'static str>,
    sequence: AtomicU64,
}
impl UpdateWindow {
    pub fn busy(&self) -> bool { self.phase.lock().map(|p| !p.is_empty()).unwrap_or(true) }
    pub fn begin_install(&self, caller: &str) -> Result<(), String> {
        let mut phase = self.phase.lock().map_err(|_| "update_busy")?;
        if caller != LABEL || *phase != "prepared" { return Err("update_work_in_progress".into()); }
        *phase = "installing"; Ok(())
    }
}
pub fn release(app: &AppHandle) {
    let state = app.state::<UpdateWindow>();
    if let Ok(mut p) = state.phase.lock() { *p = ""; }
    if let Ok(mut p) = state.pending.lock() { p.take(); }
    let _ = app.emit_to("main", "desktop-update-release", ());
}
pub fn language(app: &AppHandle, language: &str, title: &str) {
    let normalized = if language == "en" { "en" } else { "zh-CN" };
    if let Ok(mut value) = app.state::<UpdateWindow>().language.lock() { *value = normalized.into(); }
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.set_title(title);
        let _ = window.emit("desktop-update-language", normalized);
    }
}
fn navigation(url: &tauri::Url) -> bool {
    url.path() == "/index.html" && url.query() == Some("updateWindow=1") &&
        ((url.scheme() == "tauri" && url.host_str() == Some("localhost")) ||
         (url.scheme() == "http" && matches!(url.host_str(),Some("tauri.localhost" | "localhost" | "127.0.0.1"))))
}
pub fn open(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(LABEL) {
        window.show()?; window.unminimize()?; window.set_focus()?; return Ok(());
    }
    let language = app.state::<UpdateWindow>().language.lock().map(|v|v.clone()).unwrap_or_default();
    let english = language == "en";
    let builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html?updateWindow=1".into()))
        .title(if english { "Software update" } else { "软件更新" })
        .inner_size(560.0, 440.0).min_inner_size(480.0, 340.0)
        .initialization_script(format!("window.__RIPPLE_UPDATE_WINDOW__ = {};", serde_json::json!({"language":if english {"en"} else {"zh-CN"}})))
        .disable_drag_drop_handler().on_navigation(navigation).center();
    #[cfg(target_os="macos")]
    let builder = if crate::development(app) { builder.data_store_identifier(*b"ripple-dev-00001") } else { builder };
    builder.build()?;
    Ok(())
}
#[tauri::command]
pub async fn update_prepare(app: AppHandle, window: WebviewWindow, state: State<'_, UpdateWindow>) -> Result<(), String> {
    if window.label() != LABEL { return Err("update_work_in_progress".into()); }
    {
        let mut phase = state.phase.lock().map_err(|_| "update_busy")?;
        if !phase.is_empty() { return Err("update_busy".into()); }
        *phase = "preparing";
    }
    let token = state.sequence.fetch_add(1, Ordering::Relaxed) + 1;
    let (sender, receiver) = oneshot::channel();
    *state.pending.lock().map_err(|_| "update_busy")? = Some(Pending { token, reply: sender });
    let result = match app.emit_to("main", "desktop-update-prepare", token) {
        Ok(()) => match tokio::time::timeout(std::time::Duration::from_secs(30), receiver).await {
            Ok(Ok(result)) => result,
            _ => Err("update_work_in_progress".into()),
        },
        Err(_) => Err("update_work_in_progress".into()),
    };
    if result.is_ok() {
        *state.phase.lock().map_err(|_| "update_busy")? = "prepared";
    } else { release(&app); }
    result
}
fn reply(pending: &mut Option<Pending>, caller: &str, token: u64, error: Option<String>) -> Result<(), String> {
    if caller != "main" || pending.as_ref().map(|p|p.token) != Some(token) { return Err("update_work_in_progress".into()); }
    let pending = pending.take().ok_or("update_work_in_progress")?;
    pending.reply.send(error.map_or(Ok(()), Err)).map_err(|_| "update_work_in_progress".into())
}
#[tauri::command]
pub fn update_prepared(window: WebviewWindow, state: State<'_, UpdateWindow>, token: u64, error: Option<String>) -> Result<(), String> {
    reply(&mut *state.pending.lock().map_err(|_| "update_busy")?, window.label(), token, error)
}
#[tauri::command]
pub fn update_close(window: WebviewWindow, state: State<'_, UpdateWindow>) -> Result<(), String> {
    if window.label() != LABEL || state.busy() { return Err("update_busy".into()); }
    window.close().map_err(|_| "update_busy".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn update_window_only_loads_its_bundled_page() {
        assert!(navigation(&"tauri://localhost/index.html?updateWindow=1".parse().unwrap()));
        assert!(navigation(&"http://tauri.localhost/index.html?updateWindow=1".parse().unwrap()));
        for url in ["https://example.com/index.html?updateWindow=1","tauri://localhost/index.html","tauri://other/index.html?updateWindow=1"] {
            assert!(!navigation(&url.parse().unwrap()));
        }
    }
    #[test]
    fn installation_requires_prepared_update_window() {
        let state=UpdateWindow::default();
        assert!(!state.busy()); assert!(state.begin_install(LABEL).is_err());
        *state.phase.lock().unwrap()="prepared";
        assert!(state.begin_install("main").is_err()); assert!(state.busy());
        assert!(state.begin_install(LABEL).is_ok()); assert!(state.begin_install(LABEL).is_err());
    }
    #[tokio::test]
    async fn save_reply_requires_main_and_current_token_and_propagates_failure() {
        let (sender, receiver)=oneshot::channel();
        let mut pending=Some(Pending{token:2,reply:sender});
        assert!(reply(&mut pending,LABEL,2,None).is_err());
        assert!(reply(&mut pending,"main",1,None).is_err());
        reply(&mut pending,"main",2,Some("update_unsaved_project".into())).unwrap();
        assert_eq!(receiver.await.unwrap(),Err("update_unsaved_project".into()));
        assert!(reply(&mut pending,"main",2,None).is_err());
    }
}
