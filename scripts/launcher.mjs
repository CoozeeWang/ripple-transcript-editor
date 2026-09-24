#!/usr/bin/env node
/**
 * Ripple 统一生命周期管理（launcher）。
 *
 * 职责：启动前后端、打开 Chrome 独立应用窗口、监视窗口关闭并自动清理，
 * 全程跨平台（macOS / Windows）。
 *
 * 用法：
 *   node scripts/launcher.mjs start   # 启动前后端 + 打开应用窗口 + 后台 watch
 *   node scripts/launcher.mjs stop    # 停止一切（服务 + 应用窗口 + watch）
 *   node scripts/launcher.mjs watch   # 仅监视（由 start 内部 spawn，一般不用手动跑）
 *   node scripts/launcher.mjs refresh-backend # 更新后台，保留当前编辑窗口
 *
 * 设计：进程清理不再依赖 macOS 专属的 lsof/pkill（后端 /api/shutdown 也已移除
 * 这些命令）。这里统一用端口定位 + 跨平台 kill；应用窗口用 Chrome --app 独立
 * profile（--user-data-dir）打开，关窗即该 Chrome 实例退出，watch 据此触发清理。
 */

import { spawn, execFile, execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { bilingualLauncherMessage } from "./launcher-messages.mjs";
import { withLifecycleLock } from "./lifecycle-lock.mjs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BACKEND_DIR = path.join(ROOT, "backend");
const FRONTEND_DIR = path.join(ROOT, "frontend");
const DATA_DIR = process.env.RIPPLE_DATA_DIR || path.join(ROOT, "..", "ripple-local");
const LOG_DIR = path.join(ROOT, ".logs");
const CHROME_PROFILE = path.join(ROOT, ".chrome-profile");
const LOCK_FILE = path.join(LOG_DIR, "lifecycle.lock");
const WATCH_PID_FILE = path.join(LOG_DIR, "launcher-watch.pid");
const APP_URL = "http://localhost:5173/";
const BACKEND_URL = "http://127.0.0.1:8000/api/health";
// 独立 Chrome 实例的命令行特征。必须同时满足两点，避免误判：
// 1. 带上「--user-data-dir=」前缀，排除命令行里恰好含该字样的无关进程（shell 等）；
// 2. macOS 上精确匹配主进程二进制路径「MacOS/Google Chrome」，排除 helper 进程
//    （helper 路径是 .../Google Chrome Helper，主进程被杀后 helper 可能残留，
//    若用宽泛的 .chrome-profile 会误匹配残留 helper，导致 watch 永不触发清理）。
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CHROME_MARKER = `^/Applications/Google Chrome.app/Contents/MacOS/Google Chrome .*--user-data-dir=${escapeRegex(CHROME_PROFILE)}( |$)`;
const CHROME_MARKER_WIN = `--user-data-dir="?${escapeRegex(CHROME_PROFILE)}"?( |$)`;
const CHROME_HELPER_EXCLUDE = "*--type=*";

const isWin = process.platform === "win32";
const launcherPath = fileURLToPath(import.meta.url);
const uvCmd = isWin ? "uv.exe" : "uv";
const npmCmd = isWin ? "npm.cmd" : "npm";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function log(message) {
  console.log(`[${new Date().toISOString()}] [launcher] ${bilingualLauncherMessage(message)}`);
}

/** 检查某个命令是否在 PATH 中可用（uv / npm 等）。 */
function commandExists(command, args = ["--version"]) {
  try {
    execFileSync(command, args, { stdio: "ignore", shell: isWin });
    return true;
  } catch {
    return false;
  }
}

/** 执行外部命令，返回 stdout（失败返回空串），不抛错。 */
function execFileOut(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 15000, windowsHide: true }, (error, stdout) => {
      resolve(error ? "" : String(stdout || ""));
    });
  });
}

