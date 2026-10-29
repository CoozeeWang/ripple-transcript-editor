#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

#[cfg(all(not(debug_assertions), not(feature = "custom-protocol")))]
compile_error!("Daily builds require --features custom-protocol; otherwise Tauri overrides the macOS Dock icon.");

mod segment_clipboard;
mod segment_drag;
mod segment_protocol;
mod file_transfer;
mod project_icon;
mod backend_runtime;
mod tunnel_proxy;
mod tunnel_recovery;
mod native_menu;
mod grants;
mod pdf_print;
mod media;
mod connector_config;
mod install_target;
mod updates;
mod update_window;
mod update_releases;
use grants::{Grant, Grants, io_error};
use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

#[cfg(debug_assertions)]
const PORT: u16 = 18712;
#[cfg(all(not(debug_assertions), not(feature = "segment-transfer-test")))]
const PORT: u16 = 18701;
#[cfg(all(not(debug_assertions), feature = "segment-transfer-test"))]
const PORT: u16 = 18713;
static WRITE_SEQUENCE: AtomicU64 = AtomicU64::new(0);
static TUNNEL_LOG_LOCK: Mutex<()> = Mutex::new(());

#[derive(Default)]
struct SegmentLinks(Mutex<Vec<String>>);
#[tauri::command]
fn segment_link_next(app: tauri::AppHandle) -> Option<String> {
    segment_protocol::app_channel(&app)?;
    let state = app.state::<SegmentLinks>();
    let mut pending = state.0.lock().ok()?;
    if pending.is_empty() { None } else { Some(pending.remove(0)) }
}
fn enqueue_segment_links(app:&tauri::AppHandle, urls:impl IntoIterator<Item=String>) -> bool {
    let Some(channel)=segment_protocol::app_channel(app) else {return false;};
    let state=app.state::<SegmentLinks>();
    let Ok(mut pending)=state.0.lock() else {return false;};
    let mut accepted=false;
    for raw in urls {if pending.len()<16 && segment_protocol::accepts(&channel.scheme,&raw) {pending.push(raw);accepted=true;}}
    accepted
}
fn focus_segment_window(app:&tauri::AppHandle) {if let Some(window)=app.get_webview_window("main") {let _=window.show();let _=window.set_focus();}}
struct DevServices(Mutex<Option<Child>>);
fn start_dev_services(app: &tauri::AppHandle) -> Result<Option<Child>, String> {
    if std::env::var("RIPPLE_DESKTOP_DEV").as_deref() == Ok("1") { return Ok(None); }
    let resource = app.path().resource_dir().map_err(|e| e.to_string())?;
    let config: serde_json::Value = serde_json::from_str(&fs::read_to_string(resource.join("dev-runtime.json")).map_err(|_| "Dev runtime unavailable")?).map_err(|_| "Invalid Dev runtime")?;
    let node = config["node"].as_str().ok_or("Invalid Dev runtime")?;
    let root = PathBuf::from(config["root"].as_str().ok_or("Invalid Dev runtime")?);
    let work = PathBuf::from(config["work"].as_str().ok_or("Invalid Dev runtime")?);
    if !root.is_absolute() || !work.is_absolute() || !PathBuf::from(node).is_absolute() { return Err("Invalid Dev runtime paths".into()); }
    let ready = work.join("services-ready");
    let _ = fs::remove_file(&ready);
    let mut child = Command::new(node).arg(root.join("scripts/desktop-dev.mjs")).arg("--services-only").current_dir(&root).spawn().map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(45);
    loop {
        if child.try_wait().map_err(|e| e.to_string())?.is_some() { return Err("Dev services could not start; check isolated Dev ports".into()); }
        if fs::read_to_string(&ready).ok().as_deref() == Some(child.id().to_string().as_str()) { break; }
        if Instant::now() > deadline {
            let _ = Command::new("/bin/kill").args(["-TERM", &child.id().to_string()]).status();
            let _ = child.wait();
            return Err("Dev services startup timed out".into());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    std::env::set_var("RIPPLE_DESKTOP_DEV", "1");
    std::env::set_var("RIPPLE_DATA_DIR", work.join("data"));
    Ok(Some(child))
}
struct Backend(Mutex<Option<Child>>);
struct ConnectorTunnel(Mutex<TunnelState>);
#[derive(Default)]
struct TunnelState {
    enabled: bool,
    child: Option<Child>,
    recovery: tunnel_recovery::Recovery,
    status: &'static str,
}
impl TunnelState {
    fn stop(&mut self) {
        self.enabled = false;
        if let Some(mut child) = self.child.take() { backend_runtime::stop_tunnel(&mut child); }
        self.recovery = tunnel_recovery::Recovery::default();
        self.status = "off";
    }
}
use file_transfer::Writes;
#[derive(Serialize)]
struct NativeEntry { name: String, kind: &'static str }
#[derive(Serialize)]
struct SelectedPath { root: String, kind: &'static str }

fn grant_path(state: &Grants, root: &str, parts: &[String], write: bool) -> Result<PathBuf, String> {
    let grants = state.entries.lock().map_err(|_| "permission_required")?;
    let grant = grants.iter().filter(|g| g.root == root && parts.starts_with(&g.base_parts))
        .max_by_key(|g| g.base_parts.len()).ok_or("permission_required")?;
    grant.validate()?;
    if write && !grant.writable { return Err("permission_required".into()); }
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
    state.remember(Grant::selected(root.clone(), path, Vec::new(), directory, writable)?)?;
    Ok(SelectedPath { root, kind: if directory { "directory" } else { "file" } })
}

#[tauri::command]
async fn pick_directory(app: tauri::AppHandle, state: tauri::State<'_, Grants>) -> Result<SelectedPath, String> {
    let selected = tauri::async_runtime::spawn_blocking(move || app.dialog().file().blocking_pick_folder())
        .await.map_err(|e| e.to_string())?.ok_or("selection_cancelled")?;
    add_grant(&state, selected.into_path().map_err(|e| e.to_string())?, true, true)
}

#[tauri::command]
async fn pick_files(app: tauri::AppHandle, state: tauri::State<'_, Grants>, multiple: bool) -> Result<Vec<SelectedPath>, String> {
    let selected = tauri::async_runtime::spawn_blocking(move || {
        if multiple { app.dialog().file().blocking_pick_files().unwrap_or_default() }
        else { app.dialog().file().blocking_pick_file().into_iter().collect() }
    }).await.map_err(|e| e.to_string())?;
    if selected.is_empty() { return Err("selection_cancelled".into()); }
    selected.into_iter().map(|file| add_grant(&state, file.into_path().map_err(|e| e.to_string())?, false, false)).collect()
}

#[derive(Serialize)]
struct SavePath { root: String, name: String }

#[tauri::command]
async fn pick_save_file(app: tauri::AppHandle, state: tauri::State<'_, Grants>, filename: String) -> Result<SavePath, String> {
    let selected = tauri::async_runtime::spawn_blocking(move || app.dialog().file().set_file_name(filename).blocking_save_file())
        .await.map_err(|e| e.to_string())?.ok_or("selection_cancelled")?;
    let path = selected.into_path().map_err(|e| e.to_string())?;
    let name = path.file_name().and_then(|n| n.to_str()).ok_or("invalid_save_name")?.to_string();
    let parent = path.parent().ok_or("invalid_save_path")?;
    let grant = add_grant(&state, parent.to_path_buf(), true, true)?;
    Ok(SavePath { root: grant.root, name })
}

#[tauri::command]
fn fs_permission(state: tauri::State<'_, Grants>, root: String, parts: Vec<String>, write: bool) -> bool {
    grant_path(&state, &root, &parts, write).is_ok()
}

#[tauri::command]
fn fs_access_status(state: tauri::State<'_, Grants>, root: String, parts: Vec<String>) -> &'static str {
    match grant_path(&state, &root, &parts, true).and_then(|path| fs::metadata(path).map_err(io_error)) {
        Ok(_) => "granted",
        Err(error) if error == "file_missing" => "missing",
        Err(_) => "permission",
    }
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
    }).await.map_err(|e| e.to_string())?.ok_or("selection_cancelled")?;
    let selected = selected.into_path().map_err(|e| e.to_string())?.canonicalize().map_err(|e| e.to_string())?;
    if expected.canonicalize().map_err(|e| e.to_string())? != selected { return Err("选择的不是原文件或原文件夹".into()); }
    state.remember(Grant::selected(root, selected, parts, is_directory, is_directory)?)?;
    Ok(())
}

#[tauri::command]
async fn project_set_icon(app: tauri::AppHandle, state: tauri::State<'_, Grants>, root: String, parts: Vec<String>) -> Result<bool, String> {
    let path = grant_path(&state, &root, &parts, true)?;
    let (sender, receiver) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || { let _ = sender.send(project_icon::apply(&path)); }).map_err(|_|"project_icon_failed")?;
    tauri::async_runtime::spawn_blocking(move || receiver.recv().map_err(|_|"project_icon_failed")?)
        .await.map_err(|_|"project_icon_failed".to_string())?
}

#[tauri::command]
fn fs_stat(state: tauri::State<'_, Grants>, root: String, parts: Vec<String>) -> Result<Option<NativeEntry>, String> {
    let path = grant_path(&state, &root, &parts, false)?;
    let metadata = match fs::metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let kind = if metadata.is_dir() { "directory" } else if metadata.is_file() { "file" } else { return Err("不是普通文件或文件夹".into()) };
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
    let metadata = fs::metadata(path).map_err(io_error)?;
    if !metadata.is_file() { return Err("不是普通文件".into()); }
    Ok(metadata.len())
}

#[tauri::command]
async fn fs_media_check(state: tauri::State<'_, Grants>, root: String, parts: Vec<String>, expected: String) -> Result<(), String> {
    let path = grant_path(&state, &root, &parts, false)?;
    tauri::async_runtime::spawn_blocking(move || media::check(&path, &expected)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn fs_media_url(app: tauri::AppHandle, state: tauri::State<'_, Grants>, root: String, parts: Vec<String>, expected: String) -> Result<String, String> {
    let path = grant_path(&state, &root, &parts, false)?;
    let checked = path.clone();
    tauri::async_runtime::spawn_blocking(move || media::check(&checked, &expected)).await.map_err(|e| e.to_string())??;
    app.asset_protocol_scope().allow_file(&path).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

#[tauri::command]
fn fs_read_chunk(state: tauri::State<'_, Grants>, root: String, parts: Vec<String>, offset: u64, length: usize) -> Result<tauri::ipc::Response, String> {
    let path = grant_path(&state, &root, &parts, false)?;
    file_transfer::read_chunk(&path, offset, length).map(tauri::ipc::Response::new)
}

#[tauri::command]
fn fs_begin_write(grants: tauri::State<'_, Grants>, writes: tauri::State<'_, Writes>, root: String, parts: Vec<String>) -> Result<u64, String> {
    let target = grant_path(&grants, &root, &parts, true)?;
    writes.begin(target)
}

#[tauri::command]
fn fs_write_chunk(writes: tauri::State<'_, Writes>, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    writes.append_request(request.body(), request.headers())
}

#[tauri::command]
fn fs_commit_write(writes: tauri::State<'_, Writes>, id: u64) -> Result<(), String> {
    writes.commit(id)
}

#[tauri::command]
fn fs_abort_write(writes: tauri::State<'_, Writes>, id: u64) -> Result<(), String> {
    writes.abort(id)
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

// Only debug builds under the managed dev identity may use source-backed services.
fn development(app: &tauri::AppHandle) -> bool {
    cfg!(debug_assertions) && app.config().identifier == "studio.ripple.app.segmentdev"
}

fn app_data(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if development(app) {
        let path = PathBuf::from(std::env::var("RIPPLE_DATA_DIR").map_err(|_| "Use start-dev.command")?);
        if !path.is_absolute() { return Err("Development data path must be absolute".into()); }
        Ok(path)
    } else { app.path().app_local_data_dir().map_err(|e| e.to_string()) }
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

#[tauri::command]
fn connector_window_key(app: tauri::AppHandle) -> Result<String, String> {
    let data = app_data(&app).map_err(|e| e.to_string())?;
    fs::read_to_string(data.join("connector/window.key")).map_err(|_| native_menu::diagnostic(&app, "connectorNotReady"))
}

#[tauri::command]
async fn connector_client_status(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let target = app.path().home_dir().map_err(|_| "home_unavailable")?.join(".workbuddy/mcp.json");
        let output = local_command(&app, "status", "chatgpt")?.arg("--target").arg(target)
            .stdout(Stdio::piped()).output().map_err(|_| "client_unavailable")?;
        if !output.status.success() { return Err("client_unavailable".into()); }
        serde_json::from_slice(&output.stdout).map_err(|_| "client_unavailable".into())
    }).await.map_err(|_| "client_unavailable".to_string())?
}

fn local_command(app: &tauri::AppHandle, action: &str, client: &str) -> Result<Command, String> {
    if !matches!(client, "chatgpt" | "claude" | "workbuddy") { return Err("invalid_client".into()); }
    let resources = app.path().resource_dir().map_err(|_| "resources_unavailable")?.join("backend");
    let python_path = std::env::join_paths([resources.join("backend"), resources.join("site-packages")]).map_err(|_| "resources_unavailable")?;
    let mut command = backend_runtime::background_command(backend_runtime::python(&resources));
    command.env("PYTHONPATH", python_path).env("PYTHONDONTWRITEBYTECODE", "1")
        .args(["-m", "app.connector_local", action, "--client", client, "--resources"]).arg(resources)
        .arg("--data").arg(app_data(&app).map_err(|_| "data_unavailable")?)
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    Ok(command)
}

#[tauri::command]
async fn connector_client_select(app: tauri::AppHandle, client: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if local_command(&app, "select", &client)?.status().map_err(|_| "client_save_failed")?.success() { Ok(()) }
        else { Err("client_save_failed".into()) }
    }).await.map_err(|_| "client_save_failed".to_string())?
}

#[tauri::command]
async fn connector_client_delete(app: tauri::AppHandle, client: String) -> Result<(), String> {
    if !matches!(client.as_str(), "chatgpt" | "claude" | "workbuddy") { return Err("invalid_client".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        // Serialize ChatGPT deletion against startup. Keep other clients and the
        // editor consent lease running. A busy rejection must not stop a tunnel.
        let state = app.state::<ConnectorTunnel>();
        let mut tunnel = if client == "chatgpt" { Some(state.0.lock().map_err(|_| "connector_delete_failed")?) } else { None };
        let key = connector_window_key(app.clone()).map_err(|_| "connector_delete_failed")?;
        connector_config::delete_request(PORT, &key, &client)?;
        if let Some(guard) = tunnel.as_mut() {
            guard.stop();
        }
        Ok(())
    }).await.map_err(|_| "connector_delete_failed".to_string())?
}

#[tauri::command]
async fn connector_client_export(app: tauri::AppHandle, client: String) -> Result<bool, String> {
    if !matches!(client.as_str(), "claude" | "workbuddy") { return Err("invalid_client".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let name = if client == "claude" { "Ripple.mcpb" } else { "Ripple-WorkBuddy.json" };
        let selected = app.dialog().file().set_file_name(name).blocking_save_file();
        let Some(selected) = selected else { return Ok(false); };
        let target = selected.into_path().map_err(|_| "export_failed")?;
        if local_command(&app, "export", &client)?.arg("--target").arg(target).status().map_err(|_| "export_failed")?.success() { Ok(true) }
        else { Err("export_failed".into()) }
    }).await.map_err(|_| "export_failed".to_string())?
}


fn open_install_target(target: &str, application: Option<&str>) -> Result<(), String> {
    install_target::open(target, application)
}

#[tauri::command]
async fn connector_client_reveal(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let directory = app_data(&app).map_err(|_| "data_unavailable")?.join("connector");
        if !directory.join("Ripple.mcpb").is_file() { return Err("export_failed".into()); }
        open_install_target(&directory.to_string_lossy(), None)
    }).await.map_err(|_| "open_install_failed".to_string())?
}

#[tauri::command]
async fn connector_client_add(app: tauri::AppHandle, client: String, language: String) -> Result<String, String> {
    if !matches!(client.as_str(), "chatgpt" | "claude" | "workbuddy") { return Err("invalid_client".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        if client == "chatgpt" {
            open_install_target("https://chatgpt.com/plugins", None)?;
            return Ok("chatgpt".into());
        }
        if client == "claude" {
            let target = app_data(&app).map_err(|_| "data_unavailable")?.join("connector/Ripple.mcpb");
            if !local_command(&app, "export", "claude")?.arg("--target").arg(&target).status().map_err(|_| "export_failed")?.success() { return Err("export_failed".into()); }
            return match open_install_target(&target.to_string_lossy(), Some("Claude")) {
                Ok(()) => Ok("claude".into()),
                Err(error) if error == "open_no_association" => Ok("claude_manual".into()),
                Err(_) => Err("claude_open_failed".into()),
            };
        }
        let text = if language.starts_with("zh") {
            "将 Ripple 添加到 WorkBuddy？会先备份已有配置，再添加连接；其他连接将保留，已有的 Ripple 配置将更新。完成后请在 WorkBuddy 中启用 Ripple，必要时重启 WorkBuddy。"
        } else {
            "Add Ripple to WorkBuddy? Your existing configuration will be backed up first. Other connections will be kept, and any existing Ripple entry will be updated. Then enable Ripple in WorkBuddy. Restart WorkBuddy if needed."
        };
        let (confirm_label, cancel_label) = if language.starts_with("zh") { ("添加", "取消") } else { ("Add", "Cancel") };
        if !app.dialog().message(text).title("Ripple").buttons(tauri_plugin_dialog::MessageDialogButtons::OkCancelCustom(confirm_label.into(), cancel_label.into())).blocking_show() { return Ok("cancelled".into()); }
        let target = app.path().home_dir().map_err(|_| "home_unavailable")?.join(".workbuddy/mcp.json");
        if !local_command(&app, "install-workbuddy", "workbuddy")?.arg("--target").arg(target).status().map_err(|_| "install_failed")?.success() { return Err("install_failed".into()); }
        Ok("workbuddy".into())
    }).await.map_err(|_| "install_failed".to_string())?
}


#[tauri::command]
async fn connector_pick_client(app: tauri::AppHandle) -> Result<String, String> {
    let file = tauri::async_runtime::spawn_blocking(move || app.dialog().file().blocking_pick_file())
        .await.map_err(|_| "client_selection_failed".to_string())?.ok_or("client_selection_cancelled")?;
    Ok(file.into_path().map_err(|_| "invalid_client_path")?.display().to_string())
}

/// Open the fixed setup destination in the user's default browser, outside the WebView.
#[tauri::command]
fn connector_open_platform() -> Result<(), String> {
    let url = "https://platform.openai.com/settings/organization/tunnels";
    open_install_target(url, None).map_err(|_| "open_platform_failed".into())
}

/// Read the host architecture, including an Intel build running under Rosetta.
#[tauri::command]
fn connector_client_platform() -> serde_json::Value {
    let mut arch = std::env::consts::ARCH.to_string();
    #[cfg(target_os = "macos")]
    if arch != "aarch64" {
        arch = match Command::new("/usr/sbin/sysctl").args(["-n", "hw.optional.arm64"]).output() {
            Ok(output) if output.status.success() && output.stdout == b"1\n" => "aarch64".into(),
            Ok(output) if output.status.success() && output.stdout == b"0\n" => "x86_64".into(),
            // Do not recommend Intel when the physical chip could not be identified.
            _ => "unknown".into(),
        };
    }
    #[cfg(target_os = "windows")]
    if std::env::var("PROCESSOR_ARCHITEW6432").or_else(|_| std::env::var("PROCESSOR_ARCHITECTURE"))
        .map(|value| value.eq_ignore_ascii_case("ARM64")).unwrap_or(false) {
        arch = "aarch64".into();
    }
    serde_json::json!({"os": std::env::consts::OS, "arch": arch})
}

fn official_connector_link(url: &str) -> bool {
    if matches!(url, "https://platform.openai.com/settings/organization/tunnels"
        | "https://platform.openai.com/settings/organization/api-keys"
        | "https://github.com/openai/tunnel-client/releases/latest") { return true; }
    let Some(path) = url.strip_prefix("https://github.com/openai/tunnel-client/releases/download/") else { return false; };
    let parts: Vec<_> = path.split('/').collect();
    parts.len() == 2 && parts[0].starts_with('v') && parts[1].starts_with("tunnel-client-v")
        && parts[1].ends_with(".zip")
        && path.bytes().all(|c| c.is_ascii_alphanumeric() || b"/._-+".contains(&c))
}

#[tauri::command]
async fn connector_open_setup_link(url: String) -> Result<(), String> {
    if !official_connector_link(&url) { return Err("invalid_setup_link".into()); }
    tauri::async_runtime::spawn_blocking(move || open_install_target(&url, None))
        .await.map_err(|_| "open_install_failed".to_string())?
}

/// Return only saved non-secret configuration and key presence; never read the key.
#[tauri::command]
fn connector_setup_status(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let data = app_data(&app).map_err(|_| "data_unavailable")?.join("connector");
    let config: serde_json::Value = match fs::read_to_string(data.join("setup.json")) {
        Ok(text) => serde_json::from_str(&text).map_err(|_| "invalid_saved_setup")?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => serde_json::json!({}),
        Err(_) => return Err("setup_unavailable".into()),
    };
    let client = config.get("client_path").and_then(|v| v.as_str()).unwrap_or("");
    let tunnel = config.get("tunnel_id").and_then(|v| v.as_str()).unwrap_or("");
    let has_key = data.join("runtime.key").is_file();
    Ok(serde_json::json!({"client_path": client, "tunnel_id": tunnel, "has_key": has_key,
        "configured": std::path::Path::new(client).is_file() && tunnel.starts_with("tunnel_") && has_key}))
}

#[tauri::command]
fn connector_setup(app: tauri::AppHandle, state: tauri::State<'_, ConnectorTunnel>, client_path: String, tunnel_id: String, runtime_key: String) -> Result<(), String> {
    let _guard = state.0.lock().map_err(|_| "connector_busy")?;
    write_connector_setup(app, client_path, tunnel_id, runtime_key)
}

fn write_connector_setup(app: tauri::AppHandle, client_path: String, tunnel_id: String, runtime_key: String) -> Result<(), String> {
    let resources = app.path().resource_dir().map_err(|_| "resources_unavailable")?.join("backend");
    let data = app_data(&app).map_err(|_| "data_unavailable")?;
    let python_path = std::env::join_paths([resources.join("backend"), resources.join("site-packages")]).map_err(|_| "resources_unavailable")?;
    let mut child = backend_runtime::background_command(backend_runtime::python(&resources))
        .env("PYTHONPATH", python_path).env("PYTHONDONTWRITEBYTECODE", "1")
        .args(["-m", "app.connector_setup"]).arg(&data).arg(&resources)
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|_| "setup_failed")?;
    let payload = serde_json::json!({"client_path":client_path,"tunnel_id":tunnel_id,"runtime_key":runtime_key});
    child.stdin.take().ok_or("setup_failed")?.write_all(payload.to_string().as_bytes()).map_err(|_| "setup_failed")?;
    let output = child.wait_with_output().map_err(|_| "setup_failed")?;
    if output.status.success() { Ok(()) } else { Err(connector_config::setup_error(&output.stdout)) }
}

