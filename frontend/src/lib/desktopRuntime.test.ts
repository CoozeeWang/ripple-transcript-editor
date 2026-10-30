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
    ? 'Ripple’s local service couldn’t start. Restart Ripple or check the application logs.'
    : 'Ripple 本地服务未能启动。请重新启动 Ripple，或查看应用日志。');
});
it('forwards the native open-project action to the workspace once', async () => {
  let openProject: ((event:{payload:string}) => void) | undefined;
  let openRecent: ((event:{payload:string}) => void) | undefined;
  const listen = vi.fn(async (name: string, callback: (event:{payload:string}) => void) => {
    if (name === 'ripple-open-project') openProject = callback;
    if (name === 'ripple-open-recent-project') openRecent = callback;
    return vi.fn();
  });
  Object.assign(window, { __TAURI__: { core: { invoke: vi.fn(async () => true) }, event: { listen } } });
  await installDesktopRuntime();
  const received = vi.fn();
  window.addEventListener('ripple-open-project', received, { once: true });
  openProject?.({payload:''});
  expect(received).toHaveBeenCalledOnce();
  expect(listen).toHaveBeenCalledWith('ripple-open-project', expect.any(Function));
  const receivedRecent = vi.fn();
  window.addEventListener('ripple-open-recent-project', receivedRecent, { once: true });
  openRecent?.({payload:'synthetic-one'});
  expect((receivedRecent.mock.calls[0][0] as CustomEvent<string>).detail).toBe('synthetic-one');
});

it('waits for saves before normal close and cancels closing on failure', async () => {
  const { registerNormalClose } = await import('./normalClose');
  let close: (() => void) | undefined;
  const invoke = vi.fn(async () => true), listen = vi.fn(async (name: string, callback: () => void) => {
    if (name === 'ripple-normal-close') close = callback;
    return vi.fn();
  });
  Object.assign(window, { __TAURI__: { core: { invoke }, event: { listen } } });
  await installDesktopRuntime();
  let finish: () => void = () => {};
  const release = registerNormalClose(() => new Promise<void>(resolve => { finish = resolve; }));
  close?.(); await Promise.resolve(); expect(invoke).not.toHaveBeenCalledWith('finish_normal_close', expect.anything());
  finish(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(invoke).toHaveBeenCalledWith('finish_normal_close', { allow: true }); release();
  const cancel = registerNormalClose(async () => { throw Error('synthetic save failed'); });
  close?.(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(invoke).toHaveBeenLastCalledWith('finish_normal_close', { allow: false }); cancel();
});
