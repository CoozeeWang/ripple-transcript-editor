import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Transcript } from '../types';
import { msg } from '../i18n';
import { emptyTagLibrary, normalizeTagName, setSegmentTag, tagHistoryAnchor, type TagLibrary } from '../lib/tags';
import { projectTagCounts } from '../lib/projectTags';
import type { OpenProject } from '../lib/projectStore';
interface Options {
    library?: TagLibrary;
    save?: (library: TagLibrary) => Promise<void>;
    project: () => OpenProject | null;
    recordingId?: string;
    modelId?: string | null;
    context: string;
    transcript: Transcript | null;
    mutate: (updater: (current: Transcript) => Transcript, groupKey?: string) => void;
    readOnly: boolean;
    onError: (message: string) => void;
    errorMessage: string;
}
interface Entry {
    before: TagLibrary;
    after: TagLibrary;
    anchor:string;
}
const EMPTY = emptyTagLibrary();
export function useProjectTags(o: Options) {
    const library = o.library ?? EMPTY;
    const anchor=tagHistoryAnchor(o.transcript);
    // Text edits do not affect tag counts or warrant rereading other manuscripts.
    const countKey=JSON.stringify([o.context,o.recordingId,o.transcript?.segments.map(segment=>[segment.id,segment.tagIds])]);
    const [busy, setBusy] = useState(false), [past, setPast] = useState<Entry[]>([]), [future, setFuture] = useState<Entry[]>([]), [countResult, setCountResult] = useState<{
        key:string;
        counts: Map<string, number> | null;
        error: boolean;
    } | null>(null), [retry, setRetry] = useState(0);
    const latest = useRef(o), libraryRef = useRef(library), pending = useRef(false);
    useLayoutEffect(() => { latest.current = o; libraryRef.current = library; });
    useEffect(()=>{const context=o.context;queueMicrotask(()=>{if(latest.current.context===context){setPast([]);setFuture([])}})},[o.context]);
    const discardRedo=useCallback(()=>setFuture([]),[]);
    const persist = useCallback(async (next: TagLibrary) => { const current = latest.current; if (!current.save || current.readOnly || pending.current)
        throw new Error('tag_write_unavailable'); pending.current = true; setBusy(true); try {
        await current.save(next);
        if (latest.current.context === current.context) libraryRef.current = next;
    }
    finally {
        pending.current = false;
        setBusy(false);
    } }, []);
    const change = useCallback(async (next: TagLibrary) => { const before = libraryRef.current, context = latest.current.context, anchor=tagHistoryAnchor(latest.current.transcript); await persist(next); if (latest.current.context !== context) return; setPast(old => [...old, { before, after: next, anchor }].slice(-100)); setFuture([]); }, [persist]);
    const add = useCallback(async (segmentId: string, rawName: string) => { const current = latest.current, context = current.context; if (current.readOnly || pending.current)
        return; const name = normalizeTagName(rawName); if (!name)
        return; let tag = libraryRef.current.tags.find(t => t.name.toLowerCase() === name.toLowerCase()); try {
        if (!tag) {
            tag = { id: crypto.randomUUID(), name, groupIds: [] };
            await change({ ...libraryRef.current, tags: [...libraryRef.current.tags, tag] });
        }
        if (latest.current.context !== context || latest.current.readOnly)
            return;
        const id = tag.id;
        latest.current.mutate(t => setSegmentTag(t, segmentId, id, true), 'tag:' + segmentId + ':' + id);
    }
    catch {
        latest.current.onError(latest.current.errorMessage);
    } }, [change]);
    const remove = useCallback((segmentId: string, id: string) => { if (latest.current.readOnly || pending.current)
        return; latest.current.mutate(t => setSegmentTag(t, segmentId, id, false), 'tag:' + segmentId + ':' + id); }, []);
    const rename = useCallback(async (id: string, raw: string) => {
        const name = normalizeTagName(raw), library = libraryRef.current, tag = library.tags.find(tag => tag.id === id);
        if (!tag || !name || name.length > 120 || Array.from(name).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new Error(msg('tags.invalidName'));
        if (library.tags.some(other => other.id !== id && normalizeTagName(other.name).toLowerCase() === name.toLowerCase())) throw new Error(msg('tags.nameExists'));
        if (tag.name === name) return;
        try { await change({ ...library, tags: library.tags.map(tag => tag.id === id ? { ...tag, name } : tag) }); }
        catch { throw new Error(msg('tags.saveFailed')); }
    }, [change]);
    const canUndo = past.length > 0 && past.at(-1)?.anchor === anchor, canRedo = future.length > 0 && future.at(-1)?.anchor === anchor;
    const undo = async () => { const entry = past.at(-1); if (!entry || !canUndo || busy)
        return; try {
        await persist(entry.before);
        setPast(old => old.slice(0, -1));
        setFuture(old => [...old, entry]);
    }
    catch {
        o.onError(o.errorMessage);
    } };
    const redo = async () => { const entry = future.at(-1); if (!entry || !canRedo || busy)
        return; try {
        await persist(entry.after);
        setFuture(old => old.slice(0, -1));
        setPast(old => [...old, entry]);
    }
    catch {
        o.onError(o.errorMessage);
    } };
    useEffect(() => { const current = latest.current, project = current.project(); if (!project || !current.transcript || !current.recordingId || !current.modelId)
        return; let cancelled = false; const timer = setTimeout(() => { void projectTagCounts(project, { recordingId: current.recordingId!, modelId: current.modelId!, transcript: current.transcript! }).then(counts => { if (!cancelled)
        setCountResult({ key:countKey, counts, error: false }); }, () => { if (!cancelled)
        setCountResult({ key:countKey, counts: null, error: true }); }); }, 120); return () => { cancelled = true; clearTimeout(timer); }; }, [countKey, retry]);
    const countCurrent = countResult?.key === countKey, counts = countCurrent ? countResult?.counts ?? null : null, countError = countCurrent && !!countResult?.error;
    return { library, busy, change, add, remove, rename, canUndo, canRedo, undo, redo, counts, countError, discardRedo, retryCounts: () => setRetry(n => n + 1) };
}
