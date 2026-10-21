//! Platform-specific bundled runtime paths and background process creation.
use std::{path::{Path, PathBuf}, process::{Child, Command}};

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

/// Give this tunnel's adapters a distinct process group on Unix.
pub fn tunnel_command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut command = background_command(program);
    #[cfg(unix)] {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    command
}

/// Stop only a child we own and its adapters, so reinstall does not leave file locks.
pub fn stop_tunnel(child: &mut Child) {
    #[cfg(unix)] {
        let group = format!("-{}", child.id());
        let _ = Command::new("/bin/kill").args(["-TERM", &group])
            .stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status();
        // Give the official client a chance to shut down its children normally.
        for _ in 0..10 {
            if matches!(child.try_wait(), Ok(Some(_))) { break; }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        let _ = Command::new("/bin/kill").args(["-KILL", &group])
            .stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status();
    }
    #[cfg(windows)] {
        // Validate the owned handle before addressing its PID, avoiding PID reuse.
        if matches!(child.try_wait(), Ok(None)) {
            let _ = background_command("taskkill").args(["/PID", &child.id().to_string(), "/T", "/F"])
                .stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status();
        }
    }
    let _ = child.kill();
    let _ = child.wait();
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
    #[cfg(unix)]
    #[test]
    fn stopping_owned_tunnel_closes_descendants_output() {
        use std::io::Read;
        let mut child = tunnel_command("/bin/sh").args(["-c", "sleep 30 & wait"])
            .stdout(std::process::Stdio::piped()).spawn().unwrap();
        let mut output = child.stdout.take().unwrap();
        let (send, receive) = std::sync::mpsc::channel();
        std::thread::spawn(move || { let mut data = Vec::new(); let result = output.read_to_end(&mut data); let _ = send.send(result); });
        stop_tunnel(&mut child);
        assert!(receive.recv_timeout(std::time::Duration::from_secs(2)).unwrap().is_ok());
        assert!(child.try_wait().unwrap().is_some());
    }
}
