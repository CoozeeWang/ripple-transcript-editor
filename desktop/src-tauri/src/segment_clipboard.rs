use serde::Deserialize;
#[derive(Deserialize)]
pub struct Payload { pub(crate) plain: String, pub(crate) html: String, pub(crate) rtf: String }
impl Payload {
    pub(crate) fn validate(&self) -> Result<(), String> {
        if self.plain.is_empty() || [&self.plain, &self.html, &self.rtf].iter().any(|s| s.len() > 8 * 1024 * 1024) { return Err("Invalid segment size".into()); }
        Ok(())
    }
}

/// Write all representations together. Verify only the data this call just wrote;
/// never expose unrelated clipboard contents to the webview.
#[tauri::command]
pub fn copy_segment(app: tauri::AppHandle, payload: Payload) -> Result<Vec<String>, String> {
    if crate::segment_protocol::app_channel(&app).is_none() { return Err("Unsupported application identity".into()); }
    payload.validate()?;
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::NSPasteboard;
        use objc2_foundation::{NSArray, NSString};
        let types = [NSString::from_str("public.utf8-plain-text"), NSString::from_str("public.html"), NSString::from_str("public.rtf")];
        let values = [payload.plain, payload.html, payload.rtf];
        let board = NSPasteboard::generalPasteboard();
        // No owner: the values are stored eagerly, no callbacks or borrowed owner.
        unsafe { board.declareTypes_owner(&NSArray::from_retained_slice(&types), None); }
        for (kind, value) in types.iter().zip(&values) {
            if !board.setString_forType(&NSString::from_str(value), kind) { return Err("Clipboard write failed".into()); }
        }
        for (kind, value) in types.iter().zip(&values) {
            if board.stringForType(kind).map(|s| s.to_string()).as_ref() != Some(value) { return Err("Clipboard verification failed".into()); }
        }
        Ok(types.iter().map(|s| s.to_string()).collect())
    }
    #[cfg(not(target_os = "macos"))]
    { let _ = payload; Err("Native rich clipboard unavailable".into()) }
}
