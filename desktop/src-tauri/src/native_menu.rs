use std::collections::HashMap;
use tauri::menu::{Menu, MenuItemKind};

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
pub fn set_menu_language(app: tauri::AppHandle, labels: HashMap<String, String>) -> Result<(), String> {
    let menu = Menu::default(&app).map_err(|error| error.to_string())?;
    translate(menu.items().map_err(|error| error.to_string())?, &labels, &app.package_info().name).map_err(|error| error.to_string())?;
    app.set_menu(menu).map_err(|error| error.to_string())?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn translates_default_mnemonics_and_keeps_app_identity() {
        let labels = HashMap::from([("Select All".into(), "全选".into()), ("About".into(), "关于 __APP_NAME__".into())]);
        assert_eq!(label("Select &All", &labels, "Ripple"), Some("全选".into()));
        assert_eq!(label("About Ripple Dev", &labels, "Ripple"), Some("关于 Ripple Dev".into()));
        assert_eq!(label("Synthetic window title", &labels, "Ripple"), None);
    }
}
