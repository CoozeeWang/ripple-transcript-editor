/** In-memory File System Access implementation for synthetic transaction tests only. */
export function tagTestFs(name = 'synthetic.ripple', beforeWrite?: (path: string) => void) {
    const files = new Map<string, string>(), directories = new Set<string>(['']);
    const identity={}, modified=new Map<string,number>(),sizes=new Map<string,number>();let clock=1;
    const put=files.set.bind(files);files.set=(path,value)=>{modified.set(path,clock++);sizes.set(path,new TextEncoder().encode(value).length);return put(path,value)};
    const missing = () => new DOMException('missing', 'NotFoundError');
    const handle = (path: string): FileSystemDirectoryHandle => ({
        kind: 'directory', name: path.split('/').at(-1) || name, testIdentity:identity,testPath:path,
        async isSameEntry(other: FileSystemHandle){return (other as unknown as {testIdentity:unknown;testPath:string}).testIdentity===identity&&(other as unknown as {testPath:string}).testPath===path},
        async resolve(other:FileSystemHandle){const target=other as unknown as {testIdentity:unknown;testPath:string};return target.testIdentity===identity&&(target.testPath===path||target.testPath.startsWith(path?path+'/':''))?target.testPath.slice(path?path.length+1:0).split('/').filter(Boolean):null},
        async getDirectoryHandle(child: string, options?: FileSystemGetDirectoryOptions) {
            const target = [path, child].filter(Boolean).join('/');
            if (!directories.has(target)) { if (!options?.create) throw missing(); directories.add(target); }
            return handle(target);
        },
        async getFileHandle(child: string, options?: FileSystemGetFileOptions) {
            const target = [path, child].filter(Boolean).join('/');
            if (!files.has(target)) { if (!options?.create) throw missing(); files.set(target, ''); }
            return { kind: 'file', name: child, async getFile() {
                if (!files.has(target)) throw missing(); return new File([files.get(target)!], child,{lastModified:modified.get(target)??0});
            },async getMetadata(){return{size:sizes.get(target)??0,modified:String(modified.get(target)??0)};
            }, async createWritable() {
                let draft = '';
                return { async write(value: string | Blob) { draft += typeof value==='string'?value:await value.text(); }, async close() { beforeWrite?.(target); files.set(target, draft); }, async abort() {} };
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
        async *values(){for await(const [,entry]of handle(path).entries())yield entry},
    }) as unknown as FileSystemDirectoryHandle;
    return { root: handle(''), files, directories };
}
