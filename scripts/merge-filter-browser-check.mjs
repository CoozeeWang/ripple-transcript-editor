/** Synthetic App regression: explicit merges and stable reading through speaker filters. */
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from '../frontend/node_modules/vite/dist/node/index.js';
import react from '../frontend/node_modules/@vitejs/plugin-react/dist/index.js';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(!process.env.RIPPLE_PLAYWRIGHT_MODULE)throw Error('Set RIPPLE_PLAYWRIGHT_MODULE to an installed Playwright module.');
const {chromium}=await import(pathToFileURL(process.env.RIPPLE_PLAYWRIGHT_MODULE));
const directory=await mkdtemp(join(tmpdir(),'ripple-merge-filter-synthetic-'));
const port=Number(process.env.RIPPLE_FILTER_TEST_PORT||60986),api=`http://127.0.0.1:${port}`;
const backend=spawn(join(repo,'backend/.venv/bin/python'),['-m','uvicorn','app.main:app','--host','127.0.0.1','--port',String(port)],
 {cwd:join(repo,'backend'),env:{...process.env,RIPPLE_DATA_DIR:join(directory,'data'),PYTHONDONTWRITEBYTECODE:'1'},stdio:'ignore'});
let vite,browser;
try {
 let ready=false;
 for(let i=0;i<80;i++) {try{if((await fetch(`${api}/api/health`)).ok){ready=true;break;}}catch{} await new Promise(r=>setTimeout(r,100));}
 if(!ready||backend.exitCode!==null)throw Error('Synthetic backend did not start; choose a free test port.');
 await writeFile(join(directory,'entry.tsx'),(await readFile(join(repo,'scripts/fixtures/connector-browser.tsx'),'utf8')).replaceAll('__REPO__',repo));
 await writeFile(join(directory,'index.html'),'<!doctype html><html><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>');
 vite=await createServer({configFile:false,root:directory,plugins:[react()],publicDir:join(repo,'frontend/public'),cacheDir:join(directory,'cache'),
  optimizeDeps:{include:['react','react-dom/client']},resolve:{alias:{react:join(repo,'frontend/node_modules/react'),'react-dom':join(repo,'frontend/node_modules/react-dom')}},
  server:{host:'127.0.0.1',port:0,fs:{allow:[repo,directory]},proxy:{'/api':api}}});
 await vite.listen();browser=await chromium.launch({channel:'chrome',headless:true});
 for(const language of ['zh-CN','zh-TW','en']) {
  const page=await browser.newPage({viewport:{width:1280,height:840}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.confirm=async()=>false;}); // Reproduce native Promise semantics.
  await page.goto(`${vite.resolvedUrls.local[0]}?merge-filter`);
  await page.locator('#segment-s200').waitFor({state:'attached'});
  await page.locator('.language-control > button').click();
  await page.getByRole('menuitemradio',{name:language==='en'?'English':language==='zh-TW'?'繁體中文（台灣）':'简体中文',exact:true}).click();
  const count=()=>page.locator('.segment[id]').count();
  await page.locator('#segment-s1 .segment-actions button').nth(1).click();
  const dialog=page.locator('dialog[open]');await dialog.waitFor();
  if(await count()!==300)throw Error('Merged before confirmation');
  if(!await dialog.locator('[data-dialog-initial-focus]').evaluate(el=>el===document.activeElement))throw Error('Unsafe initial focus');
  await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
  if(await count()!==300)throw Error('Cancel changed text');
  await page.locator('#segment-s1 .segment-actions button').nth(1).click();
  await dialog.locator('button').last().click();
  if(await count()!==299)throw Error('Confirmed merge failed');
  await page.locator('.transcript-panel').click({position:{x:5,y:5}});await page.keyboard.press('Meta+z');
  await page.waitForFunction(()=>document.querySelectorAll('.segment[id]').length===300);
  const anchor=page.locator('#segment-s200');
  await anchor.evaluate(el=>{const p=el.closest('.transcript-panel'),r=el.getBoundingClientRect(),b=p.getBoundingClientRect();p.scrollTop+=r.top-b.top-p.clientHeight/2+r.height/2;});
  const top=()=>anchor.evaluate(el=>el.getBoundingClientRect().top);
  const before=await top(),card=page.locator('.speaker-card').first();await card.hover();
  await card.locator('.speaker-hide-icon').click();
  if(Math.abs(await top()-before)>2)throw Error(`${language}: hide shifted reading position`);
  await card.locator('.speaker-hide-icon').click();
  if(Math.abs(await top()-before)>2)throw Error(`${language}: show shifted reading position`);
  // The reading position belongs to the viewport, even with s1 selected after undo.
  if(errors.length)throw Error(errors.join('\n'));
  console.log(`${language}: explicit/cancelled merge, undo, hide/show with segment 200 pixel position preserved`);
  await page.close();
 }
} finally {
 await browser?.close();await vite?.close();backend.kill('SIGTERM');await rm(directory,{recursive:true,force:true});
}
