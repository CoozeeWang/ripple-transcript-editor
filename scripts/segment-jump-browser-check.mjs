/** Synthetic App regression: inline segment navigation, caret, filtering and playback. */
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
const directory=await mkdtemp(join(tmpdir(),'ripple-segment-jump-synthetic-'));
const port=Number(process.env.RIPPLE_JUMP_TEST_PORT||60987),api=`http://127.0.0.1:${port}`;
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
 const screenshotDir=process.env.RIPPLE_JUMP_SCREENSHOT_DIR;
 if(screenshotDir)await (await import('node:fs/promises')).mkdir(screenshotDir,{recursive:true});
 for(const language of ['zh-CN','zh-TW','en']) {
  const page=await browser.newPage({viewport:{width:1280,height:840}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${vite.resolvedUrls.local[0]}?merge-filter`);
  await page.locator('#segment-s200').waitFor({state:'attached'});
  await page.locator('.language-control > button').click();
  await page.getByRole('menuitemradio',{name:language==='en'?'English':language==='zh-TW'?'繁體中文（台灣）':'简体中文',exact:true}).click();
  const input=page.locator('.segment-jump input');
  const before=await page.locator('.segment-text-editor').allTextContents();
  const go=async number=>{await input.fill(String(number));await input.press('Enter');};
  const target=number=>page.locator(`#segment-s${number}`);
  const assertJump=async number=>{
    await page.waitForFunction(id=>document.activeElement?.getAttribute('data-segment-id')===id,`s${number}`);
    const state=await target(number).evaluate(el=>{
      const p=el.closest('.transcript-panel'),r=el.getBoundingClientRect(),b=p.getBoundingClientRect(),e=el.querySelector('[data-transcript-editor]');
      return {start:e.selectionStart,end:e.selectionEnd,center:Math.abs(r.top+r.height/2-b.top-p.clientHeight/2),selected:el.classList.contains('segment--selected')};
    });
    if(state.start!==0||state.end!==0||!state.selected)throw Error(`Caret/selection: ${JSON.stringify(state)}`);
    if(number>1&&number<300&&state.center>3)throw Error(`Not centered: ${JSON.stringify(state)}`);
  };
  await go(200);await assertJump(200);
  await go(1);await assertJump(1);await go(300);await assertJump(300);
  for(const bad of ['0','301','2.5']){await go(bad);if(!await input.evaluate(el=>!el.validity.valid))throw Error('Invalid number accepted');}
  await go(200);await assertJump(200); // correction clears native validation
  await input.fill('101');await input.dispatchEvent('keydown',{key:'Enter',isComposing:true});
  if(await input.inputValue()!=='101')throw Error('IME Enter navigated');await input.press('Escape');
  // Hidden speakers keep original manuscript numbering; reveal only the target.
  const cards=page.locator('.speaker-card');await cards.nth(1).hover();await cards.nth(1).locator('.speaker-hide-icon').click();
  await cards.nth(0).hover();await cards.nth(0).locator('.speaker-hide-icon').click();
  await go(200);await assertJump(200);
  if(await page.locator('#segment-s199').count())throw Error('Jump unnecessarily revealed another speaker');
  await cards.nth(0).hover();await cards.nth(0).locator('.speaker-hide-icon').click();
  // Layout and visual states: default, focused, hover and invalid; no extra button.
  for(const viewport of [{width:1280,height:840},{width:850,height:520}]){
    await page.setViewportSize(viewport);
    const layout=await input.evaluate(el=>{const r=el.getBoundingClientRect(),h=el.closest('.transcript-header-fixed').getBoundingClientRect(),g=el.closest('.segment-navigation').getBoundingClientRect();return {fits:r.left>=0&&r.right<=innerWidth&&r.top>=h.top&&r.bottom<=h.bottom,group:g.width,input:[r.top,r.bottom],header:[h.top,h.bottom],headerScroll:el.closest('.transcript-header-fixed').scrollTop};});
    if(!layout.fits&&screenshotDir)await page.screenshot({path:join(screenshotDir,'clipped.png')});
    if(!layout.fits)throw Error(`Input clipped ${language} ${JSON.stringify(viewport)} ${JSON.stringify(layout)}`);
    await input.focus();await input.hover();
    if(screenshotDir)await page.screenshot({path:join(screenshotDir,`jump-${language}-${viewport.width}.png`)});
  }
  await page.setViewportSize({width:1280,height:840});
  const play=page.locator('.play-button');
  await go(1);await assertJump(1);
  await play.click();await page.waitForFunction(()=>!document.querySelector('audio').paused);
  await go(200);await assertJump(200);
  await page.waitForTimeout(650);
  const audio=await page.locator('audio').evaluate(el=>({time:el.currentTime,paused:el.paused}));
  if(audio.paused||audio.time>5)throw Error(`Jump changed playback ${JSON.stringify(audio)}`);
  await assertJump(200);await play.click();
  if(!await page.locator('.comparison-toggle').isEnabled())throw Error('Synthetic comparison baseline unavailable');
  await page.locator('.comparison-toggle').click();
  await page.waitForFunction(()=>document.querySelector('.comparison-toggle')?.getAttribute('aria-pressed')==='true');
  await go(1);await assertJump(1);await go(200);await assertJump(200);
  await page.locator('.comparison-toggle').click();
  if(JSON.stringify(await page.locator('.segment-text-editor').allTextContents())!==JSON.stringify(before))throw Error('Navigation changed transcript text');
  // Read-only original still navigates, without turning text editable.
  await page.locator('.version-picker--current .version-picker-trigger').click();
  await page.locator('.version-picker--current .version-picker-row--original .version-picker-option').first().click();
  await page.locator('#segment-s200 .segment-text-readonly').waitFor();await go(200);
  await page.waitForFunction(()=>document.activeElement?.classList.contains('segment-text-readonly'));
  if(await page.locator('[data-transcript-editor]').count())throw Error('Original became editable');
  if(errors.length)throw Error(errors.join('\n'));
  console.log(`${language}: numbered jump/caret, boundaries, invalid/IME, hidden speakers, short viewport, continuous audio, comparison and original read-only passed`);
  await page.close();
 }
} finally {
 await browser?.close();await vite?.close();backend.kill('SIGTERM');await rm(directory,{recursive:true,force:true});
}
