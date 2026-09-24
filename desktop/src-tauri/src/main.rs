use serde::Serialize;
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

const PORT: u16 = 18701;
static WRITE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct Backend(Mutex<Option<Child>>);
struct WriteSession { target: PathBuf, temporary: tempfile::NamedTempFile }
struct Writes(Mutex<HashMap<u64, WriteSession>>);
#[derive(Clone)]
struct Grant { root: String, path: PathBuf, base_parts: Vec<String>, directory: bool, writable: bool }
struct Grants(Mutex<Vec<Grant>>);

#[derive(Serialize)]
struct NativeEntry { name: String, kind: &'static str }
#[derive(Serialize)]
struct SelectedPath { root: String, kind: &'static str }

fn grant_path(state: &Grants, root: &str, parts: &[String], write: bool) -> Result<PathBuf, String> {
    let grants = state.0.lock().map_err(|_| "文件授权不可用")?;
    let grant = grants.iter().filter(|g| g.root == root && parts.starts_with(&g.base_parts))
        .max_by_key(|g| g.base_parts.len()).ok_or("请重新选择这个文件或文件夹")?;
    if write && !grant.writable { return Err("此文件只有读取权限".into()); }
    let remaining = &parts[grant.base_parts.len()..];
    if !grant.directory && !remaining.is_empty() { return Err("不能访问所选文件之外的内容".into()); }
    let mut path = grant.path.clone();
    for part in remaining {
        if part.is_empty() || part == "." || part == ".." || part.contains('/') || part.contains('\\') || part.contains('\0') {
            return Err("文件名含无效路径字符".into());
        }
        path.push(part);
        if path.exists() {
            let real = path.canonicalize().map_err(|e| e.to_string())?;
            if !real.starts_with(&grant.path) { return Err("文件超出已选择的文件夹".into()); }
        }
    }
    Ok(path)
}

fn add_grant(state: &Grants, path: PathBuf, directory: bool, writable: bool) -> Result<SelectedPath, String> {
    let path = path.canonicalize().map_err(|e| e.to_string())?;
    let root = path.display().to_string();
    let mut grants = state.0.lock().map_err(|_| "文件授权不可用")?;
    if !grants.iter().any(|g| g.root == root && g.base_parts.is_empty()) {
        grants.push(Grant { root: root.clone(), path, base_parts: Vec::new(), directory, writable });
    }
    Ok(SelectedPath { root, kind: if directory { "directory" } else { "file" } })
}

#[tauri::command]
async fn pick_directory(app: tauri::AppHandle, state: tauri::State<'_, Grants>) -> Result<SelectedPath, String> {
    let selected = tauri::async_runtime::spawn_blocking(move || app.dialog().file().blocking_pick_folder())
        .await.map_err(|e| e.to_string())?.ok_or("已取消选择")?;
    add_grant(&state, selected.into_path().map_err(|e| e.to_string())?, true, true)
}

#[tauri::command]
async fn pick_files(app: tauri::AppHandle, state: tauri::State<'_, Grants>, multiple: bool) -> Result<Vec<SelectedPath>, String> {
    let selected = tauri::async_runtime::spawn_blocking(move || {
        if multiple { app.dialog().file().blocking_pick_files().unwrap_or_default() }
        else { app.dialog().file().blocking_pick_file().into_iter().collect() }
    }).await.map_err(|e| e.to_string())?;
    if selected.is_empty() { return Err("已取消选择".into()); }
    selected.into_iter().map(|file| add_grant(&state, file.into_path().map_err(|e| e.to_string())?, false, false)).collect()
}

#[tauri::command]
fn fs_permission(state: tauri::State<'_, Grants>, root: String, parts: Vec<String>) -> bool {
    state.0.lock().map(|grants| grants.iter().any(|g| g.root == root && parts.starts_with(&g.base_parts))).unwrap_or(false)
}

#[tauri::command]
async fn fs_reauthorize(app: tauri::AppHandle, state: tauri::State<'_, Grants>, root: String, parts: Vec<String>, kind: String) -> Result<(), String> {
    let mut expected = PathBuf::from(&root);
    for part in &parts {
        if part.is_empty() || part == "." || part == ".." || part.contains('/') || part.contains('\\') { return Err("无效路径".into()); }
        expected.push(part);
    }
    let is_directory = kind == "directory";
    if !is_directory && kind != "file" { return Err("无效文件类型".into()); }
    let selected = tauri::async_runtime::spawn_blocking(move || {
        if is_directory { app.dialog().file().blocking_pick_folder() }
        else { app.dialog().file().blocking_pick_file() }
    }).await.map_err(|e| e.to_string())?.ok_or("已取消选择")?;
    let selected = selected.into_path().map_err(|e| e.to_string())?.canonicalize().map_err(|e| e.to_string())?;
    if expected.canonicalize().map_err(|e| e.to_string())? != selected { return Err("选择的不是原文件或原文件夹".into()); }
    let mut grants = state.0.lock().map_err(|_| "文件授权不可用")?;
    if !grants.iter().any(|g| g.root == root && g.base_parts == parts) {
        grants.push(Grant { root, path: selected, base_parts: parts, directory: is_directory, writable: is_directory });
    }
    Ok(())
}

#[tauri::command]
fn fs_stat(state: tauri::State<'_, Grants>, root: String, parts: Vec<String>) -> Result<Option<NativeEntry>, String> {
    let path = grant_path(&state, &root, &parts, false)?;
    if !path.exists() { return Ok(None); }
    let kind = if path.is_dir() { "directory" } else if path.is_file() { "file" } else { return Err("不是普通文件或文件夹".into()) };
    Ok(Some(NativeEntry { name: path.file_name().unwrap_or_default().to_string_lossy().to_string(), kind }))
}

#[tauri::command]
fn fs_mkdir(state: tauri::State<'_, Grants>, root: String, parts: Vec<String>) -> Result<(), String> {
    let path = grant_path(&state, &root, &parts, true)?;
    fs::create_dir(&path).or_else(|e| if path.is_dir() { Ok(()) } else { Err(e) }).map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_create_file(state: tauri::State<'_, Grants>, root: String, parts: Vec<String>) -> Result<(), String> {
    let path = grant_path(&state, &root, &parts, true)?;
    if path.exists() { return if path.is_file() { Ok(()) } else { Err("目标不是文件".into()) }; }
    OpenOptions::new().write(true).create_new(true).open(path).map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_read(state: tauri::State<'_, Grants>, root: String, parts: Vec<String>) -> Result<Vec<u8>, String> {
    fs::read(grant_path(&state, &root, &parts, false)?).map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_size(state: tauri::State<'_, Grants>, root: String, parts: Vec<String>) -> Result<u64, String> {
    let path = grant_path(&state, &root, &parts, false)?;
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() { return Err("不是普通文件".into()); }
    Ok(metadata.len())
}

#[tauri::command]
fn fs_read_chunk(state: tauri::State<'_, Grants>, root: String, parts: Vec<String>, offset: u64, length: usize) -> Result<Vec<u8>, String> {
    if length > 4 * 1024 * 1024 { return Err("读取块过大".into()); }
    let path = grant_path(&state, &root, &parts, false)?;
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
    let mut bytes = vec![0; length];
    let read = file.read(&mut bytes).map_err(|e| e.to_string())?;
    bytes.truncate(read);
    Ok(bytes)
}

#[tauri::command]
fn fs_begin_write(grants: tauri::State<'_, Grants>, writes: tauri::State<'_, Writes>, root: String, parts: Vec<String>) -> Result<u64, String> {
    let target = grant_path(&grants, &root, &parts, true)?;
    if !target.is_file() { return Err("目标文件不存在".into()); }
    let parent = target.parent().ok_or("目标缺少父文件夹")?;
    let temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    let id = WRITE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    writes.0.lock().map_err(|_| "写入锁不可用")?.insert(id, WriteSession { target, temporary });
    Ok(id)
}

#[tauri::command]
fn fs_write_chunk(writes: tauri::State<'_, Writes>, id: u64, bytes: Vec<u8>) -> Result<(), String> {
    if bytes.len() > 4 * 1024 * 1024 { return Err("写入块过大".into()); }
    let mut writes = writes.0.lock().map_err(|_| "写入锁不可用")?;
    let session = writes.get_mut(&id).ok_or("写入已结束")?;
    session.temporary.write_all(&bytes).map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_commit_write(writes: tauri::State<'_, Writes>, id: u64) -> Result<(), String> {
    let session = writes.0.lock().map_err(|_| "写入锁不可用")?.remove(&id).ok_or("写入已结束")?;
    session.temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    session.temporary.persist(&session.target).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn fs_abort_write(writes: tauri::State<'_, Writes>, id: u64) -> Result<(), String> {
    writes.0.lock().map_err(|_| "写入锁不可用")?.remove(&id);
    Ok(())
}

#[tauri::command]
fn fs_write(state: tauri::State<'_, Grants>, root: String, parts: Vec<String>, bytes: Vec<u8>) -> Result<(), String> {
    let path = grant_path(&state, &root, &parts, true)?;
    if !path.is_file() { return Err("目标文件不存在".into()); }
    let temporary = path.with_file_name(format!(".ripple-write-{}-{}", std::process::id(), WRITE_SEQUENCE.fetch_add(1, Ordering::Relaxed)));
    let mut file = OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|e| e.to_string())?;
    if let Err(error) = file.write_all(&bytes).and_then(|_| file.sync_all()).and_then(|_| fs::rename(&temporary, &path)) {
        let _ = fs::remove_file(temporary);
        return Err(format!("写入失败: {error}"));
    }
    Ok(())
}

#[tauri::command]
fn fs_list(state: tauri::State<'_, Grants>, root: String, parts: Vec<String>) -> Result<Vec<NativeEntry>, String> {
    let path = grant_path(&state, &root, &parts, false)?;
    let mut result = Vec::new();
    for item in fs::read_dir(path).map_err(|e| e.to_string())? {
        let item = item.map_err(|e| e.to_string())?;
        let kind = if item.file_type().map_err(|e| e.to_string())?.is_dir() { "directory" }
            else if item.file_type().map_err(|e| e.to_string())?.is_file() { "file" } else { continue };
        result.push(NativeEntry { name: item.file_name().to_string_lossy().to_string(), kind });
    }
    Ok(result)
}

#[tauri::command]
fn fs_remove(state: tauri::State<'_, Grants>, root: String, parts: Vec<String>, recursive: bool) -> Result<(), String> {
    if parts.is_empty() { return Err("不能删除已选择的文件夹".into()); }
    let path = grant_path(&state, &root, &parts, true)?;
    if path.is_dir() {
        if recursive { fs::remove_dir_all(path) } else { fs::remove_dir(path) }.map_err(|e| e.to_string())
    } else { fs::remove_file(path).map_err(|e| e.to_string()) }
}

fn health_ok() -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], PORT));
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(300)) else { return false };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    if stream.write_all(b"GET /api/health HTTP/1.0\r\nHost: localhost\r\n\r\n").is_err() { return false; }
    let mut response = String::new();
    stream.read_to_string(&mut response).is_ok() && response.starts_with("HTTP/1.1 200")
}

#[tauri::command]
fn backend_ready() -> bool { health_ok() }

fn start_backend(app: &tauri::AppHandle) -> Result<Child, String> {
    if TcpStream::connect(("127.0.0.1", PORT)).is_ok() { return Err(format!("端口 {PORT} 已被占用；请先关闭占用它的程序")); }
    let stage = app.path().resource_dir().map_err(|e| e.to_string())?.join("backend");
    let python = stage.join("python/bin/python3.12");
    if !python.is_file() { return Err("App 缺少随附后台".into()); }
    let data = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&data).map_err(|e| e.to_string())?;
    let log = OpenOptions::new().create(true).append(true).open(data.join("backend.log")).map_err(|e| e.to_string())?;
    let err = log.try_clone().map_err(|e| e.to_string())?;
    let python_path = std::env::join_paths([stage.join("backend"), stage.join("site-packages")]).map_err(|e| e.to_string())?;
    // Finder launches apps with a smaller PATH than an interactive shell.
    let mut executable_paths = vec![PathBuf::from("/opt/homebrew/bin"), PathBuf::from("/usr/local/bin")];
    executable_paths.extend(std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()));
    let executable_path = std::env::join_paths(executable_paths).map_err(|e| e.to_string())?;
    Command::new(python).current_dir(&stage).env("PYTHONPATH", python_path)
        .env("PATH", executable_path)
        .env("RIPPLE_DATA_DIR", &data).env("PYTHONDONTWRITEBYTECODE", "1")
        .args(["-m", "app.desktop_runner", "--host", "127.0.0.1", "--port", &PORT.to_string()])
        .stdout(Stdio::from(log)).stderr(Stdio::from(err)).spawn().map_err(|e| e.to_string())
}

fn stop_backend(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<Backend>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(mut child) = guard.take() { let _ = child.kill(); let _ = child.wait(); }
        }
    }
}

fn main() {
    tauri::Builder::default().plugin(tauri_plugin_dialog::init())
        .manage(Grants(Mutex::new(Vec::new())))
        .manage(Writes(Mutex::new(HashMap::new())))
        .setup(|app| {
            let child = start_backend(app.handle()).map_err(std::io::Error::other)?;
            app.manage(Backend(Mutex::new(Some(child))));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![pick_directory, pick_files, fs_permission, fs_reauthorize, fs_stat,
            fs_mkdir, fs_create_file, fs_read, fs_size, fs_read_chunk, fs_write,
            fs_begin_write, fs_write_chunk, fs_commit_write, fs_abort_write,
            fs_list, fs_remove, backend_ready])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed) {
                stop_backend(window.app_handle());
                window.app_handle().exit(0);
            }
        })
        .build(tauri::generate_context!()).expect("Ripple failed to start")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit) {
                stop_backend(app);
            }
        });
}
