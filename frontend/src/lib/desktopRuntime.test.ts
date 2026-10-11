// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { installDesktopRuntime } from './desktopRuntime';
import { setInterfaceLanguage } from '../i18n';
vi.mock('./desktopFs', () => ({ nativeDesktopAvailable: () => true, installDesktopFilePickers: vi.fn() }));
const originalFetch = window.fetch;
const originalOpen = XMLHttpRequest.prototype.open;
afterEach(async () => {
  vi.useRealTimers(); window.fetch = originalFetch; XMLHttpRequest.prototype.open = originalOpen;
  delete (window as Window & { __TAURI__?: unknown }).__TAURI__;
  await setInterfaceLanguage('zh-CN');
});
it.each(['zh-CN', 'en'] as const)('localizes service startup failure in %s', async language => {
  await setInterfaceLanguage(language);
  vi.useFakeTimers();
  Object.assign(window, { __TAURI__: { core: { invoke: vi.fn(async () => false) } } });
  const failure = installDesktopRuntime().catch(error => error);
  await vi.runAllTimersAsync();
  expect((await failure).message).toBe(language === 'en'
    ? 'Ripple’s local service could not start. Restart Ripple or check the application logs.'
    : 'Ripple 后台未能启动。请重新打开 Ripple，或查看应用日志。');
});
