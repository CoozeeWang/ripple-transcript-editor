//! Verify media without serializing its contents through the JavaScript bridge.
use sha2::{Digest, Sha256};
use std::{fs::File, io::Read, path::Path};

pub fn fingerprint(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(crate::grants::io_error)?;
    let mut final_hash = Sha256::new();
    let mut size = 0usize;
    let mut chunk = vec![0; 2 * 1024 * 1024];
    loop {
        let mut length = 0;
        while length < chunk.len() {
            let count = file.read(&mut chunk[length..]).map_err(crate::grants::io_error)?;
            if count == 0 { break; }
            length += count;
        }
        if length == 0 { break; }
        size += length;
        final_hash.update(Sha256::digest(&chunk[..length]));
    }
    Ok(format!("{}:{:x}", size, final_hash.finalize()))
}
pub fn check(path: &Path, expected: &str) -> Result<(), String> {
    if expected.is_empty() { return File::open(path).map(|_| ()).map_err(crate::grants::io_error); }
    if fingerprint(path)? != expected { return Err("media_changed".into()); }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    #[test]
    fn matches_chunked_browser_hash_and_detects_changes() {
        let mut file=tempfile::NamedTempFile::new().unwrap();
        let bytes=vec![42u8;2*1024*1024+11]; file.write_all(&bytes).unwrap();
        let mut hash=Sha256::new(); for part in bytes.chunks(2*1024*1024) {hash.update(Sha256::digest(part));}
        let expected=format!("{}:{:x}",bytes.len(),hash.finalize());
        assert_eq!(fingerprint(file.path()).unwrap(),expected);
        assert!(check(file.path(),&expected).is_ok()); file.write_all(b"changed").unwrap();
        assert_eq!(check(file.path(),&expected).unwrap_err(),"media_changed");
    }
}