// Fixed event labels only: never persist raw client output, credentials or MCP payloads.
fn tunnel_event(app: &tauri::AppHandle, event: &str, exit: Option<i32>) {
    let Ok(_lock) = TUNNEL_LOG_LOCK.lock() else { return };
    let Ok(data) = app_data(app) else { return };
    let path = data.join("connector/connection-events.log");
    if fs::metadata(&path).map(|m| m.len() > 65536).unwrap_or(false) {
        let _ = fs::rename(&path, path.with_extension("previous.log"));
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let time = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
        let _ = writeln!(file, "{}", serde_json::json!({"time":time,"event":event,"exit":exit}));
    }
}

fn capture_tunnel_diagnostics(app: tauri::AppHandle, mut stream: impl Read + Send + 'static) {
    std::thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        let mut last: Option<(&'static str, Instant)> = None;
        while let Ok(count) = stream.read(&mut buffer) {
            if count == 0 { break; }
            if let Some(event) = tunnel_recovery::diagnostic(&buffer[..count]) {
                // Bound disk churn during an outage, even if the client logs continuously.
                if last.is_none_or(|(previous, time)| previous != event || time.elapsed() >= Duration::from_secs(60)) {
                    tunnel_event(&app, event, None);
                    last = Some((event, Instant::now()));
                }
            }
        }
    });
}

