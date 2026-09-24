import { open, readFile, unlink, stat } from 'node:fs/promises';

// Serialize start/stop/cleanup across processes. Recover locks after a crashed owner.
export async function withLifecycleLock(file, action, timeoutMs = 60000) {
  const started = Date.now();
  for (;;) {
    let handle;
    try { handle = await open(file, 'wx'); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const pid = Number(await readFile(file, 'utf8'));
        let alive = true;
        if (pid > 0) {
          try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
        } else if (Date.now() - (await stat(file)).mtimeMs > 5000) alive = false;
        if (!alive) { await unlink(file); continue; }
      } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (Date.now() - started > timeoutMs) throw new Error('等待启动或停止操作超时，请稍后重试。');
      await new Promise(resolve => setTimeout(resolve, 100));
      continue;
    }
    try {
      await handle.writeFile(String(process.pid));
      return await action();
    } finally {
      await handle.close();
      await unlink(file);
    }
  }
}
