import { encodeNativeHandles } from './desktopFs';
import { handleValue } from './projectStore';

export interface ReadingScope {
    directory: FileSystemDirectoryHandle; audio: string; model: string; version: string;
    project?: string; recording?: string;
}
export interface ReadingAnchor { id: string; index: number; paragraph: number; offset: number; fraction: number }
const PREFIX = 'ripple-reading-position-v1:';
const identities = new WeakMap<FileSystemDirectoryHandle, Promise<string>>();
/** Project/version identities are stable across names and active-version changes. Legacy folders use their native path or a stored handle ID. */
export async function readingKey(scope: ReadingScope): Promise<string> {
    let owner = scope.project && scope.recording ? `project:${scope.project}:${scope.recording}`
        : (scope.directory as FileSystemDirectoryHandle & { storeIdentity?: string }).storeIdentity;
    if (!owner) {
        const native = encodeNativeHandles(scope.directory) as { __rippleNativeHandle?: boolean; root?: string; parts?: string[] };
        if (native.__rippleNativeHandle) owner = JSON.stringify([native.root, native.parts]);
        else {
            let pending = identities.get(scope.directory);
            if (!pending) {
                pending = (async () => {
                    const rows = await handleValue<{ id: string; handle: FileSystemDirectoryHandle }[]>('reading-directory-identities') ?? [];
                    for (const row of rows) if (await scope.directory.isSameEntry(row.handle)) return row.id;
                    const id = crypto.randomUUID();
                    await handleValue('reading-directory-identities', [...rows, { id, handle: scope.directory }]);
                    return id;
                })();
                identities.set(scope.directory, pending);
            }
            owner = await pending;
        }
    }
    return PREFIX + JSON.stringify([owner, scope.audio, scope.model, scope.version]);
}
export function readReadingAnchor(key: string): ReadingAnchor | null {
    try {
        const a = JSON.parse(localStorage.getItem(key) ?? 'null') as ReadingAnchor | null;
        return a && typeof a.id === 'string' && a.id.length > 0 && Number.isInteger(a.index) && a.index >= 0
            && Number.isInteger(a.paragraph) && a.paragraph >= -1 && Number.isFinite(a.offset) && a.offset >= 0
            && Number.isFinite(a.fraction) && a.fraction >= 0 && a.fraction <= 1 ? a : null;
    } catch { return null; }
}
export function saveReadingAnchor(key: string, anchor: ReadingAnchor) {
    try { const raw = JSON.stringify(anchor); if (localStorage.getItem(key) !== raw) localStorage.setItem(key, raw); }
    catch { /* A view preference never changes the manuscript's saved status. */ }
}
