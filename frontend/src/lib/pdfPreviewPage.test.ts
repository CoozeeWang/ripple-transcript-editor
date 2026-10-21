// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { renderPdfHtml, buildExportModel } from './export';
import { setInterfaceLanguage } from '../i18n';

afterEach(() => { vi.unstubAllGlobals(); setInterfaceLanguage('zh-CN'); document.body.replaceChildren(); });

it.each(['zh-CN', 'en'] as const)('renders the native preview and supports a localized failed-print retry in %s', async language => {
  setInterfaceLanguage(language);
  const html = renderPdfHtml(buildExportModel({ audio: { filename: 'synthetic.wav', duration: 1 }, speakers: [], segments: [{ id: 's', speaker_id: '', start: 0, end: 1, text: '<script>synthetic</script>' }] }, null));
  const errorLabel = language === 'en' ? 'Synthetic print failure' : '合成打印错误';
  const invoke = vi.fn().mockRejectedValueOnce(new Error('native_failure')).mockResolvedValue(undefined);
  Object.assign(window, { __RIPPLE_PRINT_PREVIEW__: { html, errorLabel }, __TAURI__: { core: { invoke } } });
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
  new Function(readFileSync('public/print-preview.js', 'utf8'))();
  await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toBe(errorLabel));
  expect(document.querySelector('button')?.textContent).toBe(language === 'en' ? 'Print' : '打印');
  expect(document.querySelector('button')?.hasAttribute('onclick')).toBe(false);
  expect(document.querySelector('.body')?.textContent).toContain('<script>synthetic</script>');
  expect(document.querySelector('script')).toBeNull();
  (document.querySelector('button') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  expect((document.querySelector('[role="alert"]') as HTMLElement).hidden).toBe(true);
});