fn spawn_tunnel(app: &tauri::AppHandle) -> Result<Child, String> {
    let data = app_data(app).map_err(|_| "data_unavailable")?.join("connector");
    let setup = fs::read_to_string(data.join("setup.json")).map_err(|_| "connector_setup_required")?;
    let config: serde_json::Value = serde_json::from_str(&setup).map_err(|_| "connector_setup_required")?;
    let client = config.get("client_path").and_then(|v|v.as_str()).ok_or("connector_setup_required")?;
    let tunnel = config.get("tunnel_id").and_then(|v|v.as_str()).ok_or("connector_setup_required")?;
    // Rebind to this installed bundle, retain the protected key and migrate a
    // selected download into a durable per-user runtime outside the app bundle.
    write_connector_setup(app.clone(), client.to_string(), tunnel.to_string(), String::new())?;
    let updated: serde_json::Value = serde_json::from_str(&fs::read_to_string(data.join("setup.json")).map_err(|_| "connector_setup_required")?).map_err(|_| "connector_setup_required")?;
    let client = updated.get("client_path").and_then(|v|v.as_str()).ok_or("connector_setup_required")?;
    let _ = fs::remove_file(data.join("health.url"));
    let resources = app.path().resource_dir().map_err(|_| "resources_unavailable")?.join("backend");
    let python_path = std::env::join_paths([resources.join("backend"), resources.join("site-packages")]).map_err(|_| "resources_unavailable")?;
    let mut command = backend_runtime::tunnel_command(client);
    tunnel_proxy::apply(&mut command);
    let mut child = command.args(["run", "--config"]).arg(data.join("tunnel.yaml"))
        .env("PYTHONPATH", python_path).env("PYTHONDONTWRITEBYTECODE", "1")
        .env("RIPPLE_DATA_DIR", app_data(app).map_err(|_| "data_unavailable")?)
        .stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|_| "connector_start_failed".to_string())?;
    if let Some(stream) = child.stdout.take() { capture_tunnel_diagnostics(app.clone(), stream); }
    if let Some(stream) = child.stderr.take() { capture_tunnel_diagnostics(app.clone(), stream); }
    Ok(child)
}

