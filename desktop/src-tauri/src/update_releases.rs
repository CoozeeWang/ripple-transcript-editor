//! Published official releases with a manual download for this platform.
use serde::Deserialize;
use url::Url;

pub const RELEASES: &str = "https://github.com/CoozeeWang/ripple-transcript-editor/releases";
const API: &str = "https://api.github.com/repos/CoozeeWang/ripple-transcript-editor/releases";
const PAGE_SIZE: usize = 100;
const MAX_PAGES: usize = 10;
const MAX_INDEX_BYTES: usize = 2 * 1024 * 1024;

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    published_at: Option<String>,
    body: Option<String>,
    assets: Vec<Asset>,
}
#[derive(Deserialize)]
struct Asset { name: String }
#[derive(Debug)]
pub struct Catalog { pub version: semver::Version, pub url: Url, pub notes: Option<String>, pub platform_available: bool }

pub fn client(timeout: std::time::Duration) -> Result<reqwest::Client, &'static str> {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    reqwest::Client::builder().user_agent("Ripple-Release-Check").timeout(timeout)
        .build().map_err(|_| "update_check_failed")
}
fn manual_asset(name: &str, platform: &str) -> bool {
    if !name.starts_with("Ripple-") { return false; }
    match platform {
        "macos" => name.ends_with(".dmg") || (name.ends_with(".zip") && name.to_ascii_lowercase().contains("mac")),
        "windows" => name.ends_with(".exe"),
        _ => false,
    }
}
fn catalogs(releases: Vec<Release>, platform: &str) -> Vec<Catalog> {
    releases.into_iter().filter_map(|release| {
        if release.draft || release.published_at.as_deref().is_none_or(str::is_empty) { return None; }
        if !release.tag_name.bytes().all(|b| b.is_ascii_alphanumeric() || b".-_".contains(&b)) { return None; }
        let version = semver::Version::parse(release.tag_name.strip_prefix('v').unwrap_or(&release.tag_name)).ok()?;
        let beta = version.pre.as_str().strip_prefix("beta.")
            .is_some_and(|number| number.parse::<u64>().is_ok_and(|n| n > 0));
        if (!version.pre.is_empty() && !beta) || (release.prerelease && !beta) { return None; }
        // Construct the page ourselves, so API content cannot redirect to another host.
        let url = Url::parse(&format!("{RELEASES}/tag/{}", release.tag_name)).ok()?;
        Some(Catalog { version, url, notes: release.body,
            platform_available: release.assets.iter().any(|asset| manual_asset(&asset.name, platform)) })
    }).collect()
}
pub async fn discover(client: &reqwest::Client) -> Result<Vec<Catalog>, &'static str> {
    let platform = if cfg!(target_os = "macos") { "macos" } else if cfg!(windows) { "windows" } else { "unsupported" };
    let mut found = Vec::new();
    for page in 1..=MAX_PAGES {
        let mut response = client.get(format!("{API}?per_page={PAGE_SIZE}&page={page}"))
            .header("Accept", "application/vnd.github+json").send().await
            .map_err(|_| "update_check_failed")?.error_for_status().map_err(|_| "update_check_failed")?;
        if response.content_length().is_some_and(|n| n > MAX_INDEX_BYTES as u64) { return Err("update_check_failed"); }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| "update_check_failed")? {
            if bytes.len().saturating_add(chunk.len()) > MAX_INDEX_BYTES { return Err("update_check_failed"); }
            bytes.extend_from_slice(&chunk);
        }
        let releases: Vec<Release> = serde_json::from_slice(&bytes).map_err(|_| "update_check_failed")?;
        let complete = releases.len() < PAGE_SIZE;
        found.extend(catalogs(releases, platform));
        if complete {
            found.sort_by(|a,b| b.version.cmp_precedence(&a.version));
            return Ok(found);
        }
    }
    Err("update_check_failed")
}
#[cfg(test)]
mod tests {
    use super::*;
    fn release(tag: &str, assets: &[&str]) -> serde_json::Value {
        serde_json::json!({"tag_name":tag,"draft":false,"prerelease":tag.contains("beta"),
            "published_at":"2026-01-01T00:00:00Z","body":"Synthetic release notes",
            "assets":assets.iter().map(|name|serde_json::json!({"name":name})).collect::<Vec<_>>()})
    }
    #[test]
    fn filters_releases_and_matches_manual_assets() {
        let mut draft = release("v9.0.0", &["Ripple-9.0.0.dmg"]); draft["draft"] = true.into();
        let values = vec![draft, release("v0.2.0-beta.2", &["Ripple-0.2.0-beta.2-macOS.zip"]),
            release("v0.2.0", &["Ripple-0.2.0.app.tar.gz"]), release("v1.0.0-rc.1", &["Ripple-1.0.0.exe"]),
            release("v0.3.0", &["Ripple-0.3.0-Windows.exe"]), release("v1.0.0%2felse", &["Ripple-1.0.0.dmg"])];
        let parsed: Vec<Release> = serde_json::from_value(serde_json::Value::Array(values)).unwrap();
        let mac = catalogs(parsed,"macos");
        assert_eq!(mac.len(),3);
        assert!(mac[0].platform_available);
        assert!(!mac[1].platform_available);
        assert!(!mac[2].platform_available);
        assert_eq!(mac[0].notes.as_deref(),Some("Synthetic release notes"));
        assert_eq!(mac[0].url.as_str(),"https://github.com/CoozeeWang/ripple-transcript-editor/releases/tag/v0.2.0-beta.2");
    }
    #[test]
    fn assets_are_platform_specific() {
        assert!(manual_asset("Ripple-0.2.0-macOS.dmg","macos"));
        assert!(!manual_asset("Ripple-0.2.0.app.tar.gz","macos"));
        assert!(!manual_asset("Ripple-0.2.0-Windows.zip","macos"));
        assert!(manual_asset("Ripple-0.2.0-Windows.exe","windows"));
        assert!(!manual_asset("other.exe","windows"));
    }
}
