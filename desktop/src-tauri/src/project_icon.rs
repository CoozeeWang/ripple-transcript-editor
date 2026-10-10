//! Finder decoration only: projects remain ordinary, portable directories.
use std::{fs, path::Path};
pub fn validate_project(path: &Path) -> Result<(), String> {
    if !path.is_dir() || path.extension().and_then(|s|s.to_str()) != Some("ripple") { return Err("invalid_project_icon_target".into()); }
    let raw = fs::read(path.join("ripple-project.json")).map_err(|_|"invalid_project_icon_target")?;
    let data: serde_json::Value = serde_json::from_slice(&raw).map_err(|_|"invalid_project_icon_target")?;
    if data["kind"] != "ripple-project" || data["schemaVersion"] != 1 || !data["id"].is_string() { return Err("invalid_project_icon_target".into()); }
    Ok(())
}
#[cfg(target_os = "macos")]
pub fn apply(path: &Path) -> Result<bool, String> {
    use objc2::AnyThread;
    use objc2_app_kit::{NSImage, NSWorkspace, NSWorkspaceIconCreationOptions};
    use objc2_foundation::{NSData, NSString};
    validate_project(path)?;
    let image = NSImage::initWithData(NSImage::alloc(), &NSData::with_bytes(include_bytes!("../icons/project.icns")))
        .ok_or("project_icon_invalid")?;
    Ok(NSWorkspace::sharedWorkspace().setIcon_forFile_options(Some(&image),
        &NSString::from_str(path.to_str().ok_or("invalid_path")?), NSWorkspaceIconCreationOptions::empty()))
}
#[cfg(not(target_os = "macos"))]
pub fn apply(_: &Path) -> Result<bool, String> { Ok(true) }
#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> tempfile::TempDir {
        let tmp = tempfile::tempdir().unwrap(); let folder=tmp.path().join("synthetic.ripple"); fs::create_dir(&folder).unwrap();
        fs::write(folder.join("ripple-project.json"), br#"{"kind":"ripple-project","schemaVersion":1,"id":"synthetic"}"#).unwrap(); tmp
    }
    #[test]
    fn rejects_unrelated_directories_and_invalid_indexes() {
        let tmp=fixture(); assert!(validate_project(&tmp.path().join("synthetic.ripple")).is_ok());
        assert!(validate_project(tmp.path()).is_err());
        fs::write(tmp.path().join("synthetic.ripple/ripple-project.json"),b"broken").unwrap();
        assert!(validate_project(&tmp.path().join("synthetic.ripple")).is_err());
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn sets_a_finder_custom_icon_without_changing_the_project_index_or_folder_kind() {
        let tmp=fixture(); let folder=tmp.path().join("synthetic.ripple");
        let original=fs::read(folder.join("ripple-project.json")).unwrap();
        assert!(apply(&folder).unwrap()); assert!(folder.is_dir());
        assert_eq!(fs::read(folder.join("ripple-project.json")).unwrap(),original);
        let attributes=std::process::Command::new("/usr/bin/xattr").args(["-px","com.apple.FinderInfo"]).arg(&folder).output().unwrap();
        assert!(attributes.status.success());
        let hex=String::from_utf8(attributes.stdout).unwrap().split_whitespace().collect::<String>();
        assert_eq!(u16::from_str_radix(&hex[16..20],16).unwrap() & 0x0400, 0x0400);
        assert!(folder.join("Icon\r").exists());
    }
}