fn tunnel_health(app: &tauri::AppHandle) -> bool {
    let Ok(data) = app_data(app) else { return false };
    let Ok(url) = fs::read_to_string(data.join("connector/health.url")) else { return false };
    let Some(raw) = url.trim().strip_prefix("http://127.0.0.1:") else { return false };
    let Ok(port) = raw.trim_end_matches('/').parse::<u16>() else { return false };
    let Ok(mut stream) = TcpStream::connect_timeout(&SocketAddr::from(([127,0,0,1],port)), Duration::from_millis(300)) else { return false };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));
    if stream.write_all(b"GET /readyz HTTP/1.0\r\nHost: localhost\r\n\r\n").is_err() { return false; }
    let mut response = String::new();
    stream.take(16384).read_to_string(&mut response).is_ok() && (response.starts_with("HTTP/1.1 200 ") || response.starts_with("HTTP/1.0 200 "))
}

fn supervise_tunnel(app: &tauri::AppHandle, state: &mut TunnelState) {
    if !state.enabled { return; }
    let now = Instant::now();
    if let Some(child) = state.child.as_mut() {
        match child.try_wait() {
            Ok(Some(exit)) => {
                tunnel_event(app, "process_exited", exit.code());
                state.child = None;
                state.recovery.failed(now);
                state.status = "retrying";
            }
            Ok(None) => {
                let ready = tunnel_health(app);
                if state.recovery.unhealthy_too_long(ready, now) {
                    // Only stop the process owned by this app, never an unrelated client.
                    backend_runtime::stop_tunnel(child);
                    state.child = None;
                    state.recovery.failed(now);
                    state.status = "retrying";
                    tunnel_event(app, "readiness_timeout", None);
                } else {
                    let status = if ready { "ready" } else { "connecting" };
                    if state.status != status { tunnel_event(app, status, None); }
                    state.status = status;
                }
            }
            Err(_) => { state.status = "retrying"; }
        }
    }
    if state.child.is_none() && state.recovery.can_start(now) {
        let configured = app_data(app).map(|d| d.join("connector/setup.json").is_file()).unwrap_or(false);
        if !configured { state.status = "unconfigured"; return; }
        match spawn_tunnel(app) {
            Ok(child) => { state.child = Some(child); state.status = "connecting"; tunnel_event(app, "process_started", None); }
            Err(error) => {
                state.recovery.failed(now);
                state.status = if matches!(error.as_str(), "setup_client_invalid" | "setup_key_invalid" | "setup_tunnel_invalid" | "connector_setup_required") { "setup_required" } else { "retrying" };
                tunnel_event(app, state.status, None);
            }
        }
    }
}

