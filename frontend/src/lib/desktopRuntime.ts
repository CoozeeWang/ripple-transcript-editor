import { installDesktopFilePickers, nativeDesktopAvailable } from './desktopFs';

const API_ROOT = 'http://127.0.0.1:18701';

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

  const invoke = (window as unknown as { __TAURI__: { core: { invoke: (name: string) => Promise<boolean> } } }).__TAURI__.core.invoke;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await invoke('backend_ready')) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Ripple 后台未能启动，请查看应用日志。');
}
