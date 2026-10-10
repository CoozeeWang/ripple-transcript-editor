//! App-owned, persistent capabilities for explicitly selected files and folders.
//! Browser handle descriptors alone never authorize a path.
use serde::{Deserialize, Serialize};
use std::{fs, io::Write, path::{Path, PathBuf}, sync::Mutex};

#[derive(Clone, Serialize, Deserialize)]
pub struct Grant {
    pub root: String,
    pub path: PathBuf,
    pub base_parts: Vec<String>,
    pub directory: bool,
    pub writable: bool,
    identity: String,
    #[serde(default)]
    bookmark: Vec<u8>,
}
#[derive(Serialize, Deserialize)]
struct Registry { version: u8, grants: Vec<Grant> }
pub struct Grants { pub entries: Mutex<Vec<Grant>>, store: PathBuf }

pub fn io_error(error: std::io::Error) -> String {
    match error.kind() {
        std::io::ErrorKind::NotFound => "file_missing".into(),
        std::io::ErrorKind::PermissionDenied => "permission_required".into(),
        _ => error.to_string(),
    }
}
fn identity(path: &Path) -> Result<String, String> {
    let metadata = fs::metadata(path).map_err(io_error)?;
    #[cfg(unix)] {
        use std::os::unix::fs::MetadataExt;
        Ok(format!("{}:{}", metadata.dev(), metadata.ino()))
    }
    #[cfg(windows)] {
        use std::os::windows::{fs::OpenOptionsExt, io::AsRawHandle};
        use windows_sys::Win32::Storage::FileSystem::{GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_FLAG_BACKUP_SEMANTICS, FILE_READ_ATTRIBUTES};
        let file = fs::OpenOptions::new().access_mode(FILE_READ_ATTRIBUTES)
            .share_mode(7).custom_flags(FILE_FLAG_BACKUP_SEMANTICS).open(path).map_err(io_error)?;
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 { return Err(io_error(std::io::Error::last_os_error())); }
        Ok(format!("{}:{}:{}",info.dwVolumeSerialNumber,info.nFileIndexHigh,info.nFileIndexLow))
    }
    #[cfg(not(any(unix, windows)))] { Err("Persistent resource identity is unsupported on this platform".into()) }
}
#[cfg(target_os = "macos")]
fn bookmark(path: &Path) -> Result<Vec<u8>, String> {
    use objc2_foundation::{NSString, NSURL, NSURLBookmarkCreationOptions};
    let text = path.to_str().ok_or("invalid_path")?;
    let url = NSURL::fileURLWithPath(&NSString::from_str(text));
    // Ripple is not App Sandbox enabled. Ordinary Foundation bookmarks track
    // file identity across moves; do not pretend to create sandbox extensions.
    let data = url.bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(
        NSURLBookmarkCreationOptions::empty(), None, None).map_err(|_|"bookmark_failed")?;
    Ok(data.to_vec())
}
#[cfg(not(target_os = "macos"))]
fn bookmark(_: &Path) -> Result<Vec<u8>, String> { Ok(Vec::new()) }
#[cfg(target_os = "macos")]
fn resolve_bookmark(data: &[u8]) -> Option<PathBuf> {
    use objc2_foundation::{NSData, NSURL, NSURLBookmarkResolutionOptions};
    let url = unsafe { NSURL::URLByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error(
        &NSData::with_bytes(data), NSURLBookmarkResolutionOptions::WithoutUI | NSURLBookmarkResolutionOptions::WithoutMounting,
        None, std::ptr::null_mut()) }.ok()?;
    url.path().map(|path| PathBuf::from(path.to_string()))
}
#[cfg(not(target_os = "macos"))]
fn resolve_bookmark(_: &[u8]) -> Option<PathBuf> { None }