#[tauri::command]
fn connector_tunnel_start(app: tauri::AppHandle, state: tauri::State<'_, ConnectorTunnel>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|_| "connector_busy")?;
    guard.enabled = true;
    supervise_tunnel(&app, &mut guard);
    Ok(())
}

#[tauri::command]
fn connector_tunnel_ready(app: tauri::AppHandle, state: tauri::State<'_, ConnectorTunnel>) -> bool {
    let Ok(mut guard) = state.0.lock() else { return false };
    guard.enabled && guard.child.as_mut().is_some_and(|child| matches!(child.try_wait(), Ok(None))) && tunnel_health(&app)
}

#[tauri::command]
fn connector_tunnel_status(state: tauri::State<'_, ConnectorTunnel>) -> &'static str {
    state.0.lock().map(|guard| if guard.enabled { guard.status } else { "off" }).unwrap_or("retrying")
}

#[tauri::command]
fn connector_local_ready() -> bool { health_ok() }

#[tauri::command]
fn connector_tunnel_stop(state: tauri::State<'_, ConnectorTunnel>) {
    if let Ok(mut guard) = state.0.lock() {
        guard.stop();
    }
}

fn start_backend(app: &tauri::AppHandle) -> Result<Child, String> {
    if TcpStream::connect(("127.0.0.1", PORT)).is_ok() { return Err(format!("端口 {PORT} 已被占用；请先关闭占用它的程序")); }
    let stage = app.path().resource_dir().map_err(|e| e.to_string())?.join("backend");
    let python = backend_runtime::python(&stage);
    if !python.is_file() { return Err(native_menu::diagnostic(app, "runtimeMissing")); }
    let data = app_data(&app).map_err(|e| e.to_string())?;
    fs::create_dir_all(&data).map_err(|e| e.to_string())?;
    let log = OpenOptions::new().create(true).append(true).open(data.join("backend.log")).map_err(|e| e.to_string())?;
    let err = log.try_clone().map_err(|e| e.to_string())?;
    let python_path = std::env::join_paths([stage.join("backend"), stage.join("site-packages")]).map_err(|e| e.to_string())?;
    // Finder launches apps with a smaller PATH than an interactive shell.
    let mut executable_paths = Vec::new();
    #[cfg(target_os = "macos")]
    executable_paths.extend([PathBuf::from("/opt/homebrew/bin"), PathBuf::from("/usr/local/bin")]);
    executable_paths.extend(std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()));
    let executable_path = std::env::join_paths(executable_paths).map_err(|e| e.to_string())?;
    backend_runtime::background_command(python).current_dir(&stage).env("PYTHONPATH", python_path)
        .env("PATH", executable_path)
        .env("RIPPLE_DATA_DIR", &data).env("PYTHONDONTWRITEBYTECODE", "1")
        .args(["-m", "app.desktop_runner", "--host", "127.0.0.1", "--port", &PORT.to_string()])
        .stdout(Stdio::from(log)).stderr(Stdio::from(err)).spawn().map_err(|e| e.to_string())
}

