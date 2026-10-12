/** File System Access compatibility for Ripple's local Tauri window. */

type Entry = { name: string; kind: 'file' | 'directory' };
type NativeKind = Entry['kind'];
type Descriptor = { __rippleNativeHandle: true; root: string; parts: string[]; kind: NativeKind };

function invoke<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const tauri = (window as unknown as { __TAURI__?: { core?: { invoke: (name: string, args: Record<string, unknown>) => Promise<T> } } }).__TAURI__;
  if (!tauri?.core) throw new Error('Native file bridge unavailable');
  return tauri.core.invoke(command, args).catch(error => {
    if (error === 'selection_cancelled') throw new DOMException('Selection cancelled', 'AbortError');
    if (error === 'permission_required') throw new DOMException('File access needs permission', 'NotAllowedError');
    if (error === 'file_missing') throw new DOMException('Selected file is missing', 'NotFoundError');
    throw error;
  });
}

export function nativeDesktopAvailable(): boolean {
  return typeof window !== 'undefined' && Boolean((window as unknown as { __TAURI__?: { core?: unknown } }).__TAURI__?.core);
}

const selectedRoots = new Set<string>();
let productionDesktop = false;

function nameOf(parts: string[], root: string) { return parts.at(-1) ?? root.split('/').at(-1) ?? root; }
function child(parts: string[], name: string) {
  if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) throw new TypeError('Invalid file name');
  return [...parts, name];
}
function missing(name: string): DOMException { return new DOMException(`${name} does not exist`, 'NotFoundError'); }
function wrongKind(name: string): DOMException { return new DOMException(`${name} has another kind`, 'TypeMismatchError'); }

