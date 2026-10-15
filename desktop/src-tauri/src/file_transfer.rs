//! Bounded binary IPC, retaining same-directory temporary files until commit.
use std::borrow::Cow;
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{http::HeaderMap, ipc::InvokeBody};

const MAX_CHUNK: usize = 4 * 1024 * 1024;
static SEQUENCE: AtomicU64 = AtomicU64::new(0);
struct WriteSession { target: PathBuf, temporary: tempfile::NamedTempFile }
#[derive(Default)]
pub struct Writes(Mutex<HashMap<u64, WriteSession>>);

pub fn read_chunk(path: &Path, offset: u64, length: usize) -> Result<Vec<u8>, String> {
    if length > MAX_CHUNK { return Err("读取块过大".into()); }
    let mut file = File::open(path).map_err(super::io_error)?;
    file.seek(SeekFrom::Start(offset)).map_err(super::io_error)?;
    let mut bytes = Vec::with_capacity(length);
    file.take(length as u64).read_to_end(&mut bytes).map_err(super::io_error)?;
    Ok(bytes)
}

impl Writes {
    // The caller must validate the selected-root grant before resolving target.
    pub fn begin(&self, target: PathBuf) -> Result<u64, String> {
        if target.exists() && !target.is_file() { return Err("目标不是文件".into()); }
        let parent = target.parent().ok_or("目标缺少父文件夹")?;
        let temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
        let id = SEQUENCE.fetch_add(1, Ordering::Relaxed);
        self.0.lock().map_err(|_| "写入锁不可用")?.insert(id, WriteSession { target, temporary });
        Ok(id)
    }
    pub fn append_request(&self, body: &InvokeBody, headers: &HeaderMap) -> Result<(), String> {
        let id = headers.get("x-ripple-write-id").and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok()).ok_or("写入标识无效")?;
        let bytes: Cow<'_, [u8]> = match body {
            InvokeBody::Raw(bytes) => {
                if bytes.len() > MAX_CHUNK { return Err("写入块过大".into()); }
                Cow::Borrowed(bytes)
            }
            // Tauri's postMessage fallback serializes the same raw payload as
            // an array. Validate it strictly, retaining the same size bound.
            InvokeBody::Json(serde_json::Value::Array(values)) => {
                if values.len() > MAX_CHUNK { return Err("写入块过大".into()); }
                let bytes = values.iter().map(|v| v.as_u64().and_then(|n| u8::try_from(n).ok())
                    .ok_or("写入块无效")).collect::<Result<Vec<u8>, _>>()?;
                Cow::Owned(bytes)
            }
            _ => return Err("写入块必须是二进制".into()),
        };
        let mut writes = self.0.lock().map_err(|_| "写入锁不可用")?;
        let session = writes.get_mut(&id).ok_or("写入已结束")?;
        session.temporary.write_all(&bytes).map_err(|e| e.to_string())
    }
    pub fn commit(&self, id: u64) -> Result<(), String> {
        let session = self.0.lock().map_err(|_| "写入锁不可用")?.remove(&id).ok_or("写入已结束")?;
        session.temporary.as_file().sync_all().map_err(|e| e.to_string())?;
        session.temporary.persist(&session.target).map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn abort(&self, id: u64) -> Result<(), String> {
        self.0.lock().map_err(|_| "写入锁不可用")?.remove(&id);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn headers(id: u64) -> HeaderMap {
        let mut headers = HeaderMap::new(); headers.insert("x-ripple-write-id", id.to_string().parse().unwrap()); headers
    }
    #[test]
    fn binary_roundtrip_is_exact_and_replaces_only_at_commit() {
        let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("synthetic.json");
        std::fs::write(&path, b"old synthetic data").unwrap(); let writes = Writes::default();
        let id = writes.begin(path.clone()).unwrap();
        let bytes: Vec<u8> = (0..MAX_CHUNK+37).map(|i| (i % 256) as u8).collect();
        for chunk in bytes.chunks(1024*1024) { writes.append_request(&InvokeBody::Raw(chunk.to_vec()), &headers(id)).unwrap(); }
        assert_eq!(std::fs::read(&path).unwrap(), b"old synthetic data");
        writes.commit(id).unwrap(); assert_eq!(std::fs::read(&path).unwrap(), bytes);
        assert_eq!(read_chunk(&path, 1024*1024, 999).unwrap(), bytes[1024*1024..1024*1024+999]);
        assert!(writes.commit(id).is_err());
    }
    #[test]
    fn rejected_request_and_abort_leave_original_and_remove_temporary() {
        let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("synthetic.json");
        std::fs::write(&path, b"original").unwrap(); let writes = Writes::default(); let id = writes.begin(path.clone()).unwrap();
        assert!(writes.append_request(&InvokeBody::Raw(vec![1]), &HeaderMap::new()).is_err());
        assert!(writes.append_request(&InvokeBody::Json(serde_json::json!({"bytes":[1,2]})), &headers(id)).is_err());
        assert!(writes.append_request(&InvokeBody::Raw(vec![0; MAX_CHUNK+1]), &headers(id)).is_err());
        assert!(writes.append_request(&InvokeBody::Raw(vec![1]), &headers(id+1)).is_err());
        writes.append_request(&InvokeBody::Raw(vec![1,2]), &headers(id)).unwrap();
        writes.abort(id).unwrap(); writes.abort(id).unwrap();
        assert!(writes.commit(id).is_err()); assert_eq!(std::fs::read(&path).unwrap(), b"original");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
    #[test]
    fn postmessage_fallback_accepts_only_bounded_valid_bytes() {
        let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("synthetic.bin");
        let writes = Writes::default(); let id = writes.begin(path.clone()).unwrap();
        for invalid in [serde_json::json!([256]), serde_json::json!([-1]), serde_json::json!([1.5]), serde_json::json!(["1"])] {
            assert!(writes.append_request(&InvokeBody::Json(invalid), &headers(id)).is_err());
        }
        let oversized = serde_json::Value::Array(vec![serde_json::json!(0); MAX_CHUNK+1]);
        assert!(writes.append_request(&InvokeBody::Json(oversized), &headers(id)).is_err());
        writes.append_request(&InvokeBody::Json(serde_json::json!([0,128,255])), &headers(id)).unwrap();
        writes.commit(id).unwrap(); assert_eq!(std::fs::read(path).unwrap(), vec![0,128,255]);
    }
    #[test]
    fn failed_commit_keeps_destination_and_cleans_temporary() {
        let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("synthetic.json");
        let writes = Writes::default(); let id = writes.begin(path.clone()).unwrap();
        writes.append_request(&InvokeBody::Raw(vec![1]), &headers(id)).unwrap();
        std::fs::create_dir(&path).unwrap(); assert!(writes.commit(id).is_err());
        assert!(path.is_dir()); assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
    #[test]
    fn read_is_bounded_and_empty_files_can_commit() {
        let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("synthetic.json");
        let writes = Writes::default(); let id = writes.begin(path.clone()).unwrap(); writes.commit(id).unwrap();
        assert_eq!(read_chunk(&path, 0, 10).unwrap(), Vec::<u8>::new());
        assert!(read_chunk(&path, 0, MAX_CHUNK+1).is_err());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}