impl Grant {
    pub fn selected(root: String, path: PathBuf, base_parts: Vec<String>, directory: bool, writable: bool) -> Result<Self, String> {
        let path = path.canonicalize().map_err(io_error)?;
        let identity = identity(&path)?;
        let bookmark = bookmark(&path)?;
        Ok(Self { root, path, base_parts, directory, writable, identity, bookmark })
    }
    pub fn validate(&self) -> Result<(), String> {
        let path = self.path.canonicalize().map_err(io_error)?;
        if path != self.path || identity(&path)? != self.identity { return Err("permission_required".into()); }
        let metadata = fs::metadata(&path).map_err(io_error)?;
        if metadata.is_dir() != self.directory { return Err("permission_required".into()); }
        Ok(())
    }
}
impl Grants {
    pub fn load(store: PathBuf) -> Result<Self, String> {
        let mut entries = match fs::read(&store) {
            Ok(bytes) => {
                let registry: Registry = serde_json::from_slice(&bytes).map_err(|_|"Invalid saved file permissions; keep the registry for recovery")?;
                if registry.version != 1 { return Err("Unsupported file permission registry".into()); }
                registry.grants
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(error) => return Err(io_error(error)),
        };
        for grant in &mut entries {
            if let Some(path) = resolve_bookmark(&grant.bookmark).and_then(|p|p.canonicalize().ok()) {
                if identity(&path).ok().as_ref() == Some(&grant.identity) { grant.path = path; }
            }
        }
        Ok(Self { entries: Mutex::new(entries), store })
    }
    pub fn remember(&self, grant: Grant) -> Result<(), String> {
        let mut entries = self.entries.lock().map_err(|_|"permission_required")?;
        let mut next = entries.clone();
        next.retain(|g| !(g.root == grant.root && g.base_parts == grant.base_parts));
        next.push(grant);
        let parent = self.store.parent().ok_or("invalid_permission_store")?;
        fs::create_dir_all(parent).map_err(io_error)?;
        let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(io_error)?;
        let bytes = serde_json::to_vec(&Registry { version: 1, grants: next.clone() }).map_err(|e|e.to_string())?;
        temporary.write_all(&bytes).map_err(io_error)?;
        temporary.as_file().sync_all().map_err(io_error)?;
        temporary.persist(&self.store).map_err(|e|io_error(e.error))?;
        *entries = next;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn selections_survive_restart_but_deleted_or_replaced_resources_do_not() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("synthetic.wav"); fs::write(&file,b"synthetic audio").unwrap();
        let store = tmp.path().join("permissions.json");
        let grants = Grants::load(store.clone()).unwrap();
        grants.remember(Grant::selected("selected-audio".into(),file.clone(),vec![],false,false).unwrap()).unwrap();
        let restored = Grants::load(store.clone()).unwrap();
        let entries = restored.entries.lock().unwrap();
        assert!(entries[0].validate().is_ok()); assert!(!entries[0].writable);
        fs::rename(&file,tmp.path().join("original.wav")).unwrap();
        fs::write(&file,b"replacement").unwrap();
        assert!(entries[0].validate().is_err());
        fs::remove_file(&file).unwrap(); assert_eq!(entries[0].validate().unwrap_err(),"file_missing");
    }
    #[test]
    fn explicit_reselection_replaces_stale_permission_and_corruption_fails_closed() {
        let tmp = tempfile::tempdir().unwrap(); let folder = tmp.path().join("synthetic.ripple"); fs::create_dir(&folder).unwrap();
        let store = tmp.path().join("permissions.json"); let grants = Grants::load(store.clone()).unwrap();
        for _ in 0..2 { grants.remember(Grant::selected("project".into(),folder.clone(),vec![],true,true).unwrap()).unwrap(); }
        assert_eq!(Grants::load(store.clone()).unwrap().entries.lock().unwrap().len(),1);
        fs::write(&store,b"broken").unwrap(); assert!(Grants::load(store).is_err());
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn foundation_bookmark_never_grants_a_replacement_at_the_old_path() {
        let tmp = tempfile::tempdir().unwrap(); let original=tmp.path().join("original.wav"); let moved=tmp.path().join("moved.wav");
        fs::write(&original,b"synthetic audio").unwrap(); let store=tmp.path().join("permissions.json");
        let grants=Grants::load(store.clone()).unwrap();
        grants.remember(Grant::selected("original-handle".into(),original.clone(),vec![],false,false).unwrap()).unwrap();
        fs::rename(&original,&moved).unwrap(); fs::write(&original,b"replacement").unwrap();
        let restored=Grants::load(store).unwrap(); let entries=restored.entries.lock().unwrap();
        // Foundation may resolve a moved file or require explicit recovery.
        // Either result is safe; a replacement at the old path must not gain access.
        if entries[0].validate().is_ok() { assert_eq!(entries[0].path,moved.canonicalize().unwrap()); }
        else { assert_ne!(identity(&original).unwrap(), entries[0].identity); }
    }
}
