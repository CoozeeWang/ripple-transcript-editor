use std::collections::HashMap;
use tauri::menu::{Menu, MenuItem, MenuItemKind};

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
    crate::update_window::language(&app, &language, labels.get("Software Update").map(String::as_str).unwrap_or("Software update"));
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
}