fn stop_backend(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<DevServices>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(mut child) = guard.take() {
                let _ = Command::new("/bin/kill").args(["-TERM", &child.id().to_string()]).status();
                let _ = child.wait();
            }
        }
    }

    if let Some(state) = app.try_state::<ConnectorTunnel>() { connector_tunnel_stop(state); }
    if let Some(state) = app.try_state::<Backend>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(mut child) = guard.take() { let _ = child.kill(); let _ = child.wait(); }
        }
    }
}

fn main() {
    let mut context = tauri::generate_context!();
    if std::env::args().any(|arg| arg == "--ripple-build-info") {
        let info = serde_json::json!({
            "custom_protocol": cfg!(feature = "custom-protocol"),
            "debug": cfg!(debug_assertions),
            "bundle_id": context.config().identifier,
            "segment_scheme": segment_protocol::channel_for(&context.config().identifier,cfg!(debug_assertions)).map(|c|c.scheme),
        });
        #[cfg(windows)]
        let info = {
            let mut info = info;
            info["version"] = option_env!("RIPPLE_APP_VERSION").into();
            info["build"] = option_env!("RIPPLE_BUILD_NUMBER").into();
            info["commit"] = option_env!("RIPPLE_SOURCE_COMMIT").into();
            info
        };
        println!("{}", info);
        return;
    }
    #[cfg(target_os = "macos")]
    if (cfg!(debug_assertions) && context.config().identifier == "studio.ripple.app.segmentdev") || cfg!(feature = "segment-transfer-test") {
        for window in &mut context.config_mut().app.windows { window.create = false; }
    }
    let builder=tauri::Builder::default();
    #[cfg(windows)]
    let builder=builder.plugin(tauri_plugin_single_instance::init(|app,args,_| {
        if enqueue_segment_links(app,args.into_iter().skip(1)) {focus_segment_window(app);}
    }));
    builder.plugin(tauri_plugin_dialog::init())
        .manage(Writes::default())
        .manage(SegmentLinks::default())
        .manage(ConnectorTunnel(Mutex::new(TunnelState::default())))
        .setup(|app| {
            enqueue_segment_links(app.handle(),std::env::args().skip(1));
            app.manage(updates::Updates::new(app.handle()));
            app.manage(update_window::UpdateWindow::default());
            if development(app.handle()) {
                let services = start_dev_services(app.handle()).map_err(std::io::Error::other)?;
                app.manage(DevServices(Mutex::new(services)));
                app.manage(Backend(Mutex::new(None)));
                #[cfg(target_os = "macos")]
                {
                    let config = &app.config().app.windows[0];
                    tauri::WebviewWindowBuilder::from_config(app.handle(), config)?
                        .data_store_identifier(*b"ripple-seg-00001").build()?;
                }
            } else {
                #[cfg(all(target_os = "macos", feature = "segment-transfer-test"))]
                {
                    if app.config().identifier != "studio.ripple.app.segmentcheck" { return Err("Test build requires isolated identity".into()); }
                    let config = &app.config().app.windows[0];
                    tauri::WebviewWindowBuilder::from_config(app.handle(), config)?
                        .data_store_identifier(*b"ripple-seg-00002").build()?;
                }
                let child = start_backend(app.handle()).map_err(std::io::Error::other)?;
                app.manage(Backend(Mutex::new(Some(child))));
            }
            #[cfg(target_os = "macos")]
            segment_drag::install_capture(app.handle()).map_err(std::io::Error::other)?;
            app.manage(Grants::load(app_data(app.handle())?.join("file-permissions-v1.json")).map_err(std::io::Error::other)?);
            let supervisor_app = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(5));
                let state = supervisor_app.state::<ConnectorTunnel>();
                if let Ok(mut guard) = state.0.lock() { supervise_tunnel(&supervisor_app, &mut guard); };
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![segment_drag::start_segment_drag, segment_clipboard::copy_segment, segment_link_next, update_window::update_close, updates::update_status, updates::update_check, updates::update_open_releases, pdf_print::preview_export_pdf, pdf_print::print_export_pdf, native_menu::set_menu_language, pick_directory, pick_files, pick_save_file, fs_permission, fs_access_status, fs_reauthorize, project_set_icon, fs_stat,
            fs_mkdir, fs_create_file, fs_read, fs_size, fs_read_chunk, fs_write, fs_media_check, fs_media_url,
            fs_begin_write, fs_write_chunk, fs_commit_write, fs_abort_write,
            fs_list, fs_remove, backend_ready, connector_window_key, connector_pick_client, connector_open_platform, connector_client_platform, connector_open_setup_link, connector_setup_status, connector_setup, connector_client_status, connector_client_select, connector_client_delete, connector_client_export, connector_client_reveal, connector_client_add, connector_tunnel_start, connector_tunnel_ready, connector_tunnel_status, connector_local_ready, connector_tunnel_stop])
        .on_menu_event(|app, event| {
            if event.id().as_ref() == native_menu::UPDATE_ID {
                if let Err(error) = update_window::open(app) { eprintln!("Update window failed: {error}"); }
            } else if event.id().as_ref() == native_menu::OPEN_PROJECT_ID {
                if let Some(window) = app.get_webview_window("main") {
                    if let Err(error) = window.emit("ripple-open-project", ()) { eprintln!("Open project menu event failed: {error}"); }
                }
            } else if let Some(id) = event.id().as_ref().strip_prefix(native_menu::RECENT_PROJECT_PREFIX) {
                if let Some(window) = app.get_webview_window("main") {
                    if let Err(error) = window.emit("ripple-open-recent-project", id) { eprintln!("Recent project menu event failed: {error}"); }
                }
            }
        })
        .on_window_event(|window, event| {
            if pdf_print::main_window(window.label()) && matches!(event, tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed) {
                stop_backend(window.app_handle());
                window.app_handle().exit(0);
            }
        })
        .build(context).expect("Ripple failed to start")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { ref urls } = event {
                if enqueue_segment_links(app,urls.iter().map(ToString::to_string)) {focus_segment_window(app);}
            }
            if matches!(event, tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit) { stop_backend(app); }
        });
}
