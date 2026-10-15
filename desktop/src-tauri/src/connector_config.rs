//! Fixed, authenticated loopback request. Never return a credential or raw response.
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

pub fn setup_error(output: &[u8]) -> String {
    let value: serde_json::Value = serde_json::from_slice(output).unwrap_or_default();
    match value.get("error").and_then(|v| v.as_str()) {
        Some(code @ ("setup_client_invalid" | "setup_tunnel_invalid" | "setup_key_invalid"
            | "setup_write_failed" | "setup_input_invalid")) => code.into(),
        _ => "setup_failed".into(),
    }
}

pub fn delete_request(port: u16, key: &str, client: &str) -> Result<(), String> {
    if !matches!(client, "chatgpt" | "claude" | "workbuddy") {
        return Err("invalid_client".into());
    }
    let key = key.trim();
    if key.len() < 32 || !key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') {
        return Err("connector_delete_failed".into());
    }
    let body = serde_json::json!({"client":client}).to_string();
    let request = format!("POST /api/connector/configuration/delete HTTP/1.0\r\nHost: localhost\r\nAuthorization: Bearer {key}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
    let fail = |_| "connector_delete_failed".to_string();
    let mut stream = TcpStream::connect_timeout(&SocketAddr::from(([127, 0, 0, 1], port)), Duration::from_secs(2)).map_err(fail)?;
    stream.set_read_timeout(Some(Duration::from_secs(5))).map_err(fail)?;
    stream.set_write_timeout(Some(Duration::from_secs(2))).map_err(fail)?;
    stream.write_all(request.as_bytes()).map_err(fail)?;
    let mut response = String::new();
    stream.take(16_384).read_to_string(&mut response).map_err(fail)?;
    let (headers, body) = response.split_once("\r\n\r\n").ok_or("connector_delete_failed")?;
    let value: serde_json::Value = serde_json::from_str(body).map_err(|_| "connector_delete_failed")?;
    if (headers.starts_with("HTTP/1.1 200 ") || headers.starts_with("HTTP/1.0 200 "))
        && value.get("deleted").and_then(|v| v.as_str()) == Some(client) {
        return Ok(());
    }
    if value.get("detail").and_then(|v| v.as_str()) == Some("connector_client_busy") {
        Err("connector_client_busy".into())
    } else {
        Err("connector_delete_failed".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    #[test]
    fn setup_errors_only_forward_known_codes() {
        assert_eq!(setup_error(br#"{"error":"setup_client_invalid"}"#), "setup_client_invalid");
        assert_eq!(setup_error(br#"{"error":"synthetic secret or path"}"#), "setup_failed");
        assert_eq!(setup_error(b"traceback or non-JSON"), "setup_failed");
    }
    fn response(status: &str, body: &str) -> Result<(), String> {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let reply = format!("HTTP/1.0 {status}\r\nContent-Length: {}\r\n\r\n{body}", body.len());
        let thread = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut bytes = [0; 2048];
            let count = socket.read(&mut bytes).unwrap();
            let request = String::from_utf8_lossy(&bytes[..count]);
            assert!(request.starts_with("POST /api/connector/configuration/delete HTTP/1.0"));
            assert!(request.contains("Authorization: Bearer synthetic_key_for_public_test_123456"));
            socket.write_all(reply.as_bytes()).unwrap();
        });
        let result = delete_request(port, "synthetic_key_for_public_test_123456", "claude");
        thread.join().unwrap();
        result
    }
    #[test]
    fn requires_exact_success_and_maps_busy_without_raw_errors() {
        assert!(response("200 OK", r#"{"deleted":"claude"}"#).is_ok());
        assert!(response("200 OK", r#"{"deleted":"workbuddy"}"#).is_err());
        assert_eq!(response("409 Conflict", r#"{"detail":"connector_client_busy"}"#).unwrap_err(), "connector_client_busy");
        assert_eq!(response("500 Error", r#"{"detail":"synthetic private detail"}"#).unwrap_err(), "connector_delete_failed");
    }
    #[test]
    fn rejects_unknown_targets_and_header_injection_before_connection() {
        assert_eq!(delete_request(0, "synthetic_key_for_public_test_123456", "other").unwrap_err(), "invalid_client");
        assert!(delete_request(0, "synthetic_key_for_public_test_123456\r\nInjected: value", "claude").is_err());
    }
}
