//! Native shell opening: acceptance of an open request is not client installation.
#[cfg(not(target_os = "windows"))]
use std::process::Command;

#[cfg(any(target_os = "windows", test))]
fn shell_result(code: isize) -> Result<(), String> {
    match code {
        33.. => Ok(()),
        31 => Err("open_no_association".into()),
        2 | 3 => Err("open_target_missing".into()),
        5 => Err("open_access_denied".into()),
        _ => Err("open_install_failed".into()),
    }
}

pub fn open(target: &str, application: Option<&str>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        use windows_sys::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE};
        let _ = application;
        let target: Vec<u16> = std::ffi::OsStr::new(target).encode_wide().chain(Some(0)).collect();
        let verb: Vec<u16> = "open\0".encode_utf16().collect();
        // Unlike Explorer's process exit code, ShellExecute returns a documented
        // dispatch result and an explicit missing-association error. Wide strings
        // preserve Unicode paths without cmd.exe quoting or code-page conversion.
        // Packaged Windows applications can dispatch through COM shell handlers.
        let initialized = unsafe { CoInitializeEx(std::ptr::null(), COINIT_APARTMENTTHREADED as u32 | COINIT_DISABLE_OLE1DDE as u32) };
        if initialized < 0 { return Err("open_install_failed".into()); }
        let code = unsafe { ShellExecuteW(std::ptr::null_mut(), verb.as_ptr(), target.as_ptr(),
            std::ptr::null(), std::ptr::null(), 1) } as isize;
        unsafe { CoUninitialize(); }
        shell_result(code)
    }
    #[cfg(not(target_os = "windows"))]
    {
        #[cfg(target_os = "macos")]
        let mut command = Command::new("open");
        #[cfg(not(target_os = "macos"))]
        let mut command = Command::new("xdg-open");
        #[cfg(target_os = "macos")]
        if let Some(name) = application { command.args(["-a", name]); }
        #[cfg(not(target_os = "macos"))]
        let _ = application;
        if !target.is_empty() { command.arg(target); }
        match command.status() {
            Ok(result) if result.success() => Ok(()),
            _ => Err("open_install_failed".into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dispatch_result_is_not_explorer_exit_status_or_installation_proof() {
        assert!(shell_result(33).is_ok());
        assert_eq!(shell_result(31).unwrap_err(), "open_no_association");
        assert_eq!(shell_result(2).unwrap_err(), "open_target_missing");
        assert_eq!(shell_result(5).unwrap_err(), "open_access_denied");
        assert_eq!(shell_result(0).unwrap_err(), "open_install_failed");
    }
}
