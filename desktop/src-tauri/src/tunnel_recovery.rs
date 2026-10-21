//! Transport-only recovery. Never enqueue or replay an MCP request.
use std::time::{Duration, Instant};

/// Classify bounded warning/error output without returning any raw log text.
pub fn diagnostic(bytes: &[u8]) -> Option<&'static str> {
    let text = String::from_utf8_lossy(bytes).to_ascii_lowercase();
    if text.contains("unauthorized") || text.contains("status=401") || text.contains("\"status\":401") || text.contains("403 forbidden") {
        Some("authorization_failed")
    } else if text.contains("x509:") || text.contains("certificate verify failed") {
        Some("tls_failed")
    } else if text.contains("timeout") || text.contains("connection refused") || text.contains("no such host") {
        Some("network_failed")
    } else if text.contains("error") || text.contains("fatal") {
        Some("client_error")
    } else { None }
}

#[derive(Default)]
pub struct Recovery {
    failures: u32,
    retry_at: Option<Instant>,
    unhealthy_since: Option<Instant>,
    healthy_since: Option<Instant>,
}

impl Recovery {
    pub fn can_start(&self, now: Instant) -> bool {
        self.retry_at.is_none_or(|at| now >= at)
    }
    pub fn failed(&mut self, now: Instant) {
        let seconds = (5u64 << self.failures.min(6)).min(300);
        self.failures = self.failures.saturating_add(1);
        self.retry_at = Some(now + Duration::from_secs(seconds));
        self.unhealthy_since = None;
        self.healthy_since = None;
    }
    /// Allow the official client two minutes to recover its own transport first.
    pub fn unhealthy_too_long(&mut self, ready: bool, now: Instant) -> bool {
        if ready {
            self.unhealthy_since = None;
            let since = *self.healthy_since.get_or_insert(now);
            if now.duration_since(since) >= Duration::from_secs(60) {
                self.failures = 0;
                self.retry_at = None;
            }
            false
        } else {
            self.healthy_since = None;
            let since = *self.unhealthy_since.get_or_insert(now);
            now.duration_since(since) >= Duration::from_secs(120)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn diagnostics_discard_secrets_paths_and_payloads() {
        assert_eq!(diagnostic(br#"{"level":"error","message":"unauthorized synthetic-secret /synthetic/private"}"#), Some("authorization_failed"));
        assert_eq!(diagnostic(b"TLS x509: synthetic secret"), Some("tls_failed"));
        assert_eq!(diagnostic(b"poll timeout synthetic transcript"), Some("network_failed"));
        assert_eq!(diagnostic(b"synthetic request body"), None);
    }
    #[test]
    fn crashes_back_off_and_cap_at_five_minutes() {
        let mut state = Recovery::default();
        let mut now = Instant::now();
        assert!(state.can_start(now));
        for delay in [5, 10, 20, 40, 80, 160, 300, 300] {
            state.failed(now);
            assert!(!state.can_start(now + Duration::from_secs(delay - 1)));
            now += Duration::from_secs(delay);
            assert!(state.can_start(now));
        }
    }
    #[test]
    fn brief_outage_does_not_restart_and_only_stable_health_resets_backoff() {
        let mut state = Recovery::default();
        let now = Instant::now();
        state.failed(now);
        assert!(!state.unhealthy_too_long(false, now));
        assert!(!state.unhealthy_too_long(false, now + Duration::from_secs(119)));
        assert!(!state.unhealthy_too_long(true, now + Duration::from_secs(119)));
        assert!(!state.unhealthy_too_long(false, now + Duration::from_secs(120)));
        assert!(state.unhealthy_too_long(false, now + Duration::from_secs(240)));
        state.unhealthy_too_long(true, now + Duration::from_secs(241));
        state.unhealthy_too_long(true, now + Duration::from_secs(301));
        state.failed(now + Duration::from_secs(302));
        assert!(state.can_start(now + Duration::from_secs(307)));
    }
}
