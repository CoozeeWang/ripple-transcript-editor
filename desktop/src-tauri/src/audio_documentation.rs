//! Official documentation links only; never accepts arbitrary provider URLs.
pub fn allowed(url: &str) -> bool {
    matches!(url,
        "https://cloud.tencent.com/document/product/1093/52097" |
        "https://cloud.tencent.com/document/product/1093/37823" |
        "https://www.xfyun.cn/doc/asr/ifasr_new/API.html" |
        "https://www.xfyun.cn/doc/spark/asr_llm/Ifasr_llm.html" |
        "https://elevenlabs.io/docs/overview/capabilities/speech-to-text")
}
#[cfg(test)]
mod tests {
    #[test]
    fn permits_exact_official_documents_only() {
        assert!(super::allowed("https://cloud.tencent.com/document/product/1093/52097"));
        for bad in ["file:///synthetic", "https://cloud.tencent.com.invalid/", "https://cloud.tencent.com/document/product/1093/52097?redirect=other", "https://user@cloud.tencent.com/document/product/1093/52097"] {
            assert!(!super::allowed(bad));
        }
    }
}