abstract class NativeHandle {
  readonly name: string;
  abstract readonly kind: NativeKind;
  constructor(readonly root: string, readonly parts: string[]) { this.name = nameOf(parts, root); }
  async isSameEntry(other: FileSystemHandle): Promise<boolean> {
    return other instanceof NativeHandle && this.root === other.root && this.parts.join('\0') === other.parts.join('\0');
  }
  async queryPermission(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState> {
    if (productionDesktop) return await invoke<boolean>('fs_permission', { root: this.root, parts: this.parts, write: options?.mode === 'readwrite' }) ? 'granted' : 'prompt';
    return selectedRoots.has(this.root) ? 'granted' : 'prompt';
  }
  async requestPermission(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState> {
    if (await this.queryPermission(options) === 'granted') return 'granted';
    try {
      if (productionDesktop) await invoke('fs_reauthorize', { root: this.root, parts: this.parts, kind: this.kind });
      else await chooseNativeFixtureDirectory();
    } catch { return 'denied'; }
    return await this.queryPermission(options) === 'granted' ? 'granted' : 'denied';
  }
  descriptor(): Descriptor { return { __rippleNativeHandle: true, root: this.root, parts: this.parts, kind: this.kind }; }
}

class NativeWritable extends WritableStream<BufferSource | Blob | string> {
  private writerForDirect: WritableStreamDefaultWriter<BufferSource | Blob | string> | null = null;
  private abortNative: () => Promise<void>;
  constructor(root: string, parts: string[]) {
    const chunks: Uint8Array[] = [];
    let size = 0;
    const session = productionDesktop ? invoke<number>('fs_begin_write', { root, parts }) : null;
    const flush = async () => {
      if (!chunks.length) return;
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      chunks.length = 0;
      size = 0;
      if (session) await invoke('fs_write_chunk', { id: await session, bytes: Array.from(bytes) });
      else chunks.push(bytes);
    };
    super({
      async write(data) {
        const bytes = typeof data === 'string' ? new TextEncoder().encode(data)
          : data instanceof Blob ? new Uint8Array(await data.arrayBuffer())
          : new Uint8Array(data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
        for (let start = 0; start < bytes.length; start += 1024 * 1024) {
          const piece = bytes.subarray(start, start + 1024 * 1024);
          chunks.push(new Uint8Array(piece));
          size += piece.length;
          if (session && size >= 1024 * 1024) await flush();
        }
      },
      async close() {
        if (session) {
          await flush();
          await invoke('fs_commit_write', { id: await session });
        } else {
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
          await invoke('fs_write', { root, parts, bytes: Array.from(bytes) });
        }
      },
      async abort() { if (session) await invoke('fs_abort_write', { id: await session }); },
    });
    this.abortNative = async () => { if (session) await invoke('fs_abort_write', { id: await session }); };
  }
  async write(data: FileSystemWriteChunkType): Promise<void> {
    if (typeof data === 'object' && data !== null && 'data' in data) {
      const command = data as { type: string; position?: number; data: BufferSource | Blob | string };
      if (command.type !== 'write' || command.position !== undefined) throw new Error('Unsupported write operation in probe');
      data = command.data;
    }
    this.writerForDirect ??= this.getWriter();
    await this.writerForDirect.write(data as BufferSource | Blob | string);
  }
  async close(): Promise<void> {
    this.writerForDirect ??= this.getWriter();
    await this.writerForDirect.close();
    this.writerForDirect.releaseLock();
  }
  async abort(reason?: unknown): Promise<void> {
    this.writerForDirect ??= this.getWriter();
    try { await this.writerForDirect.abort(reason); }
    finally { await this.abortNative(); this.writerForDirect.releaseLock(); }
  }
  async seek(): Promise<void> { throw new Error('Unsupported in probe'); }
  async truncate(): Promise<void> { throw new Error('Unsupported in probe'); }
}

export class NativeFileHandle extends NativeHandle {
  readonly kind = 'file';
  async checkMedia(expected: string): Promise<void> {
    await invoke('fs_media_check', {root:this.root, parts:this.parts, expected});
  }
  async getPlaybackUrl(expected = ''): Promise<string> {
    const path = await invoke<string>('fs_media_url', {root:this.root, parts:this.parts, expected});
    const tauri = (window as unknown as {__TAURI__: {core: {convertFileSrc:(path:string)=>string}}}).__TAURI__;
    return tauri.core.convertFileSrc(path);
  }
  async getFile(): Promise<File> {
    if (!productionDesktop) {
      const bytes = await invoke<number[]>('fs_read', { root: this.root, parts: this.parts });
      return new File([new Uint8Array(bytes)], this.name);
    }
    const size = await invoke<number>('fs_size', { root: this.root, parts: this.parts });
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    for (let offset = 0; offset < size; offset += 1024 * 1024) {
      const bytes = await invoke<number[]>('fs_read_chunk', { root: this.root, parts: this.parts, offset, length: Math.min(1024 * 1024, size - offset) });
      chunks.push(new Uint8Array(bytes));
    }
    return new File(chunks, this.name);
  }
  async createWritable(): Promise<FileSystemWritableFileStream> {
    return new NativeWritable(this.root, this.parts) as FileSystemWritableFileStream;
  }
}

export class NativeDirectoryHandle extends NativeHandle {
  readonly kind = 'directory';
  async getFileHandle(name: string, options?: FileSystemGetFileOptions): Promise<FileSystemFileHandle> {
    const parts = child(this.parts, name);
    const entry = await invoke<Entry | null>('fs_stat', { root: this.root, parts });
    if (!entry) {
      if (!options?.create) throw missing(name);
      await invoke('fs_create_file', { root: this.root, parts });
    } else if (entry.kind !== 'file') throw wrongKind(name);
    return new NativeFileHandle(this.root, parts) as FileSystemFileHandle;
  }
  async getDirectoryHandle(name: string, options?: FileSystemGetDirectoryOptions): Promise<FileSystemDirectoryHandle> {
    const parts = child(this.parts, name);
    const entry = await invoke<Entry | null>('fs_stat', { root: this.root, parts });
    if (!entry) {
      if (!options?.create) throw missing(name);
      await invoke('fs_mkdir', { root: this.root, parts });
    } else if (entry.kind !== 'directory') throw wrongKind(name);
    return new NativeDirectoryHandle(this.root, parts) as unknown as FileSystemDirectoryHandle;
  }
  async *entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
    const entries = await invoke<Entry[]>('fs_list', { root: this.root, parts: this.parts });
    for (const entry of entries) {
      const parts = child(this.parts, entry.name);
      yield [entry.name, entry.kind === 'directory' ? new NativeDirectoryHandle(this.root, parts) as unknown as FileSystemDirectoryHandle : new NativeFileHandle(this.root, parts) as FileSystemFileHandle];
    }
  }
  async *keys(): AsyncIterableIterator<string> { for await (const [name] of this.entries()) yield name; }
  async *values(): AsyncIterableIterator<FileSystemHandle> { for await (const [, handle] of this.entries()) yield handle; }
  [Symbol.asyncIterator](): AsyncIterableIterator<[string, FileSystemHandle]> { return this.entries(); }
  async resolve(handle: FileSystemHandle): Promise<string[] | null> {
    if (!(handle instanceof NativeHandle) || handle.root !== this.root) return null;
    return this.parts.every((part, i) => handle.parts[i] === part) ? handle.parts.slice(this.parts.length) : null;
  }
  async removeEntry(name: string, options?: FileSystemRemoveOptions): Promise<void> {
    if (!productionDesktop) throw new Error('Deletion is outside this feasibility probe');
    await invoke('fs_remove', { root: this.root, parts: child(this.parts, name), recursive: options?.recursive ?? false });
  }
}

export async function chooseNativeFixtureDirectory(): Promise<FileSystemDirectoryHandle> {
  const root = await invoke<string>('pick_fixture_folder', {});
  selectedRoots.add(root);
  return new NativeDirectoryHandle(root, []) as unknown as FileSystemDirectoryHandle;
}

type SelectedPath = { root: string; kind: NativeKind };

export async function chooseNativeDirectory(): Promise<FileSystemDirectoryHandle> {
  const selected = await invoke<SelectedPath>('pick_directory', {});
  selectedRoots.add(selected.root);
  return new NativeDirectoryHandle(selected.root, []) as unknown as FileSystemDirectoryHandle;
}

export async function chooseNativeFiles(multiple: boolean): Promise<FileSystemFileHandle[]> {
  const selected = await invoke<SelectedPath[]>('pick_files', { multiple });
  for (const item of selected) selectedRoots.add(item.root);
  return selected.map(item => new NativeFileHandle(item.root, []) as FileSystemFileHandle);
}

/** The native dialog authorizes the destination; writes remain atomic. */
export async function saveNativeBlob(blob: Blob, filename: string): Promise<void> {
  const selected = await invoke<{root: string; name: string}>('pick_save_file', {filename});
  const stream = await new NativeFileHandle(selected.root, child([], selected.name)).createWritable();
  try { await stream.write(blob); await stream.close(); }
  catch (error) { await stream.abort().catch(() => {}); throw error; }
}

/** Called only by the packaged desktop entry point. Browser pickers remain untouched. */
export function installDesktopFilePickers(): void {
  if (!nativeDesktopAvailable()) return;
  productionDesktop = true;
  const target = window as unknown as {
    showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
    showOpenFilePicker: (options?: { multiple?: boolean }) => Promise<FileSystemFileHandle[]>;
  };
  target.showDirectoryPicker = chooseNativeDirectory;
  target.showOpenFilePicker = options => chooseNativeFiles(options?.multiple ?? false);
}

export function encodeNativeHandles(value: unknown): unknown {
  if (value instanceof NativeHandle) return value.descriptor();
  if (Array.isArray(value)) return value.map(encodeNativeHandles);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeNativeHandles(item)]));
  return value;
}

