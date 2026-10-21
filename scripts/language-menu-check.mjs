/** Synthetic language-selector regression; native popup visuals need desktop acceptance. */
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from '../frontend/node_modules/vite/dist/node/index.js';
import react from '../frontend/node_modules/@vitejs/plugin-react/dist/index.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (!process.env.RIPPLE_PLAYWRIGHT_MODULE) throw new Error('Set RIPPLE_PLAYWRIGHT_MODULE to an installed Playwright module.');
const { chromium } = await import(pathToFileURL(process.env.RIPPLE_PLAYWRIGHT_MODULE));
const directory = await mkdtemp(join(tmpdir(), 'ripple-language-synthetic-'));
let browser, vite;
try {
  await writeFile(join(directory, 'entry.tsx'), `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { LanguageControl } from '${repo}/frontend/src/components/LanguageControl';
    import '${repo}/frontend/src/styles.css';
    import '${repo}/frontend/src/components/projectWorkspace.css';
    createRoot(document.getElementById('root')).render(<>
      <div data-testid="welcome" className="project-home project-home--welcome"><LanguageControl welcome /></div>
      <div data-testid="project" className="project-home"><header className="project-home__header"><nav><LanguageControl /></nav></header></div>
      <div data-testid="editor" className="app-shell"><header className="topbar"><div className="toolbar"><LanguageControl /></div></header></div>
      <button>End of synthetic focus sequence</button>
    </>);
  `);
  await writeFile(join(directory, 'index.html'), '<!doctype html><html><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>');
  vite = await createServer({ configFile: false, root: directory, plugins: [react()],
    cacheDir: join(directory, 'vite-cache'), optimizeDeps: { include: ['react', 'react-dom/client'] },
    resolve: { alias: { react: join(repo, 'frontend/node_modules/react'), 'react-dom': join(repo, 'frontend/node_modules/react-dom') } },
    server: { host: '127.0.0.1', port: 0, fs: { allow: [repo, directory] } } });
  await vite.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.goto(vite.resolvedUrls.local[0]);
  for (const variant of ['welcome', 'project', 'editor']) {
    const control = page.getByTestId(variant).locator('.language-control');
    const trigger=control.locator('button[aria-haspopup="menu"]');
    for (const language of ['zh-CN','en']) {
      await trigger.click();
      const option=control.getByRole('menuitemradio',{name:language==='en'?'English':'简体中文'});
      const style=await option.evaluate(element=>({font:getComputedStyle(element).fontSize,weight:getComputedStyle(element).fontWeight}));
      if(Math.abs(parseFloat(style.font)-13.76)>.5||style.weight!=='400')throw new Error(`${variant}: menu typography`);
      await option.click();
      if(await trigger.getAttribute('aria-expanded')!=='false')throw new Error('Menu did not close');
      await trigger.press('ArrowDown');
      const selected=control.getByRole('menuitemradio',{name:language==='en'?'English':'简体中文'});
      if(await selected.getAttribute('aria-checked')!=='true')throw new Error('Language not selected');
      await selected.press('Escape');
      if(await trigger.evaluate(element=>getComputedStyle(element).outlineStyle)!=='solid')throw new Error('Keyboard focus not visible');
    }
  }
  console.log('Language selector: three variants, both languages, app-menu typography, single-click selection and keyboard focus passed. Desktop visuals are checked separately.');
} finally {
  await browser?.close();
  await vite?.close();
  await rm(directory, { recursive: true, force: true });
}
