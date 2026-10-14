/** In-memory synthetic files only. Never opens the real filesystem. */
interface SyntheticDirectory {
  handle: FileSystemDirectoryHandle; files: Map<string, File>; dirs: Map<string, SyntheticDirectory>;
  fail: (check?: (filename: string) => boolean) => void;
}
export function syntheticDirectory(name = 'synthetic-project'): SyntheticDirectory {
  const files = new Map<string, File>();
  const dirs = new Map<string, SyntheticDirectory>();
  const missing = () => new DOMException('synthetic missing entry', 'NotFoundError');
  let failWrite: ((filename: string) => boolean) | undefined;
  const getFileHandle = async (filename: string, options?: { create?: boolean }) => {
    if (!files.has(filename)) {
      if (!options?.create) throw missing();
      files.set(filename, new File([], filename));
    }
    return { kind: 'file', name: filename, getFile: async () => {
      const file = files.get(filename); if (!file) throw missing(); return file;
    }, createWritable: async () => {
      const chunks: BlobPart[] = [];
      return { write: async (chunk: BlobPart) => { chunks.push(chunk); }, abort: async () => {},
        close: async () => { if (failWrite?.(filename)) throw Error('synthetic_write_failure'); files.set(filename, new File(chunks, filename)); } };
    } } as unknown as FileSystemFileHandle;
  };
  const handle = { kind: 'directory', name, getFileHandle,
    getDirectoryHandle: async (key: string, options?: { create?: boolean }) => {
      if (!dirs.has(key)) { if (!options?.create) throw missing(); dirs.set(key, syntheticDirectory(key)); }
      return dirs.get(key)!.handle;
    },
    removeEntry: async (key: string) => { files.delete(key); dirs.delete(key); },
    async *entries() {
      for (const filename of files.keys()) yield [filename, await getFileHandle(filename)];
      for (const [key, directory] of dirs) yield [key, directory.handle];
    },
  } as unknown as FileSystemDirectoryHandle;
  return { handle, files, dirs, fail: (check?: (filename: string) => boolean) => { failWrite = check; } };
}
