/** Test-only filesystem and picker. No user files, providers or native access. */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ProjectWorkspace } from '../src/components/ProjectWorkspace';
import { AIConnectorProvider } from '../src/components/AIConnectorProvider';
import { setInterfaceLanguage, type InterfaceLanguage } from '../src/i18n';
import '../src/styles.css';

const query = new URLSearchParams(location.search), mode = query.get('mode') || 'default';
const language = (query.get('lang') || 'zh-CN') as InterfaceLanguage;
type Tree = { files: Record<string, Uint8Array>; dirs: Record<string, Tree> };
const empty = (): Tree => ({ files: {}, dirs: {} });
const tree = empty();
let selections = 0;
function directory(tree: Tree, name: string): FileSystemDirectoryHandle {
  const missing = () => new DOMException('Synthetic missing entry', 'NotFoundError');
  const getFileHandle = async (name: string, options?: { create?: boolean }) => {
    if (!(name in tree.files)) { if (!options?.create) throw missing(); tree.files[name] = new Uint8Array(); }
    return { kind: 'file', name, getFile: async () => new File([tree.files[name].slice().buffer], name), createWritable: async () => {
      const chunks: BlobPart[] = [], write = async (chunk: BlobPart) => { chunks.push(chunk); };
      const close = async () => { tree.files[name] = new Uint8Array(await new Blob(chunks).arrayBuffer()); };
      return Object.assign(new WritableStream({ write, close }), { write, close, abort: async () => {} });
    } } as unknown as FileSystemFileHandle;
  };
  return { kind: 'directory', name, queryPermission: async () => 'granted', requestPermission: async () => 'granted', getFileHandle,
    getDirectoryHandle: async (name: string, options?: { create?: boolean }) => {
      if (!tree.dirs[name]) { if (!options?.create) throw missing(); tree.dirs[name] = empty(); }
      return directory(tree.dirs[name], name);
    }, removeEntry: async (name: string) => { delete tree.files[name]; delete tree.dirs[name]; },
    async *entries() { for (const name of Object.keys(tree.files)) yield [name, await getFileHandle(name)]; for (const [name, child] of Object.entries(tree.dirs)) yield [name, directory(child, name)]; },
  } as unknown as FileSystemDirectoryHandle;
}
const root = directory(tree, 'Synthetic selected parent');
// One second of explicitly synthetic silence, valid WAV header for editor checks.
const bytes = new Uint8Array(16044), data = new DataView(bytes.buffer);
const ascii = (at: number, text: string) => [...text].forEach((c, i) => data.setUint8(at + i, c.charCodeAt(0)));
ascii(0, 'RIFF'); data.setUint32(4, bytes.length - 8, true); ascii(8, 'WAVEfmt '); data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 1, true); data.setUint32(24, 8000, true); data.setUint32(28, 16000, true); data.setUint16(32, 2, true); data.setUint16(34, 16, true); ascii(36, 'data'); data.setUint32(40, bytes.length - 44, true);
const inputs = empty(); inputs.files['Synthetic audio.wav'] = bytes; inputs.files['Synthetic manuscript.txt'] = new TextEncoder().encode('Synthetic manuscript created for the save-first flow.');
const source = directory(inputs, 'Synthetic inputs');
window.fetch = async () => new Response(JSON.stringify({ configured: false, engines: [], default_engine_id: null, providers: [], profiles: [] }), { headers: { 'Content-Type': 'application/json' } });
Object.assign(window, {
  showDirectoryPicker: async () => {
    selections++;
    if (mode === 'busy') await new Promise(() => {});
    if (mode === 'error') throw new DOMException('Synthetic denied location', 'NotAllowedError');
    if (mode === 'cancel' && selections === 1) throw new DOMException('Synthetic cancelled location', 'AbortError');
    return root;
  },
  showOpenFilePicker: async (options: { types?: { accept: Record<string, string[]> }[] }) => [await source.getFileHandle(options.types?.[0]?.accept['audio/*'] ? 'Synthetic audio.wav' : 'Synthetic manuscript.txt')],
});
localStorage.setItem('ripple-mcp-enabled', '0');
localStorage.setItem('ripple-open-last-project', '0');
await setInterfaceLanguage(language);
function inspect() {
  return Object.fromEntries(Object.entries(tree.dirs).map(([name, child]) => [name, {
    index: JSON.parse(new TextDecoder().decode(child.files['ripple-project.json'] || new Uint8Array()) || 'null'),
    directories: Object.keys(child.dirs),
  }]));
}
export function Harness() {
  const [proof, setProof] = useState('');
  useEffect(() => {
    if (query.get('review') !== '1') return;
    let phase = 0, published = false, timer: number | undefined;
    const inspectState = () => {
      if (published) return;
      if (phase === 0) { const button = document.querySelector<HTMLButtonElement>('.welcome-card'); if (!button) return; phase = 1; button.click(); return; }
      const form = document.querySelector<HTMLFormElement>('.project-create');
      const input = form?.querySelector<HTMLInputElement>('input');
      if (mode !== 'default' && phase === 1 && input) {
        phase = 2;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Synthetic saved project');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      if (['busy', 'error', 'saved', 'cancel'].includes(mode) && phase === 2 && input?.value) {
        phase = 3; form!.requestSubmit(); return;
      }
      const error = document.querySelector<HTMLElement>('.project-create [role="alert"]');
      const add = document.querySelector<HTMLButtonElement>('.setup-new');
      const buttons = form ? [...form.querySelectorAll<HTMLButtonElement>('button')] : [];
      const ready = mode === 'saved' ? Boolean(add) : mode === 'error' ? Boolean(error) : mode === 'busy' ? input?.disabled
        : mode === 'cancel' ? selections > 0 && input && !input.disabled : Boolean(form && (mode === 'default' || input?.value));
      if (!ready) return;
      const card = form || document.querySelector<HTMLElement>('.project-saved-title')!;
      const rect = card.getBoundingClientRect(), er = error?.getBoundingClientRect(), dismiss = error?.querySelector('button')?.getBoundingClientRect();
      const index = Object.values(inspect())[0]?.index;
      const noMaterials = !Object.values(tree.dirs).some(child => Object.keys(child.dirs).length);
      const passed = rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight
        && noMaterials && (mode === 'saved' ? index?.interviews.length === 0 && document.activeElement === add
          : !index && !add && (mode !== 'busy' || buttons.every(b => b.disabled)))
        && (!er || Boolean(dismiss && dismiss.right <= er.right && dismiss.top < er.bottom));
      const result = { status: passed ? 'passed' : 'failed', mode, language, width: innerWidth, selections, noMaterials, focused: document.activeElement?.tagName, saved: Boolean(index) };
      published = true; setProof(JSON.stringify(result));
      (window as unknown as { webkit?: { messageHandlers?: { review?: { postMessage: (text: string) => void } } } }).webkit?.messageHandlers?.review?.postMessage(JSON.stringify(result));
    };
    const observer = new MutationObserver(() => { clearTimeout(timer); timer = window.setTimeout(inspectState, 100); });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true });
    void document.fonts.ready.then(inspectState);
    return () => { observer.disconnect(); clearTimeout(timer); };
  }, []);
  return <><details style={{ padding: '6px 12px' }}><summary>Synthetic save-first review</summary><p>In-memory synthetic files only. Reload clears projects. No providers or user files.</p><button onClick={() => setProof(JSON.stringify(inspect()))}>Inspect synthetic saved index</button><output>{proof}</output></details><AIConnectorProvider><ProjectWorkspace /></AIConnectorProvider></>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
