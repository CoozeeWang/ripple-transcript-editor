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
    if (name === 'connector_client_status') return { client: 'chatgpt' };
    if (name === 'connector_setup_status') return { client_path: '/synthetic/tunnel-client', tunnel_id: 'tunnel_synthetic', has_key: true, configured: true };
    if (name === 'connector_open_platform' && window.__failPlatform) throw new Error('synthetic_open_failure');
    return name === 'connector_window_key' ? key : true;
  } } }; }, token);
  await page.goto(vite.resolvedUrls.local[0]);
  await page.getByText('我觉得先开始，把这份合成稿件核对清楚。', { exact: true }).waitFor();
  await page.getByRole('button', { name: /设置|偏好/ }).first().click();
  if (await page.getByRole('heading', { name: 'MCP 连接', exact: true }).count()) throw new Error('MCP must not be in General settings');
  await page.getByRole('tab', { name: 'AI 辅助编辑', exact: true }).click();
  await page.getByLabel('启用 MCP 连接').check();
  await page.getByText('本机连接已就绪。请在所选 AI 软件中完成 Ripple 的添加和启用后使用。').waitFor();
  const result = await promisify(execFile)(python, [join(repo, 'scripts/fixtures/connector-mcp-check.py')],
    { cwd: repo, env: { ...process.env, RIPPLE_CONNECTOR_TEST_DIR: directory, RIPPLE_CONNECTOR_TEST_URL: backendUrl } });
  await page.getByRole('dialog').getByRole('button', { name: /关闭/ }).first().click();
  await page.waitForTimeout(200);
  const state = await page.evaluate(async () => {
    const f = window.__fixture, manifest = await f.readManifest(), model = manifest.models.find(m => m.id === manifest.activeModelId);
    const original = await f.readModelEdit(model.id, model.edits[0].id);
    const current = await f.readModelEdit(model.id, model.activeEditId);
    return { count: model.edits.length, source: original.transcript.segments.map(s => s.text), result: current.transcript.segments.map(s => s.text), notes: current.transcript.segments.flatMap(s => s.annotations ?? []), marks: current.transcript.segments.flatMap(s => s.highlights ?? []), words: current.transcript.segments[1].words };
  });
  if (state.count !== 2 || state.source[1] !== '嗯，我觉得可能还有问题，需要继续检查这个合成例子。' || state.result[1] !== '我觉得可能还有问题，需要继续检查这个合成例子。' || state.result[2] !== state.source[2]) throw new Error('Version preservation failed');
  if (state.notes.filter(note => note.source === 'ai').length !== 1 || !state.notes.some(note => note.id === 'manual') || state.marks.filter(mark => mark.source === 'ai').length !== 1 || !state.words.length) throw new Error('AI marks or human marks/timing not preserved');
  await page.getByText('AI 批注', { exact: true }).waitFor();
  const savedMarks = async () => page.evaluate(async () => {
    const f = window.__fixture, manifest = await f.readManifest(), model = manifest.models.find(m => m.id === manifest.activeModelId);
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

  const structural = await promisify(execFile)(python, [join(repo, 'scripts/fixtures/connector-mcp-check.py')],
    { cwd: repo, env: { ...process.env, RIPPLE_CONNECTOR_TEST_DIR: directory, RIPPLE_CONNECTOR_TEST_URL: backendUrl, RIPPLE_STRUCTURAL_ONLY: '1' } });
  const merged = await page.evaluate(async () => {
    const f = window.__fixture, manifest = await f.readManifest(), model = manifest.models.find(m => m.id === manifest.activeModelId);
    const source = await f.readModelEdit(model.id, model.edits[0].id);
    const marked = await f.readModelEdit(model.id, model.edits[1].id);
    const current = await f.readModelEdit(model.id, model.activeEditId);
    return { versions: model.edits.length, sourceCount: source.transcript.segments.length, markedCount: marked.transcript.segments.length,
      count: current.transcript.segments.length, row: current.transcript.segments[0], internalSnapshot: model.original };
  });
  if (merged.versions !== 3 || merged.sourceCount !== 3 || merged.markedCount !== 3 || merged.count !== 1 ||
      merged.row.id !== 's1' || merged.row.mergedFrom.join() !== 's1,s2' ||
      merged.row.annotations.filter(n => n.source === 'ai').length !== 1 || !merged.row.annotations.some(n => n.id === 'manual') ||
      !merged.row.words.length || merged.row.highlights.filter(h => h.source === 'ai').length !== 1 || !merged.internalSnapshot)
    throw new Error('Structural version preservation failed');
  console.log(structural.stdout.trim());

  // The imported snapshot stays stored but never becomes a user-facing version.
  for (const language of ['zh-CN', 'en']) {
    await page.locator('.language-control > button').click(); await page.getByRole('menuitemradio', {name: language === 'en' ? 'English' : '简体中文'}).click();
    for (const viewport of [{ width: 1280, height: 800 }, { width: 850, height: 520 }]) {
      await page.setViewportSize(viewport);
      const trigger = page.locator('.version-picker--current .version-picker-trigger');
      await trigger.click();
      const popup = page.locator('.version-picker--current .version-picker-menu');
      if (await popup.locator('.version-picker-row--original').count() !== 1) throw new Error('Internal import snapshot leaked to current menu');
      if (await popup.locator('.version-picker-snapshot-note').count()) throw new Error('Internal snapshot explanation leaked to menu');
      const layout = await popup.evaluate(menu => {
        const box = menu.getBoundingClientRect();
        return { fits: box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight };
      });
      if (!layout.fits) throw new Error('Version menu clipped');
      await popup.locator('.version-picker-option').first().focus();
      await popup.locator('.version-picker-option').first().hover();
      if (process.env.RIPPLE_CONNECTOR_SCREENSHOT_DIR) {
        await mkdir(process.env.RIPPLE_CONNECTOR_SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({ path: join(process.env.RIPPLE_CONNECTOR_SCREENSHOT_DIR, `versions-${language}-${viewport.width}.png`) });
      }
      await trigger.press('Escape');
    }
  }

  await page.locator('.language-control > button').click(); await page.getByRole('menuitemradio', {name: 'zh-CN' === 'en' ? 'English' : '简体中文'}).click();
  await page.setViewportSize({ width: 1280, height: 800 });
  if (!(await page.getByText('显示修改痕迹', { exact: true }).isVisible())) throw new Error('Comparison was not displayed');
  // A higher z-index cannot escape the title area's scrolling clip. Check the
  // complete tooltip box in both languages and in a short, narrow window.
  for (const language of ['zh-CN', 'en']) {
    await page.locator('.language-control > button').click(); await page.getByRole('menuitemradio', {name: language === 'en' ? 'English' : '简体中文'}).click();
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
  await page.locator('.language-control > button').click(); await page.getByRole('menuitemradio', {name: 'zh-CN' === 'en' ? 'English' : '简体中文'}).click();
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const language of ['zh-CN', 'en']) {
    await page.locator('.language-control > button').click(); await page.getByRole('menuitemradio', {name: language === 'en' ? 'English' : '简体中文'}).click();
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
  await page.locator('.language-control > button').click(); await page.getByRole('menuitemradio', {name: 'zh-CN' === 'en' ? 'English' : '简体中文'}).click();
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

  // Independent fresh synthetic document: speaker A / filler B / speaker A.
  await page.goto(`${vite.resolvedUrls.local[0]}?delete-between`);
  await page.getByText('我觉得先开始，把这份合成稿件核对清楚。', { exact: true }).waitFor();
  await page.getByRole('button', { name: /设置|偏好/ }).first().click();
  await page.getByRole('tab', { name: 'AI 辅助编辑', exact: true }).click();
  await page.getByLabel('启用 MCP 连接').check();
  await page.getByText('本机连接已就绪。请在所选 AI 软件中完成 Ripple 的添加和启用后使用。').waitFor();
  const deleteBetweenBaseline = await page.evaluate(async () => {
    const f=window.__fixture, manifest=await f.readManifest(), model=manifest.models.find(m=>m.id===manifest.activeModelId);
    const source=await f.readModelEdit(model.id,model.edits[0].id), originalModel=manifest.models.find(m=>m.id!==model.id);
    const original=await f.readModelOriginal(originalModel.id), dir=await f.root.handle.getDirectoryHandle('synthetic.transcript');
    return { source:JSON.stringify(source.transcript),original:JSON.stringify(original.transcript),
      snapshot:await (await (await dir.getFileHandle(model.original)).getFile()).text() };
  });
  const deleteBetween = await promisify(execFile)(python, [join(repo, 'scripts/fixtures/connector-mcp-check.py')],
    { cwd: repo, env: { ...process.env, RIPPLE_CONNECTOR_TEST_DIR: directory, RIPPLE_CONNECTOR_TEST_URL: backendUrl, RIPPLE_DELETE_BETWEEN_ONLY: '1' } });
  const afterDeletion = await page.evaluate(async () => {
    const f=window.__fixture, manifest=await f.readManifest(), model=manifest.models.find(m=>m.id===manifest.activeModelId);
    const source=await f.readModelEdit(model.id,model.edits[0].id), current=await f.readModelEdit(model.id,model.activeEditId);
    const originalModel=manifest.models.find(m=>m.id!==model.id), original=await f.readModelOriginal(originalModel.id);
    const transcriptDir=await f.root.handle.getDirectoryHandle('synthetic.transcript');
    const snapshot=await (await (await transcriptDir.getFileHandle(model.original)).getFile()).text();
    return { versions:model.edits.length,source:source.transcript.segments,result:current.transcript.segments,
      sourceSerialized:JSON.stringify(source.transcript),originalSerialized:JSON.stringify(original.transcript),snapshotSerialized:snapshot };
  });
  if(afterDeletion.versions!==2 || afterDeletion.source.length!==3 || afterDeletion.source[1].text!=='嗯' ||
    afterDeletion.result.length!==1 || afterDeletion.result[0].mergedFrom.join()!=='s1,s3' ||
    afterDeletion.result[0].text!==afterDeletion.source[0].text+'\n'+afterDeletion.source[2].text ||
    !afterDeletion.result[0].annotations.some(n=>n.id==='manual') || !afterDeletion.result[0].highlights.some(h=>h.id==='manual') ||
    afterDeletion.sourceSerialized!==deleteBetweenBaseline.source || afterDeletion.originalSerialized!==deleteBetweenBaseline.original ||
    afterDeletion.snapshotSerialized!==deleteBetweenBaseline.snapshot) throw new Error(`Delete-between source/version/mark preservation failed: ${JSON.stringify({versions:afterDeletion.versions,sourceCount:afterDeletion.source.length,resultCount:afterDeletion.result.length,mergedFrom:afterDeletion.result[0]?.mergedFrom,sourceUnchanged:afterDeletion.sourceSerialized===deleteBetweenBaseline.source,originalUnchanged:afterDeletion.originalSerialized===deleteBetweenBaseline.original,snapshotUnchanged:afterDeletion.snapshotSerialized===deleteBetweenBaseline.snapshot})}`);
  await page.getByLabel('启用 MCP 连接').uncheck();
  if(errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
  console.log(deleteBetween.stdout.trim());
  console.log('PASS: fresh same-speaker neighbors merged after deletion; source, original, import snapshot and retained marks preserved.');

  await page.goto(`${vite.resolvedUrls.local[0]}?delete-between&in-place`);
  await page.getByText('我觉得先开始，把这份合成稿件核对清楚。', { exact: true }).waitFor();
  await page.getByRole('button', { name: /设置|偏好/ }).first().click();
  await page.getByRole('tab', { name: 'AI 辅助编辑', exact: true }).click();
  await page.getByLabel('启用 MCP 连接').check();
  await page.getByText('本机连接已就绪。请在所选 AI 软件中完成 Ripple 的添加和启用后使用。').waitFor();
  const currentState = async () => page.evaluate(async () => {
    const f=window.__fixture,manifest=await f.readManifest(),model=manifest.models.find(m=>m.id===manifest.activeModelId);
    const current=await f.readModelEdit(model.id,model.activeEditId),originalModel=manifest.models.find(m=>m.id!==model.id);
    const original=await f.readModelOriginal(originalModel.id),dir=await f.root.handle.getDirectoryHandle('synthetic.transcript');
    return {count:model.edits.length,id:model.activeEditId,label:model.edits.find(e=>e.id===model.activeEditId).label,
      segments:current.transcript.segments,original:JSON.stringify(original.transcript),
      snapshot:await (await (await dir.getFileHandle(model.original)).getFile()).text() };
  });
  const currentBefore=await currentState();
  const inPlace=await promisify(execFile)(python,[join(repo,'scripts/fixtures/connector-mcp-check.py')],
    {cwd:repo,env:{...process.env,RIPPLE_CONNECTOR_TEST_DIR:directory,RIPPLE_CONNECTOR_TEST_URL:backendUrl,RIPPLE_DELETE_BETWEEN_ONLY:'1',RIPPLE_SAVE_MODE:'current_version'}});
  const currentSaved=await currentState();
  if(currentSaved.count!==1 || currentSaved.id!==currentBefore.id || currentSaved.label!==currentBefore.label ||
    currentSaved.segments.length!==1 || currentSaved.original!==currentBefore.original || currentSaved.snapshot!==currentBefore.snapshot)
    throw new Error('Current-version identity or original preservation failed');
  await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByText('AI 修改已保存到当前版本，可在编辑器中撤销。',{exact:true}).waitFor();
  await page.locator('.annotation-card').first().focus();await page.keyboard.press('Meta+z');await page.waitForTimeout(1000);
  const currentUndone=await currentState();
  if(currentUndone.count!==1 || JSON.stringify(currentUndone.segments)!==JSON.stringify(currentBefore.segments)) throw new Error('Current-version batch undo did not restore/persist the source');
  await page.keyboard.press('Meta+Shift+z');await page.waitForTimeout(1000);
  const currentRedone=await currentState();
  if(currentRedone.count!==1 || JSON.stringify(currentRedone.segments)!==JSON.stringify(currentSaved.segments)) throw new Error('Current-version redo did not persist');
  for(const language of ['en','zh-CN']){
    await page.locator('.language-control > button').click();await page.getByRole('menuitemradio',{name:language==='en'?'English':'简体中文'}).click();
    await page.getByRole('button',{name:language==='en'?'Settings':'设置',exact:true}).click();
    await page.getByRole('tab',{name:language==='en'?'AI-assisted editing':'AI 辅助编辑',exact:true}).click();
    const hint=page.getByText(language==='en'?/Before editing, it asks whether to save a new version/:/修改前会询问你：另存为新版本/);
    await hint.waitFor();
    if(await hint.evaluate(node=>node.scrollWidth>node.clientWidth))throw new Error('Save-mode capability hint clipped');
    await page.getByRole('dialog').getByRole('button',{name:language==='en'?'Close':'关闭',exact:true}).click();
  }
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'AI 辅助编辑',exact:true}).click();await page.getByLabel('启用 MCP 连接').uncheck();
  if(errors.length)throw new Error(`Browser errors: ${errors.join('; ')}`);
  console.log(inPlace.stdout.trim());
  console.log('PASS: current-version save kept one version/name/ID; one-step undo and redo persisted; original/import snapshot preserved; bilingual hints fit.');

  await page.goto(`${vite.resolvedUrls.local[0]}?delete-between&blocked-save`);
  await page.getByText('我觉得先开始，把这份合成稿件核对清楚。',{exact:true}).waitFor();
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'AI 辅助编辑',exact:true}).click();
  await page.getByLabel('启用 MCP 连接').check();
  await page.getByText('本机连接已就绪。请在所选 AI 软件中完成 Ripple 的添加和启用后使用。').waitFor();
  const blockedBefore=await currentState();
  await page.evaluate(async()=>{
    const f=window.__fixture,m=await f.readManifest(),model=m.models.find(x=>x.id===m.activeModelId),file=model.edits.find(e=>e.id===model.activeEditId).file;
    const dir=await f.root.handle.getDirectoryHandle('synthetic.transcript'),getFileHandle=dir.getFileHandle.bind(dir);
    dir.getFileHandle=async(name,options)=>{
      const h=await getFileHandle(name,options);
      if(name!==file)return h;
      const createWritable=h.createWritable.bind(h);
      return Object.assign(h,{createWritable:async()=>{
        const writable=await createWritable(),write=writable.write.bind(writable);
        writable.write=async(text)=>{
          // Allow pre-task draft flushing; block only the actual AI result write.
          if(typeof text==='string' && JSON.parse(text).transcript?.segments.length===1)
            throw new DOMException('Synthetic blocked write','NotAllowedError');
          await write(text);
        };
        return writable;
      }});
    };
  });
  const blocked=await promisify(execFile)(python,[join(repo,'scripts/fixtures/connector-mcp-check.py')],
    {cwd:repo,env:{...process.env,RIPPLE_CONNECTOR_TEST_DIR:directory,RIPPLE_CONNECTOR_TEST_URL:backendUrl,RIPPLE_DELETE_BETWEEN_ONLY:'1',RIPPLE_SAVE_MODE:'current_version',RIPPLE_EXPECT_SAVE_FAILURE:'1'}});
  const blockedAfter=await currentState();
  await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
  if(blockedAfter.count!==1 || JSON.stringify(blockedAfter.segments)!==JSON.stringify(blockedBefore.segments) ||
    blockedAfter.original!==blockedBefore.original || blockedAfter.snapshot!==blockedBefore.snapshot || await page.locator('.segment-text-editor').count()!==1)
    throw new Error('Failed current save overwrote disk/source, created a version or lost editor changes');
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'AI 辅助编辑',exact:true}).click();await page.getByLabel('启用 MCP 连接').uncheck();
  if(errors.length)throw new Error(`Browser errors: ${errors.join('; ')}`);
  console.log(blocked.stdout.trim());
  console.log('PASS: blocked current-version write returned failure; disk/original/snapshot unchanged, one version, editor changes retained.');

  await page.goto(`${vite.resolvedUrls.local[0]}?incremental`);
  await page.getByText('我觉得先开始，把这份合成稿件核对清楚。',{exact:true}).waitFor();
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'AI 辅助编辑',exact:true}).click();await page.getByLabel('启用 MCP 连接').check();
  await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
  const incrementalBefore=await currentState();
  const phase=async name=>{
    const result=await promisify(execFile)(python,[join(repo,'scripts/fixtures/connector-incremental-check.py')],
      {cwd:repo,env:{...process.env,RIPPLE_CONNECTOR_TEST_DIR:directory,RIPPLE_CONNECTOR_TEST_URL:backendUrl,RIPPLE_INCREMENTAL_PHASE:name}});
    return JSON.parse(result.stdout.trim());
  };
  const pending=await phase('prepare');if(pending.staged!==24)throw Error('Incremental batch size changed');
  await page.locator('.segment-text-editor').last().fill('Synthetic manual edit outside this batch.');
  const first=await phase('save');if(first.saved_segments!==24)throw Error('First checkpoint not persisted');
  await page.getByText('已保存 24／60 个片段',{exact:true}).waitFor();
  const progressBar=page.locator('.continuation-progress');
  if(await progressBar.getByRole('status').count()!==1)throw Error('Multiple progress rows displayed');
  await progressBar.getByText('第 2 批',{exact:true}).waitFor();
  if(await page.locator('.transcript-panel .continuation-progress').count())throw Error('Progress remains inside scrolling manuscript');
  const beforeScroll=await progressBar.boundingBox();
  await page.locator('.transcript-panel').evaluate(node=>{node.scrollTop=node.scrollHeight;});
  const afterScroll=await progressBar.boundingBox();
  if(!beforeScroll||!afterScroll||Math.abs(beforeScroll.y-afterScroll.y)>1)throw Error('Progress moved when manuscript scrolled');
  await page.locator('.transcript-panel').evaluate(node=>{node.scrollTop=0;});
  if(process.env.RIPPLE_PROGRESS_SCREENSHOTS) {
    await mkdir(process.env.RIPPLE_PROGRESS_SCREENSHOTS,{recursive:true});
    await page.screenshot({path:join(process.env.RIPPLE_PROGRESS_SCREENSHOTS,'running-zh.png')});
  }
  const firstState=await currentState();if(firstState.count!==2||firstState.segments.at(-1).text!=='Synthetic manual edit outside this batch.')throw Error('First batch created wrong versions or overwrote manual text');
  await phase('stage');
  await page.locator('.segment-text-editor').nth(24).fill('Synthetic overlapping manual correction.');
  await phase('conflict');await page.getByText(/本批内容已变化，编辑已暂停/).waitFor();
  await page.getByRole('button',{name:'查看待提交修改',exact:true}).click();
  await page.getByText('Synthetic overlapping manual correction.',{exact:true}).last().waitFor();
  if(!(await page.locator('.continuation-proposals').innerText()).includes('Synthetic AI checkpoint.'))throw Error('Conflicting AI proposal not retained/displayed');
  await page.getByRole('button',{name:'收起待提交修改',exact:true}).click();
  for(const language of ['en','zh-CN']) {
    await page.locator('.language-control > button').click();await page.getByRole('menuitemradio',{name:language==='en'?'English':'简体中文'}).click();
    await page.setViewportSize({width:850,height:650});
    const progress=page.locator('.continuation-progress');
    if(await progress.evaluate(node=>node.scrollWidth>node.clientWidth))throw Error('Continuation progress clipped');
    const resume=page.getByRole('button',{name:language==='en'?'Re-read batch and continue':'重读本批继续',exact:true});await resume.focus();await resume.hover();
    if(await progress.getByRole('status').count()!==1)throw Error('Progress rows accumulated in narrow window');
    if(process.env.RIPPLE_PROGRESS_SCREENSHOTS)await page.screenshot({path:join(process.env.RIPPLE_PROGRESS_SCREENSHOTS,`paused-${language}.png`)});

  }
  await page.getByRole('button',{name:'重读本批继续',exact:true}).click();await phase('stage');await phase('save');
  await page.getByText('已保存 48／60 个片段',{exact:true}).waitFor();
  await phase('stage');
  // Remount the actual App against its saved fixture files: no controller/task memory survives.
  await page.evaluate(()=>window.__fixture.remount());
  await page.getByText('已保存 48／60 个片段',{exact:true}).waitFor();
  const last=await phase('save');if(last.saved_segments!==60||last.state!=='completed')throw Error('Saved task did not resume/complete after App remount');
  const final=await currentState();
  if(final.count!==2||final.original!==incrementalBefore.original||final.snapshot!==incrementalBefore.snapshot||
     final.segments.at(-1).text!=='Synthetic manual edit outside this batch.'||
     !final.segments[24].text.startsWith('Synthetic overlapping manual correction.'))throw Error('Incremental save did not preserve source/snapshot/manual edits');
  const journals=await page.evaluate(async()=>{
    const dir=await window.__fixture.root.handle.getDirectoryHandle('synthetic.transcript'),folder=await dir.getDirectoryHandle('ai-continuation-tasks');const tasks=[];
    for await(const [,handle]of folder.entries())tasks.push(JSON.parse(await(await handle.getFile()).text()));return tasks;
  });
  if(journals.length!==1||journals[0].done.length!==60||journals[0].held.length!==1)throw Error('Durable continuation journal lost progress or held proposal');
  await page.getByText('编辑已完成，全部批次已保存。',{exact:true}).waitFor();
  await page.locator('.continuation-progress').getByText('已保存 3 批',{exact:true}).waitFor();
  await page.evaluate(async()=>{
    const root=window.__fixture.root.handle,dir=await root.getDirectoryHandle('synthetic.transcript'),folder=await dir.getDirectoryHandle('ai-continuation-tasks');
    let source;for await(const [,handle]of folder.entries()){source=JSON.parse(await(await handle.getFile()).text());break;}
    for(let i=0;i<3;i++){
      const old={...source,id:`synthetic-history-${i}`,ids:source.ids.slice(0,i+1),done:source.done.slice(0,i+1),updated:'2026-01-01T00:00:00.000Z'};
      const handle=await folder.getFileHandle(`${old.id}.json`,{create:true}),w=await handle.createWritable();await w.write(JSON.stringify(old));await w.close();
    }
    window.__fixture.remount();
  });
  await page.getByText('编辑已完成，全部批次已保存。',{exact:true}).waitFor();
  if(await page.locator('.continuation-progress').getByRole('status').count()!==1)throw Error('Completed history accumulated after reopening');
  await page.getByText('已保存 60／60 个片段',{exact:true}).waitFor();
  if(process.env.RIPPLE_PROGRESS_SCREENSHOTS)await page.screenshot({path:join(process.env.RIPPLE_PROGRESS_SCREENSHOTS,'completed-zh.png')});

  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'AI 辅助编辑',exact:true}).click();await page.getByLabel('启用 MCP 连接').uncheck();
  if(errors.length)throw new Error(`Browser errors: ${errors.join('; ')}`);
  console.log('PASS: real SDK incremental 60-segment saves into one work version; manual outside edits preserved, overlap paused/proposal visible, bilingual narrow progress and App-remount recovery passed.');
  const versions=await page.evaluate(async()=>{const f=window.__fixture,m=(await f.readManifest()).models.find(m=>m.id===f.made.model.id);return m.edits.map(e=>({id:e.id,label:e.label}));});
  await page.evaluate(()=>window.__fixture.showBoard());
  for(const version of versions)await page.getByRole('button',{name:`打开 转录稿 ${version.label}`,exact:true}).waitFor();
  if(await page.locator(`[data-root-version-id="${await page.evaluate(()=>window.__fixture.made.model.id)}:${versions[0].id}"]`).count()!==1)throw new Error('Active AI revision reversed project hierarchy');
  await page.setViewportSize({width:850,height:850});
  const revision=page.getByRole('button',{name:`打开 转录稿 ${versions[0].label}`,exact:true});
  await revision.hover();await revision.focus();
  await page.keyboard.press('Enter');
  await page.locator('.segment-text-editor').first().waitFor();
  const selected=await page.evaluate(async()=>{const f=window.__fixture,m=(await f.readManifest()).models.find(m=>m.id===f.made.model.id);return m.activeEditId;});
  if(selected!==versions[0].id)throw new Error('Project page opened a different version');
  await page.locator('.language-control > button').click();await page.getByRole('menuitemradio',{name:'English'}).click();
  await page.evaluate(()=>window.__fixture.showBoard());
  for(const version of versions)await page.getByRole('button',{name:`Open Transcript ${version.label}`,exact:true}).waitFor();
  const ai=page.getByRole('button',{name:`Open Transcript ${versions[1].label}`,exact:true});await ai.hover();await ai.focus();
  const box=await ai.boundingBox();if(!box||box.x<0||box.x+box.width>850)throw new Error('Project version row clipped');
  await ai.click();await page.locator('.segment-text-editor').first().waitFor();
  const actual=await page.evaluate(async()=>{const f=window.__fixture,m=(await f.readManifest()).models.find(m=>m.id===f.made.model.id);return {id:m.activeEditId,text:document.querySelector('.segment-text-editor')?.textContent};});
  if(actual.id!==versions[1].id||!actual.text.includes('Synthetic AI checkpoint.'))throw new Error('AI version not opened correctly');
  if(errors.length)throw new Error(`Browser errors: ${errors.join('; ')}`);
  console.log('PASS: project page lists manual and AI versions in both languages; narrow rows, hover/focus and opening exact saved version passed.');

} finally {
  await browser?.close();
  await vite?.close();
  backend.kill('SIGTERM');
  await rm(directory, { recursive: true, force: true });
}
