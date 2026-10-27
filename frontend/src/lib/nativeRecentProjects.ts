import { msg } from '../i18n';
import { decodeNativeHandles, encodeNativeHandles } from './desktopFs';

export interface RecentProject { title: string; id: string; directory: FileSystemDirectoryHandle }
export const NATIVE_RECENTS_KEY = 'ripple-native-recent-projects-v1';
type Descriptor = { __rippleNativeHandle: true; root: string; parts: string[]; kind: 'directory' };
type StoredRecent = Omit<RecentProject, 'directory'> & { directory: Descriptor };
function valid(value: unknown): value is StoredRecent[] {
  if (!Array.isArray(value) || value.length > 20) return false;
  const ids = new Set<string>();
  return value.every(item => {
    const directory = item?.directory;
    if (!item || typeof item.title !== 'string' || !item.title.trim() || typeof item.id !== 'string'
      || !/^[a-zA-Z0-9-]{1,80}$/.test(item.id) || ids.has(item.id)
      || directory?.__rippleNativeHandle !== true || directory.kind !== 'directory'
      || typeof directory.root !== 'string' || !directory.root || !Array.isArray(directory.parts)
      || !directory.parts.every((part: unknown) => typeof part === 'string' && part && part !== '.' && part !== '..' && !/[\\/\0]/.test(part))) return false;
    ids.add(item.id); return true;
  });
}

/** Missing means migrate from the existing IndexedDB list; [] is an intentional empty list. */
export function readNativeRecentProjects(): RecentProject[] | undefined {
  const raw = localStorage.getItem(NATIVE_RECENTS_KEY);
  if (raw === null) return undefined;
  let data: { version?: unknown; items?: unknown };
  try { data = JSON.parse(raw); } catch { throw new Error(msg('recentProjects.unreadable')); }
  if (!data || data.version !== 1 || !valid(data.items)) throw new Error(msg('recentProjects.unreadable'));
  return decodeNativeHandles(data.items) as unknown as RecentProject[];
}
export function writeNativeRecentProjects(items: RecentProject[]): void {
  const encoded = encodeNativeHandles(items);
  if (!valid(encoded)) throw new Error(msg('recentProjects.unreadable'));
  const raw = JSON.stringify({ version: 1, items: encoded });
  localStorage.setItem(NATIVE_RECENTS_KEY, raw);
  if (localStorage.getItem(NATIVE_RECENTS_KEY) !== raw) throw new Error(msg('recentProjects.notSaved'));
}
