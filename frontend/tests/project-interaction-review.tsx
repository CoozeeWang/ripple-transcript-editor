/** Isolated synthetic metadata/media. No user files, providers or native filesystem commands. */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ProjectBoard } from '../src/components/ProjectBoard';
import { RecentProjectsNotice } from '../src/components/RecentProjectsNotice';
import { handleValue, mediaFingerprint, recentProjects, rememberProject, saveProject, type OpenProject } from '../src/lib/projectStore';
import { installDesktopFilePickers, NativeDirectoryHandle } from '../src/lib/desktopFs';
import { NATIVE_RECENTS_KEY } from '../src/lib/nativeRecentProjects';
import { setInterfaceLanguage, type InterfaceLanguage } from '../src/i18n';
import '../src/styles.css';
import '../src/components/projectSetup.css';
import '../src/components/projectWorkspace.css';
const query = new URLSearchParams(location.search), mode = query.get('mode') || 'default', language = (query.get('lang') || 'zh-CN') as InterfaceLanguage;
await setInterfaceLanguage(language);
const dragTrace: { type: string; target: string; effect?: string }[] = [];
for (const type of ['dragstart', 'dragenter', 'dragover', 'drop', 'dragend']) document.addEventListener(type, event => {
  if (dragTrace.length > 20) dragTrace.shift();
  dragTrace.push({ type, target: (event.target as HTMLElement).className, effect: (event as DragEvent).dataTransfer?.dropEffect });
  document.documentElement.dataset.dragTrace = JSON.stringify(dragTrace);
}, true);
type Proof = Record<string, unknown>;
function report(value: Proof) {
  const output = document.querySelector('output'); if (output) output.textContent = JSON.stringify(value);
  (window as unknown as { webkit?: { messageHandlers?: { review?: { postMessage: (s: string) => void } } } }).webkit?.messageHandlers?.review?.postMessage(JSON.stringify(value));
}
const files = new Map<string, Uint8Array>();
const missing = () => new DOMException('Synthetic missing file', 'NotFoundError');
const directory = { kind: 'directory', name: 'Synthetic review project.ripple', queryPermission: async () => 'granted', requestPermission: async () => 'granted',
  getDirectoryHandle: async () => directory,
  async *entries() { yield* []; },
  getFileHandle: async (name: string, options?: { create?: boolean }) => {
    if (!files.has(name)) { if (!options?.create) throw missing(); files.set(name, new Uint8Array()); }
    return { kind: 'file', name, getFile: async () => new File([files.get(name)!.slice().buffer], name), createWritable: async () => {
      const chunks: BlobPart[] = [], write = async (chunk: BlobPart) => { chunks.push(chunk); }, close = async () => { files.set(name, new Uint8Array(await new Blob(chunks).arrayBuffer())); };
      return Object.assign(new WritableStream({ write, close }), { write, close, abort: async () => {} });
    } } as unknown as FileSystemFileHandle;
  },
} as unknown as FileSystemDirectoryHandle;
const audio = new Uint8Array(16044), view = new DataView(audio.buffer);
const ascii = (at: number, text: string) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
ascii(0, 'RIFF'); view.setUint32(4, audio.length - 8, true); ascii(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, 'data'); view.setUint32(40, audio.length - 44, true);
const fingerprint = await mediaFingerprint(new Blob([audio]));
const initial: OpenProject = { directory, data: { kind: 'ripple-project', schemaVersion: 1, id: 'synthetic-interaction', title: 'Synthetic review project', description: '', revision: 0,
  interviews: ['a', 'b', 'c'].map(id => ({ id, title: `Synthetic session ${id.toUpperCase()}`, recordings: id === 'a' ? ['a', 'b', 'c'].map(id => ({ id: `recording-${id}`, name: `Synthetic recording ${id.toUpperCase()}.wav`, file: `${id}.wav`, fingerprint, storage: 'copy' as const })) : [] })) } };
