import { installDesktopUpdateBridge } from './desktopUpdates';
import { installNativeMenuLanguage } from './nativeMenu';
import { msg } from '../i18n';
import { installDesktopFilePickers, nativeDesktopAvailable } from './desktopFs';

// Development uses Vite's same-origin API proxy; release uses the bundled service.
const API_ROOT = import.meta.env.DEV ? '' : 'http://127.0.0.1:18701';

let removeMenuLanguage: (() => void) | undefined;
let removeOpenProjectMenu: (() => void) | undefined;
let removeRecentProjectMenu: (() => void) | undefined;

function apiUrl(url: string): string {
  return url.startsWith('/api/') ? `${API_ROOT}${url}` : url;
}

export async function installDesktopRuntime(): Promise<void> {
  if (!nativeDesktopAvailable()) return;
  installDesktopFilePickers();
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string') return originalFetch(apiUrl(input), init);
    if (input instanceof URL) return originalFetch(new URL(apiUrl(input.toString())), init);
    if (input.url.startsWith(`${location.origin}/api/`)) return originalFetch(new Request(apiUrl(new URL(input.url).pathname), input), init);
    return originalFetch(input, init);
  };
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    return Reflect.apply(originalOpen, this, [method, typeof url === 'string' ? apiUrl(url) : url, ...rest]);
  } as typeof XMLHttpRequest.prototype.open;

  const invoke = (window as unknown as { __TAURI__: { core: { invoke: (name: string, args?: Record<string, unknown>) => Promise<boolean> } } }).__TAURI__.core.invoke;
  removeMenuLanguage?.();
  removeOpenProjectMenu?.();
  removeRecentProjectMenu?.();
  const tauriEvents = (window as unknown as { __TAURI__: { event?: { listen: (name: string, callback: (event: {payload:string}) => void) => Promise<() => void> } } }).__TAURI__.event;
  removeOpenProjectMenu = tauriEvents ? await tauriEvents.listen('ripple-open-project', () => window.dispatchEvent(new Event('ripple-open-project'))) : undefined;
  removeRecentProjectMenu = tauriEvents ? await tauriEvents.listen('ripple-open-recent-project', event => window.dispatchEvent(new CustomEvent('ripple-open-recent-project', { detail: event.payload }))) : undefined;
  const removeUpdateBridge = await installDesktopUpdateBridge();
  removeMenuLanguage = installNativeMenuLanguage(invoke);
  if (import.meta.hot) import.meta.hot.dispose(removeUpdateBridge);
  if (import.meta.hot) import.meta.hot.dispose(() => removeMenuLanguage?.());
  if (import.meta.hot) import.meta.hot.dispose(() => removeOpenProjectMenu?.());
  if (import.meta.hot) import.meta.hot.dispose(() => removeRecentProjectMenu?.());
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await invoke('backend_ready')) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(msg('desktopRuntime.backendUnavailable'));
}
