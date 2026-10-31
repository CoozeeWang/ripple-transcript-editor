/** A recoverable multi-file transaction. Paths are project-relative JSON files, never media. */
export interface TagFilePatch { path: string[]; before: string | null; after: string | null }
interface Journal { kind: 'ripple-tag-transaction'; version: 1; id: string; state: 'prepared' | 'committed'; patches: TagFilePatch[]; layout?: 'document' }
const JOURNAL = '.ripple-tag-transaction.json';
type Layout = 'project' | 'document';
const journalName = (layout: Layout) => layout === 'document' ? '.ripple-document-transaction.json' : JOURNAL;
const missing = (error: unknown) => (error as { name?: string })?.name === 'NotFoundError';
const safePart = (part: unknown): part is string => typeof part === 'string' && !!part && part !== '.' && part !== '..' && !/[\\/]/.test(part) && !Array.from(part).some(char=>char.charCodeAt(0)<32);
function validPath(path: unknown, layout: Layout): path is string[] {
    return Array.isArray(path) && path.length > 0 && path.every(safePart)
        && (path.at(-1)!.endsWith('.json')||layout==='document'&&path.at(-1)==='manifest.json.bak') && !path.includes(JOURNAL) && !path.includes(journalName('document'))
        && (layout === 'document' ? path.length === 1 : path.length === 1 && path[0] === 'ripple-project.json'
            || path.length >= 3 && path[0] === 'interviews' && path.some(part => part.endsWith('.transcript')));
}
async function directory(root: FileSystemDirectoryHandle, path: string[]): Promise<FileSystemDirectoryHandle> {
    let current = root;
    for (const part of path) current = await current.getDirectoryHandle(part);
    return current;
}
export async function readTagFile(root: FileSystemDirectoryHandle, path: string[]): Promise<string | null> {
    try { const dir = await directory(root, path.slice(0, -1)); return await (await (await dir.getFileHandle(path.at(-1)!)).getFile()).text(); }
    catch (error) { if (missing(error)) return null; throw error; }
}
async function write(root: FileSystemDirectoryHandle, path: string[], text: string | null): Promise<void> {
    const dir = await directory(root, path.slice(0, -1)), name = path.at(-1)!;
    if (text === null) { try { await dir.removeEntry(name); } catch (error) { if (!missing(error)) throw error; } return; }
    const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
    try { await writable.write(text); await writable.close(); }
    catch (error) { await writable.abort().catch(() => {}); throw error; }
    if (await readTagFile(root, path) !== text) throw Error('tag_transaction_verification_failed');
}
function parseJournal(raw: string, layout: Layout = 'project'): Journal {
    const data = JSON.parse(raw) as Journal;
    if (data?.kind !== 'ripple-tag-transaction' || data.version !== 1 || !safePart(data.id)
        || !['prepared', 'committed'].includes(data.state) || !Array.isArray(data.patches)
        || (data.layout ?? 'project') !== layout
        || data.patches.some(patch => !validPath(patch.path, layout) || ![patch.before, patch.after].every(value => value === null || typeof value === 'string'))
        || new Set(data.patches.map(patch => JSON.stringify(patch.path))).size !== data.patches.length)
        throw Error('tag_transaction_invalid_journal');
    return data;
}
async function restore(root: FileSystemDirectoryHandle, patches: readonly TagFilePatch[]): Promise<void> {
    // Do not overwrite an independently changed file, even during recovery.
    for (const patch of patches) {
        const current = await readTagFile(root, patch.path);
        // A new native file can exist empty if interrupted between create-file and atomic close.
        if (current !== patch.before && current !== patch.after && !(patch.before===null&&current==='')) throw Error('tag_transaction_recovery_conflict');
    }
    for (const patch of [...patches].reverse()) if (await readTagFile(root, patch.path) !== patch.before)
        await write(root, patch.path, patch.before);
}
export async function recoverTagFileTransaction(root: FileSystemDirectoryHandle, layout: Layout = 'project'): Promise<void> {
    const name = journalName(layout), raw = await readTagFile(root, [name]);
    if (raw === null) return;
    // Native create-file can be interrupted before the first atomic prepared write.
    // No canonical patch is started until that prepared journal has been verified.
    if(raw===''){await root.removeEntry(name);return;}
    const journal = parseJournal(raw, layout);
    if (journal.state === 'prepared') await restore(root, journal.patches);
    await root.removeEntry(name);
}
export async function commitTagFileTransaction(root: FileSystemDirectoryHandle, requested: readonly TagFilePatch[], layout: Layout = 'project'): Promise<void> {
    const name = journalName(layout);
    await recoverTagFileTransaction(root, layout);
    const patches = requested.filter(patch => patch.before !== patch.after);
    const journal: Journal = { kind: 'ripple-tag-transaction', version: 1, id: crypto.randomUUID(), state: 'prepared', patches, ...(layout === 'document' ? {layout} : {}) };
    const prepared = JSON.stringify(journal);
    parseJournal(prepared, layout);
    if (!patches.length) return;
    for (const patch of patches) if (await readTagFile(root, patch.path) !== patch.before) throw Error('tag_transaction_concurrent_change');
    // The verified active journal already contains both generations and is durable
    // before canonical writes. Undo keeps its explicit receipt; do not accumulate a
    // second permanent copy after every tag command or text autosave. Existing
    // historical archives are untouched; upgrade rollback checkpoints are separate.
    try {
        await write(root, [name], prepared);
        for (const patch of patches) await write(root, patch.path, patch.after);
        await write(root, [name], JSON.stringify({ ...journal, state: 'committed' }));
    } catch (error) {
        try { await restore(root, patches); await root.removeEntry(name); }
        catch (recovery) { throw new AggregateError([error, recovery], 'tag_transaction_recovery_required', { cause: recovery }); }
        throw error;
    }
    // Once marked committed, a cleanup failure is not a failed edit. Next open cleans it.
    await root.removeEntry(name).catch(() => {});
}
