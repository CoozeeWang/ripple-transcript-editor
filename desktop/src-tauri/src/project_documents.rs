//! OS-selected document packages. The directory format stays unchanged.
use std::{collections::VecDeque, path::PathBuf, sync::Mutex};

#[derive(Default)]
pub struct PendingProjects(Mutex<VecDeque<PathBuf>>);

fn local_project(url: &url::Url) -> Option<PathBuf> {
    if url.scheme() != "file" || url.host_str().is_some_and(|host| host != "localhost")
        || url.query().is_some() || url.fragment().is_some() { return None; }
    let path = url.to_file_path().ok()?;
    if path.extension()?.to_str()? != "ripple" || !path.is_dir() { return None; }
    path.canonicalize().ok()
}

impl PendingProjects {
    pub fn enqueue(&self, urls: &[url::Url]) -> bool {
        let Ok(mut pending) = self.0.lock() else { return false; };
        let mut accepted = false;
        for path in urls.iter().filter_map(local_project) {
            if pending.len() < 16 && !pending.contains(&path) {
                pending.push_back(path);
                accepted = true;
            }
        }
        accepted
    }

    pub fn pop(&self) -> Result<Option<PathBuf>, String> {
        Ok(self.0.lock().map_err(|_| "permission_required")?.pop_front())
    }
}

#[cfg(target_os = "macos")]
pub async fn pick(app: tauri::AppHandle) -> Result<PathBuf, String> {
    let (sender, receiver) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        use objc2_app_kit::{NSOpenPanel, NSModalResponseOK};
        use objc2_foundation::MainThreadMarker;
        let result = (|| {
            let panel = NSOpenPanel::openPanel(MainThreadMarker::new().ok_or("permission_required")?);
            panel.setCanChooseFiles(true);
            panel.setCanChooseDirectories(true);
            panel.setAllowsMultipleSelection(false);
            panel.setTreatsFilePackagesAsDirectories(false);
            if panel.runModal() != NSModalResponseOK { return Err("selection_cancelled".to_string()); }
            let urls = panel.URLs();
            let path = urls.firstObject().and_then(|url| url.path()).ok_or("selection_cancelled")?;
            let path = PathBuf::from(path.to_string());
            if !path.is_dir() { return Err("invalid_project_folder".into()); }
            Ok(path)
        })();
        let _ = sender.send(result);
    }).map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || receiver.recv().map_err(|e| e.to_string())?)
        .await.map_err(|e| e.to_string())?
}

#[cfg(not(target_os = "macos"))]
pub async fn pick(app: tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri_plugin_dialog::DialogExt;
    tauri::async_runtime::spawn_blocking(move || app.dialog().file().blocking_pick_folder())
        .await.map_err(|e| e.to_string())?.ok_or("selection_cancelled")?
        .into_path().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn queues_local_packages_once_and_preserves_contents() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("Synthetic 中文 project.ripple");
        std::fs::create_dir(&path).unwrap();
        std::fs::write(path.join("ripple-project.json"), b"synthetic index").unwrap();
        let url = url::Url::from_file_path(&path).unwrap();
        let pending = PendingProjects::default();
        assert!(pending.enqueue(&[url.clone(), url.clone()]));
        assert_eq!(pending.pop().unwrap(), Some(path.canonicalize().unwrap()));
        assert_eq!(pending.pop().unwrap(), None);
        // A later deliberate reopen is accepted.
        assert!(pending.enqueue(&[url]));
        assert_eq!(std::fs::read(path.join("ripple-project.json")).unwrap(), b"synthetic index");
    }
    #[test]
    fn bounds_the_queue_and_preserves_order() {
        let temp = tempfile::tempdir().unwrap();
        let urls = (0..20).map(|index| {
            let path = temp.path().join(format!("synthetic-{index}.ripple"));
            std::fs::create_dir(&path).unwrap();
            url::Url::from_file_path(path).unwrap()
        }).collect::<Vec<_>>();
        let pending = PendingProjects::default();
        assert!(pending.enqueue(&urls));
        for url in urls.iter().take(16) {
            assert_eq!(pending.pop().unwrap(), Some(url.to_file_path().unwrap().canonicalize().unwrap()));
        }
        assert_eq!(pending.pop().unwrap(), None);
        let mut with_query = urls[0].clone();
        with_query.set_query(Some("synthetic=1"));
        let mut with_fragment = urls[0].clone();
        with_fragment.set_fragment(Some("synthetic"));
        assert!(!pending.enqueue(&[with_query, with_fragment]));
    }
    #[test]
    fn rejects_remote_urls_files_and_non_projects() {
        for raw in ["https://example.invalid/test.ripple", "file://server/test.ripple", "file:///missing.ripple", "file:///tmp"] {
            assert!(local_project(&url::Url::parse(raw).unwrap()).is_none());
        }
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("synthetic.ripple");
        std::fs::write(&path, b"not a package").unwrap();
        assert!(local_project(&url::Url::from_file_path(path).unwrap()).is_none());
    }
}
