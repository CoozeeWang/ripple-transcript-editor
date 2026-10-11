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
    const select = control.locator('select');
    for (const language of ['zh-CN', 'en']) {
      await select.selectOption(language);
      const result = await select.evaluate(element => {
        const root = getComputedStyle(document.documentElement);
        return [element, ...element.options].map(node => {
          const style = getComputedStyle(node);
          return { size: parseFloat(style.fontSize), expected: parseFloat(root.fontSize) * 0.86,
            weight: style.fontWeight, family: style.fontFamily,
            expectedFamily: root.getPropertyValue('--font-sans').trim() };
        });
      });
      // Native select text can round to an integer pixel; the inherited icon
      // size (1.05rem) remains well outside this half-pixel allowance.
      if (result.some(item => Math.abs(item.size - item.expected) > 0.5 || item.weight !== '400' || item.family !== item.expectedFamily)) {
        throw new Error(`${variant}/${language}: incorrect menu typography ${JSON.stringify(result)}`);
      }
      if (await select.inputValue() !== language) throw new Error('Language selection failed');
      await select.focus();
      await select.press('Tab');
      await page.keyboard.press('Shift+Tab');
      if (await control.evaluate(element => getComputedStyle(element).outlineStyle) !== 'solid') {
        throw new Error(`${variant}: keyboard focus is not visible`);
      }
    }
  }
  console.log('Language selector: three variants, both languages, select/option typography and keyboard focus passed. Native popup visual acceptance remains separate.');
} finally {
  await browser?.close();
  await vite?.close();
  await rm(directory, { recursive: true, force: true });
}
