import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Transcript } from '../types';
import { tagErrorMessage } from '../lib/tagErrors';
import { emptyTagLibrary, normalizeTagName, setTagPath, renameTagLeaf, setSegmentTag, tagHistoryAnchor, type TagLibrary } from '../lib/tags';
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
    const countKey=JSON.stringify([o.context,o.recordingId,library.tags.map(tag=>[tag.id,tag.parentId]),o.transcript?.segments.map(segment=>[segment.id,segment.tagIds])]);
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
    const create = useCallback(async(raw:string,existingId?:string)=>{
        const current=latest.current;
        if(current.readOnly||pending.current)throw new Error(current.errorMessage);
        if(existingId){const existing=libraryRef.current.tags.find(tag=>tag.id===existingId);if(!existing)throw new Error(current.errorMessage);return existing.id;}
        const {library:next,tag}=setTagPath(libraryRef.current,raw);
        if(JSON.stringify(next)!==JSON.stringify(libraryRef.current))await change(next);
        return tag.id;
    },[change]);
    const add = useCallback(async (segmentId: string, rawName: string) => { const current = latest.current, context = current.context; if (current.readOnly || pending.current)
        return; if (!normalizeTagName(rawName)) return;
        try {
        const {library:next,tag}=setTagPath(libraryRef.current,rawName);
        if(JSON.stringify(next)!==JSON.stringify(libraryRef.current)) await change(next);
        if (latest.current.context !== context || latest.current.readOnly)
            return;
        const id = tag.id;
        latest.current.mutate(t => setSegmentTag(t, segmentId, id, true), 'tag:' + segmentId + ':' + id);
    }
    catch (error) {
        latest.current.onError(tagErrorMessage(error));
        throw error;
    } }, [change]);
    const remove = useCallback((segmentId: string, id: string) => { if (latest.current.readOnly || pending.current)
        return; latest.current.mutate(t => setSegmentTag(t, segmentId, id, false), 'tag:' + segmentId + ':' + id); }, []);
    const rename = useCallback(async (id: string, raw: string) => {
        try { const next=renameTagLeaf(libraryRef.current,id,raw); if(JSON.stringify(next)!==JSON.stringify(libraryRef.current))await change(next); }
        catch(error) { throw new Error(tagErrorMessage(error),{cause:error}); }
    }, [change]);
    const renamePath = useCallback(async(id:string,path:string)=>{
        try { const next=setTagPath(libraryRef.current,path,id).library; if(JSON.stringify(next)!==JSON.stringify(libraryRef.current))await change(next); }
        catch(error) { throw new Error(tagErrorMessage(error),{cause:error}); }
    },[change]);
    const attach = useCallback(async(segmentId:string,id:string)=>{
        const current=latest.current;
        if(current.readOnly||pending.current||!libraryRef.current.tags.some(tag=>tag.id===id))return;
        current.mutate(t=>setSegmentTag(t,segmentId,id,true),'tag:'+segmentId+':'+id);
    },[]);
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
        return; let cancelled = false; const timer = setTimeout(() => { void projectTagCounts(project, { recordingId: current.recordingId!, modelId: current.modelId!, transcript: current.transcript! },libraryRef.current).then(counts => { if (!cancelled)
        setCountResult({ key:countKey, counts, error: false }); }, () => { if (!cancelled)
        setCountResult({ key:countKey, counts: null, error: true }); }); }, 120); return () => { cancelled = true; clearTimeout(timer); }; }, [countKey, retry]);
    const countCurrent = countResult?.key === countKey, counts = countCurrent ? countResult?.counts ?? null : null, countError = countCurrent && !!countResult?.error;
    return { library, busy, change, create, add, remove, rename, renamePath, attach, canUndo, canRedo, undo, redo, counts, countError, discardRedo, retryCounts: () => setRetry(n => n + 1) };
}
