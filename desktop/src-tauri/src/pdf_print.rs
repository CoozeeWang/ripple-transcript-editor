use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, WebviewWindow, WebviewWindowBuilder, WebviewUrl};

static SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub fn main_window(label: &str) -> bool { label == "main" }
fn print_window(label: &str) -> bool { label.starts_with("print-preview-") }
fn preview_navigation(url: &tauri::Url) -> bool {
    url.path() == "/print-preview.html" && (
        url.scheme() == "tauri" ||
        matches!(url.host_str(), Some("tauri.localhost" | "localhost" | "127.0.0.1"))
    )
}

#[tauri::command]
pub async fn preview_export_pdf(app: AppHandle, window: WebviewWindow, html: String, title: String, error_label: String) -> Result<(), String> {
    if !main_window(window.label()) { return Err("invalid_print_caller".into()); }
    let label = format!("print-preview-{}", SEQUENCE.fetch_add(1, Ordering::Relaxed));
    let payload = serde_json::json!({ "html": html, "errorLabel": error_label });
    WebviewWindowBuilder::new(&app, label, WebviewUrl::App("print-preview.html".into()))
        .title(&title).inner_size(900.0, 720.0).min_inner_size(640.0, 480.0)
        .initialization_script(format!("window.__RIPPLE_PRINT_PREVIEW__ = {payload};"))
        .on_navigation(preview_navigation)
        .build().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn print_export_pdf(window: WebviewWindow) -> Result<(), String> {
    if !print_window(window.label()) { return Err("invalid_print_caller".into()); }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    { window.print().map_err(|error| error.to_string()) }
    #[cfg(target_os = "windows")]
    {
        use windows_core::Interface;
        use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2_16, COREWEBVIEW2_PRINT_DIALOG_KIND_BROWSER};
        let (sender, receiver) = std::sync::mpsc::channel();
        window.with_webview(move |platform| {
            let result = unsafe {
                platform.controller().CoreWebView2()
                    .and_then(|view| view.cast::<ICoreWebView2_16>())
                    .and_then(|view| view.ShowPrintUI(COREWEBVIEW2_PRINT_DIALOG_KIND_BROWSER))
                    .map_err(|error| error.to_string())
            };
            let _ = sender.send(result);
        }).map_err(|error| error.to_string())?;
        receiver.recv().map_err(|error| error.to_string())?
    }
    #[cfg(target_os = "macos")]
    {
        // WKWebView ignores CSS @page margins; Wry's default print path sets
        // every native margin to zero. Supply the document's existing 18 mm
        // margin on a private copy, preserving the user's shared printer setup.
        use objc2::{msg_send, rc::Retained, runtime::AnyObject};
        use objc2_app_kit::{NSPrintInfo, NSPrintOperation, NSWindow};
        use objc2_foundation::NSCopying;
        let (sender, receiver) = std::sync::mpsc::channel();
        window.with_webview(move |platform| {
            // Tauri runs this closure on the main thread and keeps both native
            // objects alive. The print operation presents a sheet asynchronously.
            let result = unsafe {
                match ((platform.inner() as *mut AnyObject).as_ref(), (platform.ns_window() as *mut NSWindow).as_ref()) {
                    (Some(view), Some(parent)) => {
                        let info = NSPrintInfo::sharedPrintInfo().copy();
                        let margin = 18.0 * 72.0 / 25.4;
                        info.setTopMargin(margin); info.setRightMargin(margin);
                        info.setBottomMargin(margin); info.setLeftMargin(margin);
                        let operation: Retained<NSPrintOperation> = msg_send![view, printOperationWithPrintInfo: &*info];
                        operation.setCanSpawnSeparateThread(true);
                        operation.runOperationModalForWindow_delegate_didRunSelector_contextInfo(parent, None, None, std::ptr::null_mut());
                        Ok(())
                    }
                    _ => Err("print_window_unavailable".to_string()),
                }
            };
            let _ = sender.send(result);
        }).map_err(|error| error.to_string())?;
        receiver.recv().map_err(|error| error.to_string())?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preview_close_does_not_match_main_lifecycle() {
        assert!(main_window("main"));
        assert!(!main_window("print-preview-0"));
        assert!(print_window("print-preview-0"));
        assert!(!print_window("main"));
    }
    #[test]
    fn preview_cannot_navigate_to_other_pages() {
        for address in ["tauri://localhost/print-preview.html", "http://127.0.0.1:1420/print-preview.html", "http://tauri.localhost/print-preview.html"] {
            assert!(preview_navigation(&address.parse().unwrap()));
        }
        for address in ["https://example.com/print-preview.html", "tauri://localhost/index.html", "http://localhost:1420/"] {
            assert!(!preview_navigation(&address.parse().unwrap()));
        }
    }
}
