import { msg } from '../i18n';
/** Move within one ordered group without changing ownership. */
export function reorder<T extends { id: string }>(list: T[], source: string, target: string, after: boolean): T[] {
  if (source === target || !list.some(i => i.id === source) || !list.some(i => i.id === target)) return list;
  const item = list.find(i => i.id === source)!;
  const next = list.filter(i => i.id !== source);
  next.splice(next.findIndex(i => i.id === target) + Number(after), 0, item);
  return next;
}
export interface DroppedFile { handle: FileSystemFileHandle; referenceable: boolean }
/** Capture handles during the drop event, before browser drag data becomes inaccessible. */
export function droppedFiles(data: DataTransfer): Promise<DroppedFile[]> {
  const entries = Array.from(data.items ?? []).filter(i => i.kind === 'file');
  const pending = entries.map(item => {
    const file = item.getAsFile();
    const getHandle = (item as DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> }).getAsFileSystemHandle;
    let promise: Promise<FileSystemHandle | null>;
    try { promise = getHandle ? getHandle.call(item) : Promise.resolve(null); }
    catch (error) { promise = file ? Promise.resolve(null) : Promise.reject(error); }
    promise = promise.catch(error => { if (file) return null; throw error; });
    return promise.then(handle => {
      if (handle?.kind === 'directory') throw new Error(msg('projectSetup.m1380'));
      if (handle) return { handle: handle as FileSystemFileHandle, referenceable: true };
      if (!file) throw new Error(msg('projectSetup.m1381'));
      return { handle: { kind: 'file', name: file.name, getFile: async () => file } as FileSystemFileHandle, referenceable: false };
    });
  });
  if (!pending.length) for (const file of Array.from(data.files ?? [])) pending.push(Promise.resolve({ handle: { kind: 'file', name: file.name, getFile: async () => file } as FileSystemFileHandle, referenceable: false }));
  return Promise.all(pending);
}
