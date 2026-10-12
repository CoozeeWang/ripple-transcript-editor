//! Platform-specific bundled runtime paths and background process creation.
use std::{path::{Path, PathBuf}, process::Command};

pub fn python_for(resources: &Path, windows: bool) -> PathBuf {
    resources.join(if windows { "python/python.exe" } else { "python/bin/python3.12" })
}
pub fn python(resources: &Path) -> PathBuf { python_for(resources, cfg!(windows)) }
pub fn background_command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW; no console steals editor focus.
    }
    #[cfg(not(windows))] { let _ = &mut command; }
    command
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bundled_runtime_paths_keep_spaces_and_platform_layout() {
        let root = Path::new("Synthetic App 空格/backend");
        assert_eq!(python_for(root, true), root.join("python/python.exe"));
        assert_eq!(python_for(root, false), root.join("python/bin/python3.12"));
    }
}
