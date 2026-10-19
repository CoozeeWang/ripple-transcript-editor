//! Published stable and Beta releases. Internal builds are never compared as versions.
use serde::Deserialize;
use url::Url;

const API: &str = "https://api.github.com/repos/CoozeeWang/ripple-transcript-editor/releases";
const DOWNLOADS: &str = "https://github.com/CoozeeWang/ripple-transcript-editor/releases/download/";
const PAGE_SIZE: usize = 100;
const MAX_PAGES: usize = 10;
const MAX_INDEX_BYTES: usize = 2 * 1024 * 1024;

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    published_at: Option<String>,
    assets: Vec<Asset>,
}
#[derive(Deserialize)]
struct Asset { name: String, browser_download_url: String }
#[derive(Debug)]
pub struct Catalog { pub version: semver::Version, pub url: Url }

pub fn client(timeout: std::time::Duration) -> Result<reqwest::Client, &'static str> {
    // Use the same ring provider as Tauri's updater, including before its first check.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    reqwest::Client::builder().user_agent("Ripple-Updater").timeout(timeout)
        .build().map_err(|_| "update_check_failed")
}

fn catalogs(releases: Vec<Release>) -> Vec<Catalog> {
    releases.into_iter().filter_map(|release| {
        if release.draft || release.published_at.as_deref().is_none_or(str::is_empty) { return None; }
        let version = semver::Version::parse(release.tag_name.strip_prefix('v').unwrap_or(&release.tag_name)).ok()?;
        let beta = version.pre.as_str().strip_prefix("beta.")
            .is_some_and(|number| number.parse::<u64>().is_ok_and(|n| n > 0));
        if (!version.pre.is_empty() && !beta) || (release.prerelease && !beta) { return None; }
        let expected = Url::parse(&format!("{DOWNLOADS}{}/latest.json", release.tag_name)).ok()?;
        release.assets.iter().any(|asset| asset.name == "latest.json" && Url::parse(&asset.browser_download_url).ok().as_ref() == Some(&expected))
            .then_some(Catalog { version, url: expected })
    }).collect()
}
fn sort_catalogs(found: &mut [Catalog]) {
    found.sort_by(|a,b| b.version.cmp_precedence(&a.version).then_with(||a.url.as_str().cmp(b.url.as_str())));
}

pub async fn discover(client: &reqwest::Client) -> Result<Vec<Catalog>, &'static str> {
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
        found.extend(catalogs(releases));
        if complete {
            sort_catalogs(&mut found);
            return Ok(found);
        }
    }
    // A truncated listing cannot prove that there is no newer version.
    Err("update_check_failed")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn http_client_initializes_tls_without_a_prior_plugin_check() {
        client(std::time::Duration::from_secs(20)).unwrap();
        assert!(rustls::crypto::CryptoProvider::get_default().is_some());
    }
    fn release(tag: &str, prerelease: bool) -> serde_json::Value {
        serde_json::json!({"tag_name":tag,"draft":false,"prerelease":prerelease,"published_at":"2026-01-01T00:00:00Z",
            "assets":[{"name":"latest.json","browser_download_url":format!("{DOWNLOADS}{tag}/latest.json")}]})
    }
    fn parse(values: Vec<serde_json::Value>) -> Vec<Catalog> { catalogs(serde_json::from_value(serde_json::Value::Array(values)).unwrap()) }
    #[test]
    fn published_beta_and_stable_are_included_but_not_drafts_or_other_prereleases() {
        let mut draft=release("v9.0.0",false);draft["draft"]=true.into();
        let mut unpublished=release("v8.0.0",false);unpublished["published_at"]=serde_json::Value::Null;
        let found=parse(vec![release("v0.2.0-beta.2",true),release("v0.2.0",false),draft,unpublished,release("v1.0.0-rc.1",true),release("b76",false)]);
        assert_eq!(found.iter().map(|c|c.version.to_string()).collect::<Vec<_>>(),["0.2.0-beta.2","0.2.0"]);
    }
    #[test]
    fn requires_a_catalog_asset_in_the_same_official_release() {
        let mut missing=release("v1.2.3",false);missing["assets"]=serde_json::json!([]);
        let mut external=release("v1.2.4",false);external["assets"][0]["browser_download_url"]="https://example.invalid/latest.json".into();
        let mut different_tag=release("v1.2.5",false);different_tag["assets"][0]["browser_download_url"]=format!("{DOWNLOADS}v1.2.0/latest.json").into();
        assert!(parse(vec![missing,external,different_tag]).is_empty());
    }
    #[test]
    fn beta_order_uses_semver_and_same_product_build_metadata_has_no_priority() {
        let beta2=semver::Version::parse("0.2.0-beta.2").unwrap();
        let beta10=semver::Version::parse("0.2.0-beta.10").unwrap();
        let stable=semver::Version::parse("0.2.0").unwrap();
        assert!(stable.cmp_precedence(&beta10).is_gt());assert!(beta10.cmp_precedence(&beta2).is_gt());
        assert!(semver::Version::parse("0.2.0-beta.1+76").unwrap().cmp_precedence(&semver::Version::parse("0.2.0-beta.1+75").unwrap()).is_eq());
        let mut found=parse(vec![release("v0.2.0-beta.2",true),release("v0.2.0",false),release("v0.2.0-beta.10",true)]);
        sort_catalogs(&mut found);
        assert_eq!(found.iter().map(|c|c.version.to_string()).collect::<Vec<_>>(),["0.2.0","0.2.0-beta.10","0.2.0-beta.2"]);
    }
    #[tokio::test]
    #[ignore = "read-only live GitHub smoke; not an offline unit test"]
    async fn queries_published_release_index() {
        let client=client(std::time::Duration::from_secs(20)).unwrap();
        discover(&client).await.expect("official public Release index is readable");
    }
}
