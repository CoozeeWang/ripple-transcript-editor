/** In-memory File System Access implementation for synthetic transaction tests only. */
export function tagTestFs(name = 'synthetic.ripple', beforeWrite?: (path: string) => void) {
    const files = new Map<string, string>(), directories = new Set<string>(['']);
    const missing = () => new DOMException('missing', 'NotFoundError');
    const handle = (path: string): FileSystemDirectoryHandle => ({
        kind: 'directory', name: path.split('/').at(-1) || name,
        async getDirectoryHandle(child: string, options?: FileSystemGetDirectoryOptions) {
            const target = [path, child].filter(Boolean).join('/');
            if (!directories.has(target)) { if (!options?.create) throw missing(); directories.add(target); }
            return handle(target);
        },
        async getFileHandle(child: string, options?: FileSystemGetFileOptions) {
            const target = [path, child].filter(Boolean).join('/');
            if (!files.has(target)) { if (!options?.create) throw missing(); files.set(target, ''); }
            return { kind: 'file', name: child, async getFile() {
                if (!files.has(target)) throw missing(); return new File([files.get(target)!], child);
            }, async createWritable() {
                let draft = '';
                return { async write(value: string) { draft += value; }, async close() { beforeWrite?.(target); files.set(target, draft); }, async abort() {} };
            } } as unknown as FileSystemFileHandle;
        },
        async removeEntry(child: string) { const target = [path, child].filter(Boolean).join('/'); files.delete(target); directories.delete(target); },
        async *entries() {
            const prefix = path ? path + '/' : '';
            for (const target of files.keys()) if (target.startsWith(prefix) && !target.slice(prefix.length).includes('/'))
                yield [target.slice(prefix.length), await handle(path).getFileHandle(target.slice(prefix.length))];
            for (const target of directories) if (target && target.startsWith(prefix) && !target.slice(prefix.length).includes('/'))
                yield [target.slice(prefix.length), handle(target)];
        },
    }) as unknown as FileSystemDirectoryHandle;
    return { root: handle(''), files, directories };
}