export function decodeNativeHandles<T>(value: T): T {
  if (Array.isArray(value)) return value.map(decodeNativeHandles) as T;
  if (value && typeof value === 'object') {
    const maybe = value as unknown as Descriptor;
    if (maybe.__rippleNativeHandle === true && Array.isArray(maybe.parts) && typeof maybe.root === 'string') {
      return (maybe.kind === 'directory' ? new NativeDirectoryHandle(maybe.root, maybe.parts) : new NativeFileHandle(maybe.root, maybe.parts)) as T;
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decodeNativeHandles(item)])) as T;
  }
  return value;
}

/** Query only an existing native capability; this never opens a picker. */
export async function nativeAccessStatus(handle: FileSystemDirectoryHandle): Promise<'granted' | 'missing' | 'permission'> {
  if (handle instanceof NativeHandle && productionDesktop) {
    return invoke('fs_access_status', { root: handle.root, parts: handle.parts });
  }
  const query = handle as FileSystemDirectoryHandle & {queryPermission?: (options:{mode:string})=>Promise<string>};
  return await query.queryPermission?.({mode:'readwrite'}) === 'granted' ? 'granted' : 'permission';
}

/** Best-effort Finder decoration; browser/fixture storage is left unchanged. */
export async function decorateNativeProject(directory: FileSystemDirectoryHandle): Promise<boolean> {
  if (!(directory instanceof NativeDirectoryHandle) || !productionDesktop) return true;
  try { return await invoke<boolean>('project_set_icon',{root:directory.root,parts:directory.parts}); }
  catch { return false; }
}