/** 找到监听某端口的进程 PID（跨平台）。 */
async function portPids(port) {
  const pids = new Set();
  if (isWin) {
    const out = await execFileOut("netstat", ["-ano", "-p", "tcp"]);
    for (const line of out.split(/\r?\n/)) {
      if (line.includes(`:${port} `) && line.toUpperCase().includes("LISTENING")) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (/^\d+$/.test(pid)) pids.add(pid);
      }
    }
  } else {
    const out = await execFileOut("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"]);
    for (const pid of out.split(/\s+/)) {
      if (/^\d+$/.test(pid)) pids.add(pid);
    }
  }
  return [...pids];
}

async function killPid(pid) {
  if (isWin) {
    await execFileOut("taskkill", ["/PID", String(pid), "/F", "/T"]);
  } else {
    await execFileOut("kill", ["-9", String(pid)]);
  }
}

export function isOwnedService(command, cwd, root = ROOT) {
  const backend = path.join(root, "backend");
  const frontend = path.join(root, "frontend");
  // macOS can check the actual cwd. Windows launch commands carry absolute paths.
  if (cwd) return (cwd === backend && /(?:^|[ /])uvicorn(?: |$)/.test(command)) ||
    (cwd === frontend && /(?:^|[ /])vite(?:\.js)?(?: |$)/.test(command));
  const argument = value => new RegExp(`(?:^|[ \"])${escapeRegex(value)}(?:[ \"]|$)`).test(command);
  return argument(path.join(frontend, "node_modules", "vite", "bin", "vite.js")) ||
    (new RegExp(`--app-dir \"?${escapeRegex(backend)}\"?(?: |$)`).test(command) && /(?:^| )uvicorn(?: |$)/.test(command));
}
async function processCommand(pid) {
  if (!/^\d+$/.test(String(pid))) return "";
  if (isWin) return (await execFileOut("powershell", ["-NoProfile", "-Command",
    `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`])).trim();
  return (await execFileOut("ps", ["-p", String(pid), "-o", "command="])).trim();
}
async function ownedPid(pid) {
  const command = await processCommand(pid);
  const cwd = isWin ? "" : (await execFileOut("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]))
    .split("\n").find(line => line.startsWith("n"))?.slice(1);
  return Boolean((isWin || cwd) && isOwnedService(command, cwd));
}

async function killPort(port) {
  for (const pid of await portPids(port)) {
    const command = await processCommand(pid);
    const cwd = isWin ? "" : (await execFileOut("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]))
      .split("\n").find(line => line.startsWith("n"))?.slice(1);
    if ((isWin || cwd) && isOwnedService(command, cwd)) await killPid(pid);
    else log(`端口 ${port} 由其他程序使用，已保留该程序。`);
  }
}

/** 关闭独立 profile 的 Chrome 应用窗口（只杀带 .chrome-profile 标记的实例）。 */
export function isOwnedChrome(command, profile = CHROME_PROFILE) {
  return command.startsWith("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome ") &&
    new RegExp(`(?:^| )--user-data-dir=${escapeRegex(profile)}(?: |$)`).test(command) &&
    !/(?:^| )--type=/.test(command);
}

async function killChromeApp() {
  if (isWin) {
    const script =
      `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | ` +
      `Where-Object { $_.CommandLine -match '${CHROME_MARKER_WIN.replaceAll("'", "''")}' -and $_.CommandLine -notlike '${CHROME_HELPER_EXCLUDE}' } | ` +
      `ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
    await execFileOut("powershell", ["-NoProfile", "-Command", script]);
  } else {
    await execFileOut("pkill", ["-f", CHROME_MARKER]);
  }
}

/** 独立 Chrome 应用实例当前是否还在运行。 */
async function chromeAppRunning() {
  if (isWin) {
    const script =
      `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | ` +
      `Where-Object { $_.CommandLine -match '${CHROME_MARKER_WIN.replaceAll("'", "''")}' -and $_.CommandLine -notlike '${CHROME_HELPER_EXCLUDE}' }`;
    const out = await execFileOut("powershell", ["-NoProfile", "-Command", script]);
    return out.trim().length > 0;
  }
  const out = await execFileOut("pgrep", ["-f", CHROME_MARKER]);
  return out.trim().length > 0;
}

async function openChromeApp() {
  const appArg = `--app=${APP_URL}`;
  const profileArg = `--user-data-dir=${CHROME_PROFILE}`;
  if (isWin) {
    const roots = [
      process.env["ProgramFiles"],
      process.env["ProgramFiles(x86)"],
      process.env["LOCALAPPDATA"],
    ].filter(Boolean);
    const chrome = roots
      .map((root) => path.join(root, "Google", "Chrome", "Application", "chrome.exe"))
      .find((candidate) => existsSync(candidate));
    if (chrome) {
      spawn(chrome, [profileArg, appArg, "--disable-background-mode", "--no-first-run"], {
        detached: true,
        stdio: "ignore",
      }).unref();
      return;
    }
    spawn("cmd", ["/c", "start", "", "chrome", profileArg, appArg], {
      detached: true,
      stdio: "ignore",
    }).unref();
    return;
  }
  // macOS：必须直接调用 Chrome 二进制。`open -na ... --args` 在 Chrome 已运行时
  // 会被其单实例机制忽略 --user-data-dir，退回默认 profile 打开普通窗口。
  const chromeBin = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (existsSync(chromeBin)) {
    spawn(chromeBin, [profileArg, appArg, "--disable-background-mode", "--no-first-run"], {
      detached: true,
      stdio: "ignore",
    }).unref();
    return;
  }
  spawn("open", ["-na", "Google Chrome", "--args", profileArg, appArg], {
    detached: true,
    stdio: "ignore",
  }).unref();
}

async function waitForUrl(url, label, timeoutMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return true;
    } catch {
      /* 还没就绪，继续等 */
    }
    await sleep(250);
  }
  log(`等待超时：${label}`);
  return false;
}

/** spawn 一个把日志写到 .logs 的后台进程（脱离父进程存活）。 */
function spawnLogged(command, args, cwd, logName, env = process.env) {
  const fd = openSync(path.join(LOG_DIR, logName), "a");
  const child = spawn(command, args, { cwd, detached: true, env, stdio: ["ignore", fd, fd] });
  child.on("exit", () => {
    try {
      closeSync(fd);
    } catch {
      /* 已关闭 */
    }
  });
  child.unref();
  return child;
}

/** 真正的清理动作：杀后端 + 前端 + 关闭应用窗口。stop 命令与 watch 共用。 */
async function stopInternal() {
  await killPort(8000);
  await killPort(5173);
  await killChromeApp();
  // Signals are asynchronous: do not release the lifecycle lock while the old
  // Chrome profile or service ports are still shutting down.
  for (let i = 0; i < 40; i++) {
    if (!(await portPids(8000)).length && !(await portPids(5173)).length && !await chromeAppRunning()) return;
    await sleep(100);
  }
  if (!isWin && await chromeAppRunning()) {
    log("专用 Chrome 实例未响应退出信号，清理残留进程…");
    const candidates = (await execFileOut("pgrep", ["-f", CHROME_MARKER])).trim().split(/\s+/);
    for (const pid of candidates) {
      if (isOwnedChrome(await processCommand(pid))) await killPid(pid);
    }
    for (let i = 0; i < 20 && await chromeAppRunning(); i++) await sleep(100);
    if (await chromeAppRunning()) throw new Error("专用 Chrome 实例仍未退出，请关闭 Ripple 窗口后重试。");
  }
}

async function retireWatcher() {
  if (existsSync(WATCH_PID_FILE)) {
    try {
      const pid = parseInt(readFileSync(WATCH_PID_FILE, "utf8").trim(), 10);
      if (pid && pid !== process.pid && (await processCommand(pid)).endsWith(`${launcherPath} watch`)) await killPid(pid);
    } catch {
      /* pid 文件可能损坏，忽略 */
    }
    try {
      rmSync(WATCH_PID_FILE, { force: true });
    } catch {
      /* 删除失败无碍 */
    }
  }
}

async function stop() {
  await retireWatcher();
  await stopInternal();
  log("已停止 Ripple。");
}

// A running pre-update backend can pass /health but lack the new editing routes.
// Only a missing route identifies an old service; storage errors must not restart it.
export async function backendNeedsUpdate(request = fetch) {
  const response = await request("http://127.0.0.1:8000/api/ai/providers", {
    signal: AbortSignal.timeout(2000),
  });
  return response.status === 404;
}

function spawnBackend() {
  // Avoid a reload supervisor that would respawn a worker after launcher shutdown.
  return spawnLogged(uvCmd,
    ["run", "uvicorn", "app.main:app", "--app-dir", BACKEND_DIR, "--port", "8000"],
    BACKEND_DIR, "backend.log", { ...process.env, RIPPLE_DATA_DIR: DATA_DIR });
}

async function refreshBackend() {
  if (!commandExists(uvCmd)) throw new Error("找不到 uv，请先安装 uv。");
  const pids = await portPids(8000);
  for (const pid of pids) {
    if (!await ownedPid(pid)) throw new Error("后台端口由其他程序使用，未停止该程序。");
    if (/\s--reload(?:\s|$)/.test(await processCommand(pid))) {
      throw new Error("后台正以开发热重载模式运行，请通过开发终端重启。");
    }
  }
  // Graceful termination permits outstanding requests to finish. Leave Chrome,
  // Vite, the watcher and browser-held transcript drafts running throughout.
  for (const pid of pids) {
    if (isWin) await execFileOut("taskkill", ["/PID", String(pid), "/T"]);
    else await execFileOut("kill", ["-TERM", String(pid)]);
  }
  for (let i = 0; i < 100 && (await portPids(8000)).length; i++) await sleep(100);
  if ((await portPids(8000)).length) throw new Error("后台仍在处理请求，稍后重试；编辑窗口已保留。");
  spawnBackend();
  if (!await waitForUrl(BACKEND_URL, "后台")) throw new Error("后台更新失败，请查看 .logs/backend.log。");
  if (await backendNeedsUpdate()) throw new Error("后台仍缺少编辑接口，请检查安装文件。");
  log("后台已更新，编辑窗口与稿件已保留。");
}

async function start() {
  if (!commandExists(uvCmd)) {
    throw new Error("找不到 uv，请先安装 uv。");
  }
  if (!commandExists(npmCmd)) {
    throw new Error("找不到 npm，请先安装 Node.js。");
  }
  if (!existsSync(path.join(FRONTEND_DIR, "node_modules"))) {
    throw new Error("前端依赖尚未安装，请先在 frontend 目录运行 npm install。");
  }

  if (!path.isAbsolute(DATA_DIR)) {
    throw new Error("RIPPLE_DATA_DIR must be an absolute path.");
  }
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(LOG_DIR, { recursive: true });

  log("正在启动，请稍候…");
  const occupied = new Set();
  for (const port of [8000, 5173]) {
    const pids = await portPids(port);
    for (const pid of pids) {
      if (!await ownedPid(pid)) throw new Error(`端口 ${port} 被其他程序占用（PID ${pid}），未关闭该程序。`);
    }
    if (pids.length) occupied.add(port);
  }
  // Under the lifecycle lock, retire the old watcher before re-opening the window.
  if (occupied.has(8000) && await backendNeedsUpdate()) {
    log("检测到旧版后台，正在载入编辑引擎功能…");
    await refreshBackend();
  }
  await retireWatcher();
  if (occupied.size) log("复用 Ripple 已运行的服务，重新打开窗口…");

  if (!occupied.has(8000)) spawnBackend();
  if (!occupied.has(5173)) spawnLogged(process.execPath, [path.join(FRONTEND_DIR, "node_modules", "vite", "bin", "vite.js"), "--port", "5173", "--strictPort"], FRONTEND_DIR, "frontend.log");

  const backendOk = await waitForUrl(BACKEND_URL, "后端");
  const frontendOk = await waitForUrl(APP_URL, "前端");
  if (!backendOk || !frontendOk) {
    log("启动失败，详见 .logs/ 目录。");
    await stopInternal();
    throw new Error("服务启动失败，请查看 .logs/backend.log 和 .logs/frontend.log。");
  }

  await openChromeApp();
  let opened = false;
  for (let i = 0; i < 40; i++) {
    if (await chromeAppRunning()) { opened = true; break; }
    await sleep(250);
  }
  if (!opened) {
    await stopInternal();
    throw new Error("Chrome 应用进程未能启动，请检查 Chrome 是否已安装。");
  }
  const watchFd = openSync(path.join(LOG_DIR, "watch.log"), "a");
  const watchProc = spawn(process.execPath, [launcherPath, "watch"], {
    detached: true,
    stdio: ["ignore", watchFd, watchFd],
  });
  watchProc.on("exit", () => {
    try {
      closeSync(watchFd);
    } catch {
      /* 已关闭 */
    }
  });
  writeFileSync(WATCH_PID_FILE, String(watchProc.pid));
  watchProc.unref();
  log("已打开。关闭应用窗口即自动停止；也可双击 stop 脚本停止。");
}

async function watch() {
  // The parent records ownership while holding the lifecycle lock.
  for (let i = 0; i < 10 && !isCurrentWatcher(); i++) await sleep(50);
  if (!isCurrentWatcher()) return;
  log(`watch 启动，pid=${process.pid}`);

  // open 是异步的，先给 Chrome 独立窗口一点启动时间
  let chromeWasUp = false;
  for (let i = 0; i < 80; i++) {
    if (await chromeAppRunning()) {
      chromeWasUp = true;
      break;
    }
    await sleep(500);
  }
  log(`初始检测完成，chromeWasUp=${chromeWasUp}`);

  if (!chromeWasUp) {
    log("未能打开应用窗口，正在清理本次服务。");
    await cleanupWatchedSession();
    return;
  }

  // 轮询：窗口一旦关闭（独立 Chrome 实例退出）就执行清理
  for (;;) {
    if (!isCurrentWatcher()) return;
    const running = await chromeAppRunning();
    if (chromeWasUp && !running) break;
    if (running) chromeWasUp = true;
    await sleep(1500);
  }

  log("检测到窗口关闭，开始清理");
  await cleanupWatchedSession();
}

function isCurrentWatcher() {
  try { return readFileSync(WATCH_PID_FILE, "utf8").trim() === String(process.pid); }
  catch { return false; }
}

async function cleanupWatchedSession() {
  await withLifecycleLock(LOCK_FILE, async () => {
    if (!isCurrentWatcher()) return;
    // A reopening may have happened while this watcher waited for the lock.
    if (await chromeAppRunning()) return;
    await stopInternal();
    rmSync(WATCH_PID_FILE, { force: true });
    log("清理完成，watch 退出");
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === launcherPath) {
const command = process.argv[2] || "start";
try {
mkdirSync(LOG_DIR, { recursive: true });
if (command === "start") await withLifecycleLock(LOCK_FILE, start);
else if (command === "stop") await withLifecycleLock(LOCK_FILE, stop);
else if (command === "watch") await watch();
else if (command === "refresh-backend") await withLifecycleLock(LOCK_FILE, refreshBackend);
else {
  log(`未知命令：${command}`);
  process.exit(1);
}
} catch (error) {
  log(error.message);
  process.exitCode = 1;
}

}
