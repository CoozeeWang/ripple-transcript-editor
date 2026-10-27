// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { forgetRecentProject, handleValue, recentProjects, rememberProject, type OpenProject } from './projectStore';
import { decodeNativeHandles, encodeNativeHandles, installDesktopFilePickers, NativeDirectoryHandle } from './desktopFs';
import { NATIVE_RECENTS_KEY, readNativeRecentProjects, writeNativeRecentProjects } from './nativeRecentProjects';
const legacy = new Map<string, unknown>();
const writes = vi.fn();
beforeEach(() => {
  localStorage.clear(); legacy.clear(); writes.mockReset();
  Object.assign(window, { __TAURI__: { core: { invoke: vi.fn(async () => true) } } });
  installDesktopFilePickers();
  vi.stubGlobal('indexedDB', { open() {
    const request: Record<string, unknown> = {};
    const db = { close() {}, transaction() {
      const tx: Record<string, unknown> = {};
      const finish = () => queueMicrotask(() => (tx.oncomplete as (() => void))?.());
      tx.objectStore = () => ({ get(key: string) { const req = { result: legacy.get(key) }; finish(); return req; },
        put(value: unknown, key: string) { writes(value, key); legacy.set(key, value); finish(); return {}; } });
      return tx;
    } };
    queueMicrotask(() => { request.result = db; (request.onsuccess as (() => void))(); });
    return request;
  } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); delete (window as Window & { __TAURI__?: unknown }).__TAURI__; localStorage.clear(); });
function project(id: string, root = '/synthetic/projects'): OpenProject {
  return { directory: new NativeDirectoryHandle(root, [`${id}.ripple`]) as unknown as FileSystemDirectoryHandle, data: { kind: 'ripple-project', schemaVersion: 1, id, title: `Synthetic ${id}`, description: '', revision: 0, interviews: [] } };
}
function item(p: OpenProject) { return { id: p.data.id, title: p.data.title, directory: p.directory }; }

it.each(['/synthetic/projects', 'C:\\Synthetic\\Projects'])('migrates legacy entries and persists a newly opened project without IndexedDB writes (%s)', async root => {
  const old = project('older', root), next = project('newer', root);
  legacy.set('recent', encodeNativeHandles([item(old)]));
  writes.mockImplementation(() => { throw new Error('Synthetic legacy IndexedDB write failed'); });
  await rememberProject(next);
  expect(writes).not.toHaveBeenCalled();
  const saved = localStorage.getItem(NATIVE_RECENTS_KEY)!;
  expect(JSON.parse(saved).items.map((row: { id: string }) => row.id)).toEqual(['newer', 'older']);
  expect(legacy.get('recent')).toEqual(encodeNativeHandles([item(old)]));
  // Read again from persisted JSON after losing the previous database access.
  vi.stubGlobal('indexedDB', { open() { throw new Error('Synthetic unavailable database'); } });
  const entries = await recentProjects();
  expect(entries.map(row => row.id)).toEqual(['newer', 'older']);
  expect(encodeNativeHandles(entries[0].directory)).toEqual({ __rippleNativeHandle: true, root, parts: ['newer.ripple'], kind: 'directory' });
  expect(await (entries[0].directory as unknown as NativeDirectoryHandle).queryPermission({ mode: 'readwrite' })).toBe('granted');
});
it('does not resurrect removed entries from the untouched legacy list, including after emptying recents', async () => {
  const p = project('one'); legacy.set('recent', encodeNativeHandles([item(p)]));
  await forgetRecentProject('one');
  expect(await recentProjects()).toEqual([]); expect(readNativeRecentProjects()).toEqual([]);
  expect(legacy.get('recent')).toEqual(encodeNativeHandles([item(p)]));
});
it('keeps the most recently used name once and bounds history to twenty entries', async () => {
  for (let n = 0; n < 23; n++) await rememberProject(project(`project-${n}`));
  const p = project('project-4'); p.data.title = 'Synthetic renamed project'; await rememberProject(p);
  const recent = await recentProjects();
  expect(recent).toHaveLength(20); expect(recent[0].title).toBe(p.data.title);
  expect(recent.filter(row => row.id === p.data.id)).toHaveLength(1);
});
it('reports preference write failures and leaves earlier persisted history unchanged', async () => {
  const old = project('old'); await rememberProject(old);
  const before = localStorage.getItem(NATIVE_RECENTS_KEY), changed = vi.fn();
  window.addEventListener('ripple-recent-projects-changed', changed);
  try {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new DOMException('Synthetic quota', 'QuotaExceededError'); });
    await expect(rememberProject(project('new'))).rejects.toMatchObject({ name: 'QuotaExceededError' });
    expect(localStorage.getItem(NATIVE_RECENTS_KEY)).toBe(before); expect(changed).not.toHaveBeenCalled();
  } finally { window.removeEventListener('ripple-recent-projects-changed', changed); }
});
it('does not claim persistence if preference read-back differs from the write', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {});
  expect(() => writeNativeRecentProjects([item(project('one'))])).toThrow();
  expect(localStorage.getItem(NATIVE_RECENTS_KEY)).toBeNull();
});
it.each(['{invalid', '{"version":2,"items":[]}', '{"version":1,"items":[{"id":"one","title":"Synthetic","directory":{"__rippleNativeHandle":true,"root":"/synthetic","kind":"directory","parts":[".."]}}]}'])('keeps an unreadable record available for diagnosis without overwriting it', async raw => {
  localStorage.setItem(NATIVE_RECENTS_KEY, raw);
  await expect(rememberProject(project('one'))).rejects.toThrow();
  expect(localStorage.getItem(NATIVE_RECENTS_KEY)).toBe(raw); expect(writes).not.toHaveBeenCalled();
});
it('keeps browser recents on IndexedDB and does not serialize browser handles into native preferences', async () => {
  delete (window as Window & { __TAURI__?: unknown }).__TAURI__;
  const p = project('browser'); await rememberProject(p);
  expect(writes).toHaveBeenCalled(); expect(localStorage.getItem(NATIVE_RECENTS_KEY)).toBeNull();
  expect((await recentProjects())[0].id).toBe('browser');
});
it('does not change other native handle records such as audio references', async () => {
  const entry = decodeNativeHandles({ __rippleNativeHandle: true, root: '/synthetic', parts: ['source.wav'], kind: 'file' });
  await handleValue('media:synthetic:audio', entry);
  expect(writes).toHaveBeenCalledWith(encodeNativeHandles(entry), 'media:synthetic:audio');
});
