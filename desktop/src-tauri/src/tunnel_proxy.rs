//! Only the tunnel child inherits the user's Windows static Internet proxy.
//! Never change system settings, persist endpoints or override explicit process proxies.
use std::process::Command;

#[cfg(any(windows, test))]
fn proxy_endpoint(raw: &str) -> Option<String> {
    let raw = raw.trim();
    let candidate = if raw.contains("://") { raw.to_string() } else { format!("http://{raw}") };
    let url = tauri::Url::parse(&candidate).ok()?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none()
        || !url.username().is_empty() || url.password().is_some()
        || url.path() != "/" || url.query().is_some() || url.fragment().is_some()
        || raw.chars().any(char::is_whitespace) { return None; }
    Some(candidate)
}

#[cfg(any(windows, test))]
fn https_proxy(server: &str) -> Option<String> {
    if !server.contains('=') { return proxy_endpoint(server); }
    server.split(';').filter_map(|entry| entry.trim().split_once('='))
        .find(|(protocol, _)| protocol.trim().eq_ignore_ascii_case("https"))
        .and_then(|(_, address)| proxy_endpoint(address))
}

#[cfg(any(windows, test))]
fn environment(server: &str, bypass: &str, explicit: bool) -> Vec<(&'static str, String)> {
    if explicit { return vec![]; }
    let Some(proxy) = https_proxy(server) else { return vec![]; };
    let mut exclusions = vec!["localhost".to_string(), "127.0.0.1".to_string(), "::1".to_string()];
    for host in bypass.split(';').map(str::trim).filter(|h| !h.is_empty()) {
        // <local> refers to unqualified local hosts; the connector itself is loopback.
        if host == "<local>" { continue; }
        exclusions.push(if host == "*" { "*" } else { host.trim_start_matches('*') }.to_string());
    }
    vec![("HTTPS_PROXY", proxy), ("NO_PROXY", exclusions.join(","))]
}

pub fn apply(command: &mut Command) {
    #[cfg(windows)] {
        let explicit = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"]
            .iter().any(|key| std::env::var_os(key).is_some_and(|v| !v.is_empty()));
        if explicit { return; }
        if let Some((server, bypass)) = windows_static_proxy() {
            for (key, mut value) in environment(&server, &bypass, false) {
                if key == "NO_PROXY" {
                    if let Some(existing) = std::env::var_os("NO_PROXY").or_else(|| std::env::var_os("no_proxy")) {
                        value.push(','); value.push_str(&existing.to_string_lossy());
                    }
                }
                command.env(key, value);
            }
        }
    }
    #[cfg(not(windows))] { let _ = command; }
}

#[cfg(windows)]
fn windows_static_proxy() -> Option<(String, String)> {
    use windows_sys::Win32::{Foundation::GlobalFree, Networking::WinHttp::{WinHttpGetIEProxyConfigForCurrentUser, WINHTTP_CURRENT_USER_IE_PROXY_CONFIG}};
    unsafe fn text(pointer: *const u16) -> String {
        if pointer.is_null() { return String::new(); }
        let mut length = 0;
        while *pointer.add(length) != 0 { length += 1; }
        String::from_utf16_lossy(std::slice::from_raw_parts(pointer, length))
    }
    unsafe {
        let mut config = WINHTTP_CURRENT_USER_IE_PROXY_CONFIG::default();
        if WinHttpGetIEProxyConfigForCurrentUser(&mut config) == 0 { return None; }
        let server = text(config.lpszProxy);
        let bypass = text(config.lpszProxyBypass);
        for pointer in [config.lpszProxy, config.lpszProxyBypass, config.lpszAutoConfigUrl] {
            if !pointer.is_null() { GlobalFree(pointer.cast()); }
        }
        if server.is_empty() { None } else { Some((server, bypass)) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn static_proxy_mapping_uses_https_and_preserves_loopback() {
        assert_eq!(environment("127.0.0.1:7890", "<local>;*.example.test", false),
            vec![("HTTPS_PROXY", "http://127.0.0.1:7890".into()), ("NO_PROXY", "localhost,127.0.0.1,::1,.example.test".into())]);
        assert_eq!(https_proxy("http=127.0.0.1:7890;https=127.0.0.1:7891"), Some("http://127.0.0.1:7891".into()));
        assert_eq!(https_proxy("[::1]:7890"), Some("http://[::1]:7890".into()));
    }
    #[test]
    fn no_guessing_unsupported_proxy_or_overriding_explicit_environment() {
        for value in ["", "socks=127.0.0.1:7890", "http=127.0.0.1:7890", "http://proxy.test/path", "http://user:secret@proxy.test", "127.0.0.1:70000"] {
            assert!(https_proxy(value).is_none(), "{value}");
        }
        assert!(environment("127.0.0.1:7890", "", true).is_empty());
    }
    #[cfg(windows)]
    #[test]
    fn native_static_proxy_query_is_read_only_and_frees_returned_strings() {
        let _ = windows_static_proxy();
    }
}
