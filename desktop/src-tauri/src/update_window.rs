use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, WebviewWindowBuilder, WebviewUrl};

pub const LABEL: &str = "desktop-update";
#[derive(Default)]
pub struct UpdateWindow { language: Mutex<String> }
pub fn language(app: &AppHandle, language: &str, title: &str) {
    let normalized = crate::native_menu::normalize_language(language);
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
    let normalized = crate::native_menu::normalize_language(&language);
    let builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html?updateWindow=1".into()))
        .title(match normalized { "en" => "Software update", "zh-TW" => "軟體更新", _ => "软件更新" })
        .inner_size(560.0, 380.0).min_inner_size(480.0, 340.0)
        .initialization_script(format!("window.__RIPPLE_UPDATE_WINDOW__ = {};", serde_json::json!({"language":normalized})))
        .disable_drag_drop_handler().on_navigation(navigation).center();
    #[cfg(target_os="macos")]
    let builder = if crate::development(app) { builder.data_store_identifier(*b"ripple-dev-00001") } else { builder };
    builder.build()?;
    Ok(())
}
#[tauri::command]
pub fn update_close(window: WebviewWindow) -> Result<(), String> {
    if window.label() != LABEL { return Err("update_busy".into()); }
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
}
