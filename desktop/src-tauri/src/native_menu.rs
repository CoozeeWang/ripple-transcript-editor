use std::collections::HashMap;
use tauri::menu::{Menu, MenuItem, MenuItemKind};

pub fn normalize_language(value: &str) -> &'static str {
    match value { "en" => "en", "zh-TW" => "zh-TW", _ => "zh-CN" }
}
pub fn saved_language(app: &tauri::AppHandle) -> String {
    let raw = crate::app_data(app).ok().and_then(|path| std::fs::read_to_string(path.join("interface-language")).ok()).unwrap_or_default();
    normalize_language(raw.trim()).to_string()
}
fn localized_diagnostic(language: &str, key: &str) -> String {
    let source = match normalize_language(language) {
        "en" => include_str!("../../../frontend/src/i18n/locales/en.json"),
        "zh-TW" => include_str!("../../../frontend/src/i18n/locales/zh-TW.json"),
        _ => include_str!("../../../frontend/src/i18n/locales/zh-CN.json"),
    };
    serde_json::from_str::<serde_json::Value>(source).ok()
        .and_then(|value| value.get("desktopRuntime")?.get(key)?.as_str().map(str::to_string))
        .unwrap_or_else(|| "Ripple could not start. Reinstall Ripple.".into())
}
pub fn diagnostic(app: &tauri::AppHandle, key: &str) -> String {
    localized_diagnostic(&saved_language(app), key)
}

pub const UPDATE_ID: &str = "check-for-updates";
fn update_parent(macos: bool, index: usize, text: &str) -> bool {
    if macos { index == 0 } else { text.replace('&', "") == "Help" }
}

fn label(text: &str, labels: &HashMap<String, String>, app_name: &str) -> Option<String> {
    let plain = text.replace('&', "");
    if let Some(value) = labels.get(&plain) { return Some(value.replace("__APP_NAME__", app_name)); }
    for prefix in ["About", "Hide", "Quit"] {
        if let Some(name) = plain.strip_prefix(&format!("{prefix} ")) {
            return labels.get(prefix).map(|value| value.replace("__APP_NAME__", name));
        }
    }
    None
}
fn translate(items: Vec<MenuItemKind<tauri::Wry>>, labels: &HashMap<String, String>, app_name: &str) -> tauri::Result<()> {
    for item in items {
        match item {
            MenuItemKind::Submenu(menu) => {
                if let Some(text) = label(&menu.text()?, labels, app_name) { menu.set_text(text)?; }
                translate(menu.items()?, labels, app_name)?;
            }
            MenuItemKind::Predefined(item) => {
                if let Some(text) = label(&item.text()?, labels, app_name) { item.set_text(text)?; }
            }
            _ => {}
        }
    }
    Ok(())
}
#[tauri::command]
pub fn set_menu_language(app: tauri::AppHandle, labels: HashMap<String, String>, language: String) -> Result<(), String> {
    let language = normalize_language(&language);
    if let Ok(path) = crate::app_data(&app) {
        if let Err(error) = std::fs::create_dir_all(&path).and_then(|_| std::fs::write(path.join("interface-language"), language)) {
            eprintln!("Could not persist interface language: {error}");
        }
    }
    let menu = Menu::default(&app).map_err(|error| error.to_string())?;
    for (index, item) in menu.items().map_err(|e| e.to_string())?.into_iter().enumerate() {
        if let MenuItemKind::Submenu(parent) = item {
            if update_parent(cfg!(target_os = "macos"), index, &parent.text().map_err(|e|e.to_string())?) {
                let text = labels.get("Check for Updates…").map(String::as_str).unwrap_or("Check for Updates…");
                let entry = MenuItem::with_id(&app, UPDATE_ID, text, true, None::<&str>).map_err(|e|e.to_string())?;
                parent.insert(&entry, if cfg!(target_os="macos") { 1 } else { 0 }).map_err(|e|e.to_string())?;
            }
        }
    }
    crate::update_window::language(&app, language, labels.get("Software Update").map(String::as_str).unwrap_or("Software update"));
    translate(menu.items().map_err(|error| error.to_string())?, &labels, &app.package_info().name).map_err(|error| error.to_string())?;
    app.set_menu(menu).map_err(|error| error.to_string())?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn update_entry_uses_platform_convention() {
        assert!(update_parent(true,0,"Ripple")); assert!(!update_parent(true,5,"Help"));
        assert!(update_parent(false,4,"&Help")); assert!(!update_parent(false,0,"Ripple"));
    }
    #[test]
    fn translates_default_mnemonics_and_keeps_app_identity() {
        let labels = HashMap::from([("Select All".into(), "全选".into()), ("About".into(), "关于 __APP_NAME__".into())]);
        assert_eq!(label("Select &All", &labels, "Ripple"), Some("全选".into()));
        assert_eq!(label("About Ripple Dev", &labels, "Ripple"), Some("关于 Ripple Dev".into()));
        assert_eq!(label("Synthetic window title", &labels, "Ripple"), None);
    }
    #[test]
    fn supported_languages_and_startup_diagnostics_use_the_same_resources() {
        assert_eq!(normalize_language("zh-TW"), "zh-TW");
        assert_eq!(normalize_language("unexpected"), "zh-CN");
        assert_eq!(localized_diagnostic("zh-TW", "connectorNotReady"), "MCP 本機連線尚未就緒");
        assert!(localized_diagnostic("en", "runtimeMissing").contains("runtime is missing"));
        assert!(localized_diagnostic("zh-CN", "runtimeMissing").contains("请重新安装"));
    }

}
