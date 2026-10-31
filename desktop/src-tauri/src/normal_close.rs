use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};

#[derive(Default)]
pub struct NormalClose {
    ready: AtomicBool,
    pending: AtomicBool,
    approved: AtomicBool,
}
impl NormalClose {
    fn request(&self) -> bool {
        self.ready.load(Ordering::SeqCst) && !self.approved.load(Ordering::SeqCst)
    }
    fn begin(&self) -> bool { !self.pending.swap(true, Ordering::SeqCst) }
}

/// Acknowledgement lets the editor finish its existing save and its small reading preference.
/// Never force a timeout exit: failed saves leave the window and editor state intact.
pub fn request(app: &tauri::AppHandle) -> bool {
    let state = app.state::<NormalClose>();
    if !state.request() { return false; }
    if state.begin() {
        let sent = app.get_webview_window("main").is_some_and(|window| window.emit("ripple-normal-close", ()).is_ok());
        if !sent { state.pending.store(false, Ordering::SeqCst); return false; }
    }
    true
}
#[tauri::command]
pub fn normal_close_ready(window: tauri::WebviewWindow, state: tauri::State<'_, NormalClose>) -> Result<(), String> {
    if !crate::pdf_print::main_window(window.label()) { return Err("main_window_required".into()); }
    state.ready.store(true, Ordering::SeqCst);
    Ok(())
}
#[tauri::command]
pub fn finish_normal_close(window: tauri::WebviewWindow, state: tauri::State<'_, NormalClose>, allow: bool) -> Result<(), String> {
    if !crate::pdf_print::main_window(window.label()) { return Err("main_window_required".into()); }
    if !state.pending.load(Ordering::SeqCst) { return Ok(()); }
    if allow {
        state.approved.store(true, Ordering::SeqCst);
        window.app_handle().exit(0);
    } else { state.pending.store(false, Ordering::SeqCst); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn early_startup_does_not_wait_for_a_missing_frontend() {
        let state = NormalClose::default(); assert!(!state.request());
    }
    #[test]
    fn requests_are_serial_and_cancelled_saves_can_retry() {
        let state = NormalClose::default(); state.ready.store(true, Ordering::SeqCst);
        assert!(state.request()); assert!(state.begin()); assert!(!state.begin());
        state.pending.store(false, Ordering::SeqCst); assert!(state.begin());
    }
    #[test]
    fn approved_exit_does_not_request_the_frontend_again() {
        let state = NormalClose::default(); state.ready.store(true, Ordering::SeqCst);
        state.approved.store(true, Ordering::SeqCst); assert!(!state.request());
    }
}
