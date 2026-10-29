use serde::Deserialize;
#[derive(Deserialize)]
struct Config { production: Channel, development: Channel }
#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct Channel { #[serde(rename="bundleId")] pub bundle_id:String, pub scheme:String }
pub fn channel_for(identifier:&str, debug:bool) -> Option<Channel> {
    let config:Config=serde_json::from_str(include_str!("../../segment-link-config.json")).expect("valid segment channel configuration");
    let channel=if debug {config.development} else {config.production};
    if channel.bundle_id==identifier {Some(channel)} else {None}
}
pub fn app_channel(app:&tauri::AppHandle)->Option<Channel> {
    #[cfg(feature = "segment-transfer-test")]
    {
        if !cfg!(debug_assertions) && app.config().identifier == "studio.ripple.app.segmentcheck" {
            return Some(Channel { bundle_id: app.config().identifier.clone(), scheme: "ripple-transcript".into() });
        }
        return None;
    }
    #[cfg(not(feature = "segment-transfer-test"))]
    channel_for(&app.config().identifier,cfg!(debug_assertions))
}
pub fn accepts(scheme:&str,raw:&str)->bool {
    if raw.len()>2048 || !(raw.starts_with(&format!("{scheme}://open/v2?")) || raw.starts_with(&format!("{scheme}://open/v1?"))) {return false;}
    let Ok(url)=url::Url::parse(raw) else{return false;};
    if url.scheme()!=scheme || url.host_str()!=Some("open") || !url.username().is_empty() || url.password().is_some() || url.port().is_some() || url.fragment().is_some() {return false;}
    // The UI explicitly explains that old v1 links need to be copied again.
    if url.path()=="/v1" {return true;}
    if url.path()!="/v2" {return false;}
    let mut pairs=url.query_pairs().map(|(k,v)|(k.into_owned(),v.into_owned())).collect::<Vec<_>>();pairs.sort();
    let keys=["identity","model","project","recording","segment","version"];
    if pairs.len()!=keys.len() {return false;}
    for ((key,value),expected) in pairs.iter().zip(keys) {
        if key!=expected || value.is_empty() || value.len()>160 || !value.bytes().all(|c|c.is_ascii_alphanumeric() || c==b'-' || c==b'_') {return false;}
        if key=="identity" && !uuid(value) {return false;}
    }
    true
}
fn uuid(value:&str)->bool {
    value.len()==36 && value.bytes().enumerate().all(|(i,c)|if [8,13,18,23].contains(&i) {c==b'-'} else {c.is_ascii_digit() || (b'a'..=b'f').contains(&c)})
}
#[cfg(test)] mod tests {
 use super::*;
 const QUERY:&str="project=p&recording=r&model=m1&version=e1&segment=s&identity=11111111-1111-4111-8111-111111111111";
 #[test] fn identities_and_build_channels_cannot_cross() {
  assert_eq!(channel_for("studio.ripple.app",false).unwrap().scheme,"ripple-transcript");
  assert_eq!(channel_for("studio.ripple.app.segmentdev",true).unwrap().scheme,"ripple-segment-dev");
  assert!(channel_for("studio.ripple.app",true).is_none());assert!(channel_for("studio.ripple.app.segmentdev",false).is_none());
  assert!(channel_for("unknown",false).is_none());
 }
 #[test] fn production_and_dev_urls_are_strict_and_separate() {
  let good=format!("ripple-transcript://open/v2?{QUERY}");assert!(accepts("ripple-transcript",&good));assert!(!accepts("ripple-segment-dev",&good));
  for suffix in ["#fragment","&project=again","&path=/private"] {assert!(!accepts("ripple-transcript",&format!("{good}{suffix}")));}
  for bad in ["ripple-transcript://user@open/v2?x", "ripple-transcript://open/../v2?x","file:///private","ripple-transcript://open/v3?x"] {assert!(!accepts("ripple-transcript",bad));}
  assert!(!accepts("ripple-transcript",&good.replace("project=p","project=..%2Fprivate")));
  assert!(!accepts("ripple-transcript",&good.replace("11111111-1111-4111-8111-111111111111","------------------------------------")));
  assert!(accepts("ripple-transcript","ripple-transcript://open/v1?project=p"));
 }
}
