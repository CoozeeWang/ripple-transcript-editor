#!/usr/bin/env node
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, delimiter } from 'node:path';
import { homedir } from 'node:os';
import net from 'node:net';

export async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error(`Port ${port} is occupied. Close Ripple or the other dev session first. / 端口 ${port} 被占用，请先关闭 Ripple 或另一开发窗口。`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

export async function waitFor(url, alive, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline && alive()) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(500) })).ok) return; } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Service did not start: ${url}`);
}

async function main() {
  if (process.platform !== 'darwin' || typeof process.execve !== 'function') throw new Error('Ripple Dev requires macOS 14+ and Node.js 22.15+.');
  if (Number(execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).split('.')[0]) < 14) throw new Error('Ripple Dev requires macOS 14+ for isolated WebKit settings.');
  if (process.argv.length > 2) throw new Error('Use start-dev.command or npm --prefix desktop run dev without extra arguments.');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const work = join(root, '..', 'ripple-work', 'dev');
  mkdirSync(work, { recursive: true });
  const lock = join(work, 'launcher.lock');
  try { mkdirSync(lock); } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(readFileSync(join(lock, 'pid'), 'utf8'));
    if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid Ripple Dev lock; check the previous dev session.');
    let alive = true;
    try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; else if (error.code !== 'EPERM') throw error; }
    if (alive) throw new Error('Ripple Dev is already running. / Ripple Dev 已在运行。');
    rmSync(lock, { recursive: true });
    mkdirSync(lock);
  }
  writeFileSync(join(lock, 'pid'), String(process.pid));
  const children = [];
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    for (const child of children) {
      if (!child.pid) continue;
      try { process.kill(-child.pid, 'SIGTERM'); } catch (error) {
        if (error.code !== 'ESRCH') console.error(`Could not stop owned development process ${child.pid}: ${error.message}`);
      }
    }
    rmSync(lock, { recursive: true, force: true });
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('exit', stop);
  const env = { ...process.env, RIPPLE_DESKTOP_DEV: '1', RIPPLE_DATA_DIR: join(work, 'data'), RIPPLE_DEV_WORK: work,
    PYTHONDONTWRITEBYTECODE: '1', RIPPLE_API_TARGET: 'http://127.0.0.1:18702', RIPPLE_CONNECTOR_URL: 'http://127.0.0.1:18702' };
  env.PATH = [dirname(process.execPath), join(homedir(), '.cargo', 'bin'), env.PATH || ''].join(delimiter);
  env.CARGO_TARGET_AARCH64_APPLE_DARWIN_RUNNER = 'node ../../scripts/desktop-dev-macos.mjs';
  env.CARGO_TARGET_X86_64_APPLE_DARWIN_RUNNER = 'node ../../scripts/desktop-dev-macos.mjs';
  const run = (command, args, cwd) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit', detached: true });
    children.push(child);
    child.once('error', error => { console.error(error.message); process.exitCode = 1; stop(); });
    child.once('exit', (code) => { if (!stopping) { process.exitCode = code ?? 1; stop(); } });
    return child;
  };
  try {
    await assertPortFree(18702);
    await assertPortFree(5174);
    mkdirSync(env.RIPPLE_DATA_DIR, { recursive: true });
    const backend = run(join(root, 'backend/.venv/bin/python'), ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '18702', '--reload', '--reload-dir', 'app'], join(root, 'backend'));
    await waitFor('http://127.0.0.1:18702/api/health', () => backend.exitCode === null && !stopping);
    const vite = run(process.execPath, [join(root, 'frontend/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5174', '--strictPort'], join(root, 'frontend'));
    await waitFor('http://127.0.0.1:5174', () => vite.exitCode === null && !stopping);
    console.log('Ripple Dev: frontend refreshes; Python reloads; Rust rebuilds. Close the window or press Ctrl+C to stop.');
    run(process.execPath, [join(root, 'desktop/node_modules/@tauri-apps/cli/tauri.js'), 'dev', '--config', 'src-tauri/tauri.dev.conf.json'], join(root, 'desktop'));
  } catch (error) { stop(); throw error; }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