files.set('ripple-project.json', new TextEncoder().encode(JSON.stringify(initial.data)));
for (const id of ['a', 'b', 'c']) files.set(`${id}.wav`, audio.slice());
let recentResult: Proof | undefined;
if (mode === 'recent-write' || mode === 'recent-read') {
  Object.assign(window, { __TAURI__: { core: { invoke: async () => false } } }); installDesktopFilePickers();
  const make = (id: string): OpenProject => ({ ...initial, directory: new NativeDirectoryHandle('/synthetic/review', [`${id}.ripple`]) as unknown as FileSystemDirectoryHandle, data: { ...initial.data, id, title: `Synthetic recent ${id}` } });
  if (mode === 'recent-write') {
    localStorage.removeItem(NATIVE_RECENTS_KEY);
    const old = make('older'); await handleValue('recent', [{ id: old.data.id, title: old.data.title, directory: old.directory }]);
    await rememberProject(make('newer'));
  } else Object.defineProperty(window, 'indexedDB', { configurable: true, value: { open() { throw new Error('Synthetic unavailable old database'); } } });
  const entries = await recentProjects();
  const permission = await (entries[0].directory as unknown as NativeDirectoryHandle).queryPermission({ mode: 'readwrite' });
  recentResult = { status: entries.map(p => p.id).join(',') === 'newer,older' && permission === 'prompt' ? 'passed' : 'failed', mode, language, ids: entries.map(p => p.id), permission, width: innerWidth };
}
export function Harness() {
  const [project, setProject] = useState(initial), [selected, setSelected] = useState('a'), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(true);
  async function run(work: () => Promise<void>) { setBusy(true); try { await work(); } catch (e) { setError(String(e)); } finally { setBusy(false); } }
  useEffect(() => {
    if (query.get('review') !== '1') return;
    let acted = false, published = false, timer: number | undefined;
    const check = () => {
      if (published) return;
      if (recentResult) { published = true; report(recentResult); return; }
      const warning = document.querySelector<HTMLElement>('.project-recents-warning');
      if (mode.startsWith('recent-') && warning) {
        const r = warning.getBoundingClientRect(), x = warning.querySelector('.notice-dismiss')!.getBoundingClientRect();
        published = true; report({ status: r.left >= 0 && r.right <= innerWidth && x.top < r.bottom && x.right <= r.right ? 'passed' : 'failed', mode, language, width: innerWidth }); return;
      }
      const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-order-group="audio"]'));
      if (rows.length !== 3) return;
      if (mode.startsWith('sort-') && !acted) {
        acted = true;
        const values = new Map<string, string>(), transfer = { types: ['Files'], effectAllowed: '', dropEffect: '', setData(t: string, v: string) { values.set(t, v); if (!this.types.includes(t)) this.types.push(t); }, getData: (t: string) => values.get(t) || '' };
        const session = mode === 'sort-session', source = document.querySelector<HTMLElement>(session ? '.setup-session .setup-grip' : '.setup-audio .setup-grip')!;
        const target = document.querySelector<HTMLElement>(session ? '.setup-session-list' : mode === 'sort-nested' ? '.setup-audio:last-of-type > .setup-drop' : '.setup-canvas')!;
        const last = (session ? document.querySelectorAll<HTMLElement>('.setup-session')[2] : rows[2]).getBoundingClientRect();
        const y = mode === 'sort-gap' ? (rows[1].getBoundingClientRect().bottom + last.top) / 2 : last.bottom - 2;
        const dispatch = (type: string, at: HTMLElement) => { const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientY: y }); Object.defineProperty(e, 'dataTransfer', { value: transfer }); at.dispatchEvent(e); };
        dispatch('dragstart', source); dispatch('dragover', target); dispatch('drop', target); dispatch('dragend', source); return;
      }
      const index = JSON.parse(new TextDecoder().decode(files.get('ripple-project.json')));
      const ids = mode === 'sort-session' ? index.interviews.map((s: { id: string }) => s.id) : index.interviews.find((s: { id: string }) => s.id === 'a').recordings.map((r: { id: string }) => r.id.slice(-1));
      const expected = mode === 'default' ? 'a,b,c' : mode === 'sort-gap' ? 'b,a,c' : 'b,c,a';
      if (ids.join(',') !== expected || document.querySelector('[aria-busy="true"]')) return;
      const unchanged = ['a', 'b', 'c'].every(id => files.get(`${id}.wav`)!.every((b, i) => b === audio[i]));
      published = true; report({ status: unchanged && !error ? 'passed' : 'failed', mode, language, width: innerWidth, ids, audioBytesUnchanged: unchanged });
    };
    const observer = new MutationObserver(() => { clearTimeout(timer); timer = window.setTimeout(check, 100); }); observer.observe(document.body, { childList: true, attributes: true, subtree: true }); void document.fonts.ready.then(check);
    return () => { observer.disconnect(); clearTimeout(timer); };
  }, [error]);
  return <main className="project-home"><div style={{ padding: 12 }}><strong>Ripple synthetic project review</strong><output style={{ display: 'block', fontSize: 12 }} /></div><section className="project-home__content" aria-busy={busy}>
    {recentResult ? <p>Synthetic Recent Projects: newer, older. Restored permissions still require authorization.</p> : mode.startsWith('recent-') ? notice && <RecentProjectsNotice busy={mode === 'recent-busy'} onRetry={() => setNotice(false)} onDismiss={() => setNotice(false)} /> : <>
      {error && <p role="alert">{error}</p>}<ProjectBoard project={project} selected={selected} busy={busy} select={setSelected} save={interviews => void run(async () => setProject(await saveProject(project, { ...project.data, interviews })))} add={() => {}} importDocuments={async () => { throw new Error('Internal ordering must never import files'); }} createSession={async () => {}} open={() => {}} run={run} legacy={() => {}} relink={() => {}} associate={() => {}} />
    </>}
  </section></main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
