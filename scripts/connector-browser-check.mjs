/** Real MCP -> HTTP broker -> actual App/version storage, using only synthetic files. */
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from '../frontend/node_modules/vite/dist/node/index.js';
import react from '../frontend/node_modules/@vitejs/plugin-react/dist/index.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (!process.env.RIPPLE_PLAYWRIGHT_MODULE) throw new Error('Set RIPPLE_PLAYWRIGHT_MODULE to an installed Playwright module.');
const { chromium } = await import(pathToFileURL(process.env.RIPPLE_PLAYWRIGHT_MODULE));
const directory = await mkdtemp(join(tmpdir(), 'ripple-connector-synthetic-'));
const backendPort = Number(process.env.RIPPLE_CONNECTOR_TEST_PORT || 60982);
const backendUrl = `http://127.0.0.1:${backendPort}`;
const python = join(repo, 'backend/.venv/bin/python');
let browser, vite;
const backend = spawn(python, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(backendPort)],
  { cwd: join(repo, 'backend'), env: { ...process.env, RIPPLE_DATA_DIR: join(directory, 'data'), PYTHONDONTWRITEBYTECODE: '1' }, stdio: 'ignore' });
try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    try { if ((await fetch(`${backendUrl}/api/health`)).ok) { ready = true; break; } } catch { /* Wait for owned backend. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready || backend.exitCode !== null) throw new Error('Synthetic backend did not start. Choose an unused test port.');
  const token = await readFile(join(directory, 'data/connector/window.key'), 'utf8');
  await writeFile(join(directory, 'entry.tsx'), (await readFile(join(repo, 'scripts/fixtures/connector-browser.tsx'), 'utf8')).replaceAll('__REPO__', repo));
  await writeFile(join(directory, 'index.html'), '<!doctype html><html><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>');
  vite = await createServer({ configFile: false, root: directory, plugins: [react()], publicDir: join(repo, 'frontend/public'),
    cacheDir: join(directory, 'vite-cache'), optimizeDeps: { include: ['react', 'react-dom/client'] },
    resolve: { alias: { react: join(repo, 'frontend/node_modules/react'), 'react-dom': join(repo, 'frontend/node_modules/react-dom') } },
    server: { host: '127.0.0.1', port: 0, fs: { allow: [repo, directory] }, proxy: { '/api': backendUrl } } });
  await vite.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Native credential/lifecycle calls are a fixture; UI, document state and saving are real.
  await page.addInitScript(key => { window.__connectorInvocations = []; window.__TAURI__ = { core: { invoke: async name => {
    window.__connectorInvocations.push(name);
    if (name === 'connector_setup_status') return { client_path: '/synthetic/tunnel-client', tunnel_id: 'tunnel_synthetic', has_key: true, configured: true };
    if (name === 'connector_open_platform' && window.__failPlatform) throw new Error('synthetic_open_failure');
    return name === 'connector_window_key' ? key : true;
  } } }; }, token);
  await page.goto(vite.resolvedUrls.local[0]);
  await page.getByText('我觉得先开始。', { exact: true }).waitFor();
  await page.getByRole('button', { name: /设置|偏好/ }).first().click();
  if (await page.getByRole('heading', { name: 'MCP 连接', exact: true }).count()) throw new Error('MCP must not be in General settings');
  await page.getByRole('tab', { name: 'AI 辅助编辑', exact: true }).click();
  await page.getByLabel('启用 MCP 连接').check();
  await page.getByText('连接已就绪，可到外部 AI 应用提出需求').waitFor();
  const result = await promisify(execFile)(python, [join(repo, 'scripts/fixtures/connector-mcp-check.py')],
    { cwd: repo, env: { ...process.env, RIPPLE_CONNECTOR_TEST_DIR: directory, RIPPLE_CONNECTOR_TEST_URL: backendUrl } });
  await page.getByRole('dialog').getByRole('button', { name: /关闭/ }).first().click();
  await page.waitForTimeout(200);
  const state = await page.evaluate(async () => {
    const f = window.__fixture, manifest = await f.readManifest(), model = manifest.models[0];
    const original = await f.readModelEdit(model.id, model.edits[0].id);
    const current = await f.readModelEdit(model.id, model.activeEditId);
    return { count: model.edits.length, source: original.transcript.segments.map(s => s.text), result: current.transcript.segments.map(s => s.text), notes: current.transcript.segments.flatMap(s => s.annotations ?? []), marks: current.transcript.segments.flatMap(s => s.highlights ?? []), words: current.transcript.segments[1].words };
  });
  if (state.count !== 2 || state.source[1] !== '嗯，我觉得可能还有问题。' || state.result[1] !== '我觉得可能还有问题。' || state.result[2] !== state.source[2]) throw new Error('Version preservation failed');
  if (state.notes.filter(note => note.source === 'ai').length !== 1 || !state.notes.some(note => note.id === 'manual') || state.marks.filter(mark => mark.source === 'ai').length !== 1 || !state.words.length) throw new Error('AI marks or human marks/timing not preserved');
  await page.getByText('AI 批注', { exact: true }).waitFor();
  const savedMarks = async () => page.evaluate(async () => {
    const f = window.__fixture, manifest = await f.readManifest(), model = manifest.models[0];
    const edit = await f.readModelEdit(model.id, model.activeEditId);
    return { versions: model.edits.length, ai: edit.transcript.segments.flatMap(s => s.annotations ?? []).filter(n => n.source === 'ai').length, human: edit.transcript.segments.flatMap(s => s.annotations ?? []).filter(n => n.id === 'manual').length };
  });
  await page.locator('.annotation-card').first().focus();
  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(1200);
  const undone = await savedMarks();
  if (undone.versions !== 2 || undone.ai !== 0 || undone.human !== 1) throw new Error(`Mark batch undo failed: ${JSON.stringify(undone)}`);
  await page.keyboard.press('Meta+Shift+z');
  await page.waitForTimeout(1200);
  if ((await savedMarks()).ai !== 1) throw new Error('Mark redo did not persist');

  if (!(await page.getByText('显示修改痕迹', { exact: true }).isVisible())) throw new Error('Comparison was not displayed');
  // A higher z-index cannot escape the title area's scrolling clip. Check the
  // complete tooltip box in both languages and in a short, narrow window.
  for (const language of ['zh-CN', 'en']) {
    await page.locator('.language-control select').selectOption(language);
    for (const viewport of [{ width: 1280, height: 800 }, { width: 850, height: 520 }]) {
      await page.setViewportSize(viewport);
      const toggle = page.locator('.comparison-toggle');
      await page.keyboard.press('Tab');
      await toggle.focus();
      await page.waitForTimeout(300);
      const contained = await toggle.evaluate(button => {
        const box = button.getBoundingClientRect();
        const clip = button.closest('.transcript-header-fixed').getBoundingClientRect();
        const tip = getComputedStyle(button, '::after');
        const height = parseFloat(tip.height) + (tip.boxSizing === 'border-box' ? 0 : parseFloat(tip.paddingTop) + parseFloat(tip.paddingBottom));
        const bottom = box.top - 8;
        return { ok: tip.opacity === '1' && bottom - height >= clip.top && bottom <= clip.bottom, opacity: tip.opacity, top: bottom - height, bottom, clipTop: clip.top, clipBottom: clip.bottom, height };
      });
      if (!contained.ok) throw new Error(`Tooltip clipped: ${language} ${viewport.width}x${viewport.height} ${JSON.stringify(contained)}`);
      if (process.env.RIPPLE_CONNECTOR_SCREENSHOT_DIR) {
        await mkdir(process.env.RIPPLE_CONNECTOR_SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({ path: join(process.env.RIPPLE_CONNECTOR_SCREENSHOT_DIR, `tooltip-${language}-${viewport.width}.png`) });
      }
    }
  }
  await page.locator('.language-control select').selectOption('zh-CN');
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const language of ['zh-CN', 'en']) {
    await page.locator('.language-control select').selectOption(language);
    await page.getByRole('button', { name: language === 'en' ? 'Settings' : '设置', exact: true }).click();
    await page.getByRole('tab', { name: language === 'en' ? 'AI-assisted editing' : 'AI 辅助编辑', exact: true }).click();
    await page.locator('.connector-setup summary').click();
    await page.getByRole('button', { name: language === 'en' ? 'Edit configuration' : '修改配置', exact: true }).click();
    const layout = await page.locator('.connector-setup .cred-field').first().evaluate(field => ({ columns: getComputedStyle(field).gridTemplateColumns, gap: getComputedStyle(field).columnGap }));
    if (!layout.columns.startsWith('130px ') || layout.gap !== '10px') throw new Error(`MCP fields differ from transcription engine: ${JSON.stringify(layout)}`);
    const inputs = page.locator('.connector-setup input');
    if (await inputs.nth(0).inputValue() !== 'tunnel-client' || await inputs.nth(1).inputValue() !== 'tunnel_synthetic' || await inputs.nth(2).inputValue() !== '') throw new Error('Saved non-secret configuration not displayed safely');
    const platform = page.locator('.connector-setup a');
    await platform.press('Enter');
    if (!await page.evaluate(() => window.__connectorInvocations.includes('connector_open_platform'))) throw new Error('Desktop link did not invoke system browser');
    await page.evaluate(() => { window.__failPlatform = true; });
    await platform.click();
    await page.locator('.connector-error').waitFor();
    await page.evaluate(() => { window.__failPlatform = false; });
    await platform.click();
    if (await page.locator('.connector-error').count()) throw new Error('Retry must clear link error');
    await page.locator('.connector-setup .cred-field').first().scrollIntoViewIfNeeded();
    if (process.env.RIPPLE_CONNECTOR_SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.RIPPLE_CONNECTOR_SCREENSHOT_DIR, `settings-${language}.png`) });
    await page.getByRole('dialog').getByRole('button', { name: language === 'en' ? 'Close' : '关闭', exact: true }).click();
  }
  await page.locator('.language-control select').selectOption('zh-CN');
  await page.getByRole('button', { name: /设置|偏好/ }).first().click();
  await page.getByRole('tab', { name: 'AI 辅助编辑', exact: true }).click();
  await page.getByLabel('启用 MCP 连接').uncheck();
  const clientKey = await readFile(join(directory, 'data/connector/client.key'), 'utf8');
  await new Promise(resolve => setTimeout(resolve, 100));
  const denied = await fetch(`${backendUrl}/api/connector/call`, { method: 'POST', headers: { Authorization: `Bearer ${clientKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'synthetic-disabled-check', operation: 'read_current', arguments: {} }) });
  if (denied.status !== 409) throw new Error('Disabled connection still readable');
  if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
  if (process.env.RIPPLE_CONNECTOR_SCREENSHOT_DIR) {
    await mkdir(process.env.RIPPLE_CONNECTOR_SCREENSHOT_DIR, { recursive: true });
    await page.getByRole('dialog').getByRole('button', { name: /关闭/ }).first().click();
    await page.screenshot({ path: join(process.env.RIPPLE_CONNECTOR_SCREENSHOT_DIR, 'connector-comparison.png') });
  }
  console.log(result.stdout.trim());
  console.log('PASS: source preserved; exactly one new version; comparison visible; disabled connection rejected. Native lifecycle is simulated; no model or real interview used.');
} finally {
  await browser?.close();
  await vite?.close();
  backend.kill('SIGTERM');
  await rm(directory, { recursive: true, force: true });
}
