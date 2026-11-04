import {isSharedTagRestriction,rejectSharedTagStructure,showSharedTagRestriction} from '../lib/sharedTagGuard';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Transcript } from '../types';
import {msg} from '../i18n';
import {beginTagProbe} from '../lib/tagPerformance';
import {placeGroupTag,type GroupTagPlacement} from '../lib/tagPlacement';
import {cleanTagOrders,dragSiblingOrder,sortVersionTagsByName,type TagOrderView} from '../lib/tagOrdering';
import { tagOrderHistoryRebase } from '../lib/tagOrderHistory';
import {dragProjectTree,sortProjectTree} from '../lib/projectTreeOrder';
import { tagErrorMessage } from '../lib/tagErrors';
import { TagTreeError, emptyTagLibrary, normalizeTagName, resolveTagInput, setSegmentTag, tagAncestors, tagHistoryAnchor, tagPath, type TagLibrary } from '../lib/tags';
import { admitTags, changeSharedTag, collectionFromLibrary, collectionLibrary, projectTagCatalog, removeVersionTagBranch, TagMergeRequired, versionTagCollection, type TagConsumer } from '../lib/tagCollections';
import type { CurrentTagVersion, ProjectTagChange, TagTransactionReceipt, TagTransactionScope } from '../lib/projectTagRepository';
import type { OpenProject } from '../lib/projectStore';
import { applyTagFields, tagFields } from '../lib/projectTagRepository';

export interface TagStorage {
    /** Publish catalog and editor history together, after durability; never await recents between them. */
    publish?: (project: OpenProject, publishVersion: () => void) => void;
    structureBlocked?:()=>string|null;
    projectId?:string;
    projectRevision?:number;counts?:(currentId?:string)=>Promise<import('../lib/tagCountCache').TagCountTotals>;
    requiresMigration?: boolean;
    transact: (current: CurrentTagVersion, operation: (library: TagLibrary, consumers: TagConsumer[], currentId: string) => ProjectTagChange, scope?: TagTransactionScope) => Promise<{
        project: OpenProject; transcript: Transcript; receipt: TagTransactionReceipt; changed?: boolean;
    }>;
    restore: (receipt: TagTransactionReceipt, redo: boolean) => Promise<OpenProject>;
}
interface Options {
    library?: TagLibrary;
    storage?: TagStorage;
    recordingId?: string;
    modelId?: string | null;
    editId?: string;
    context: string;
    transcript: Transcript | null;
    flush: () => Promise<void>;
    publish: (transcript: Transcript, action: 'commit' | 'undo' | 'redo' | 'rebase', historyKey?: string, rebase?: (snapshot: Transcript) => Transcript) => void;
    undoActionKey: string | null;
    redoActionKey: string | null;
    lock: (busy: boolean) => void;
    readOnly: boolean;
    originalReadOnly?: boolean;
    onError: (message: string) => void;
    errorMessage: string;
}
interface Entry { receipt: TagTransactionReceipt; beforeAnchor: string; afterAnchor: string; key: string }
interface MergePrompt { request: TagMergeRequired; finish: (accepted: boolean) => void }
const EMPTY = emptyTagLibrary();

export function useProjectTags(o: Options) {
    const source = o.library ?? EMPTY;
    const projection = useMemo(() => {
        try {
            const catalog = projectTagCatalog(source);
            const collection = o.transcript ? versionTagCollection(o.transcript, source) : { schemaVersion: 1 as const, tagIds: [], groups: [] };
            return { library: collectionLibrary(catalog, collection), collection, error: '' };
        } catch (error) { return { library: source, collection: { schemaVersion: 1 as const, tagIds: [], groups: [] }, error: tagErrorMessage(error) }; }
    }, [source, o.transcript]);
    const [busy, setBusy] = useState(false), [past, setPast] = useState<Entry[]>([]), [future, setFuture] = useState<Entry[]>([]);
    const [mergePrompt, setMergePrompt] = useState<MergePrompt | null>(null);
    const latest = useRef(o), pending = useRef(false), mounted = useRef(true), mergeRef = useRef<MergePrompt | null>(null);
    const historyEntries = useRef({ past, future });
    useLayoutEffect(() => { historyEntries.current = { past, future }; });
    useLayoutEffect(() => { latest.current = o; });
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; mergeRef.current?.finish(false); }; }, []);
    useEffect(() => { const context = o.context; queueMicrotask(() => { if (latest.current.context === context) { setPast([]); setFuture([]); } }); }, [o.context]);
    const discardRedo = useCallback(() => setFuture([]), []);
    const acceptTransaction = useCallback((receipt: TagTransactionReceipt) => {
        const current = latest.current;
        if (!current.transcript) throw Error('tag_view_changed_after_save');
        const id = `${current.recordingId}:${current.modelId}:${current.originalReadOnly ? 'original' : current.editId}`;
        const patch = receipt.versions.find(version => version.id === id);
        if (patch && JSON.stringify(tagFields(current.transcript)) !== JSON.stringify(patch.before)) throw Error('tag_view_changed_after_save');
        const next = patch ? {...applyTagFields(current.transcript, patch.after),...(patch.afterRevision?{tagStorageRevision:patch.afterRevision}:{})} : current.transcript;
        const key = 'tag-transaction:' + crypto.randomUUID(), beforeAnchor = tagHistoryAnchor(current.transcript);
        current.publish(next, 'commit', key);
        setPast(entries => [...entries, {receipt,beforeAnchor,afterAnchor:tagHistoryAnchor(next),key}].slice(-100)); setFuture([]);
        return !current.originalReadOnly;
    }, []);
    const confirmMerge = (request: TagMergeRequired) => new Promise<boolean>(resolve => {
        const prompt: MergePrompt = { request, finish: accepted => { mergeRef.current = null; setMergePrompt(null); resolve(accepted); } };
        mergeRef.current = prompt; setMergePrompt(prompt);
    });
    const run = useCallback(async (operation: (merge: boolean, library: TagLibrary, consumers: TagConsumer[], currentId: string) => ProjectTagChange, scope: TagTransactionScope = 'project', orderView?: 'level' | 'groups') => {
        const undoable = !orderView;
        let current = latest.current;
        if (current.readOnly || pending.current || !current.storage) throw Error('tag_write_unavailable');
        const context = current.context;
        const probe=beginTagProbe('ui-tag',undefined,current.storage.projectId);
        pending.current = true;
        try {
            // Flush the text draft before acquiring the tag editing guard.
            await current.flush();
            probe?.mark('draftFlushed');
            current = latest.current;
            if (current.context !== context || current.readOnly || !current.transcript || !current.recordingId || !current.modelId || !current.editId || !current.storage)
                throw Error('tag_write_unavailable');
            current.lock(true); setBusy(true);
            const version = { recordingId: current.recordingId, modelId: current.modelId, editId: current.editId, transcript: current.transcript };
            const beforeAnchor = tagHistoryAnchor(current.transcript);
            let result;
            try { result = await current.storage.transact(version, (library, consumers, id) => operation(false, library, consumers, id), scope); }
            catch (error) {
                if (!(error instanceof TagMergeRequired)) throw error;
                if (!await confirmMerge(error)) throw Error('tag_operation_cancelled',{cause:error});
                result = await current.storage.transact(version, (library, consumers, id) => operation(true, library, consumers, id), scope);
            }
            if (!mounted.current || latest.current.context !== context) throw Error('tag_context_changed_after_save');
            if(result.changed===false&&undoable)return result;
            const key='tag-transaction:'+crypto.randomUUID();
            const previous = historyEntries.current;
            const rebase = orderView && tagOrderHistoryRebase(result.transcript.tagCollection!, orderView,
                `${current.recordingId}:${current.modelId}:${current.editId}`, [...previous.past, ...[...previous.future].reverse()].map(entry => entry.receipt), result.receipt, result.transcript);
            const publish = () => {
                latest.current.publish(result.transcript, undoable?'commit':'rebase', key, rebase ? rebase.snapshot : undefined);
                if(undoable) {
                    setPast(entries => [...entries, { receipt: result.receipt, beforeAnchor, afterAnchor: tagHistoryAnchor(result.transcript),key }].slice(-100));
                    setFuture([]);
                } else if (rebase) {
                    // Reconnect only the boundary changed by this known non-undoable transaction.
                    const remap = (entries: Entry[], redo: boolean) => entries.map((entry, index) => {
                        let receipt = rebase.receipt(entry.receipt);
                        const expected = redo ? receipt.beforeHead : receipt.afterHead;
                        if (index === entries.length - 1 && expected === result.receipt.beforeHead)
                            receipt = { ...receipt, ...(redo ? { beforeHead: result.receipt.afterHead } : { afterHead: result.receipt.afterHead }) };
                        return { ...entry, receipt };
                    });
                    setPast(remap(previous.past, false)); setFuture(remap(previous.future, true));
                }
                setBusy(false);
            };
            if(current.storage.publish)current.storage.publish(result.project,publish);else publish();
            probe?.mark('published');
            return result;
        } catch (error) {
            if(isSharedTagRestriction(error))showSharedTagRestriction(undefined,error);
            else if (!(error instanceof TagTreeError && error.code === 'name_conflict') && !(error instanceof TagMergeRequired) && (error as Error)?.message !== 'tag_operation_cancelled') latest.current.onError(tagErrorMessage(error));
            throw error;
        } finally { pending.current = false; current.lock(false); if (mounted.current) setBusy(false);probe?.finish(); }
    }, []);
    const change = useCallback(async (next: TagLibrary) => {
        const local = JSON.stringify(projectTagCatalog(next)) === JSON.stringify(projectTagCatalog(latest.current.library ?? EMPTY));
        await run((_merge, _library, consumers, currentId) => {
            const library = projectTagCatalog(next), valid = new Set(library.tags.map(tag => tag.id));
            return { library, consumers: consumers.map(consumer => {
                const before = consumer.transcript.tagCollection!;
                const retained = { ...before, tagIds: before.tagIds.filter(id => valid.has(id)),
                    groups: before.groups.map(group => ({ ...group, tagIds: group.tagIds.filter(id => valid.has(id)) })) };
                const collection = admitTags(library, cleanTagOrders(library, retained), [] , consumer.label);
                return { ...consumer, transcript: { ...consumer.transcript,
                    tagCollection: consumer.id === currentId ? collectionFromLibrary(next, collection, consumer.label) : collection,
                    segments: consumer.transcript.segments.map(segment => {
                        const ids = segment.tagIds?.filter(id => valid.has(id));
                        return ids?.length === segment.tagIds?.length ? segment : { ...segment, tagIds: ids };
                    }) } };
            }) };
        }, local ? 'current' : 'project');
    }, [run]);
    const create = useCallback(async (raw: string, existingId?: string, segmentId?: string) => {
        let created = '';
        const restriction=latest.current.storage?.structureBlocked?.();
        if(restriction&&!existingId&&resolveTagInput(projection.library,raw).library!==projection.library){showSharedTagRestriction(undefined,restriction);rejectSharedTagStructure(restriction);}
        await run((_merge, library, consumers, currentId) => {
            if(segmentId&&!consumers.find(consumer=>consumer.id===currentId)?.transcript.segments.some(segment=>segment.id===segmentId))throw Error('tag_segment_not_found');
            const found = existingId ? library.tags.find(tag => tag.id === existingId) : undefined;
            if (existingId && !found) throw Error('tag_entity_not_found');
            const result = found ? { library, tag: found } : resolveTagInput(library, raw);
            const currentRestriction=latest.current.storage?.structureBlocked?.();
            if(currentRestriction&&result.library!==library)rejectSharedTagStructure(currentRestriction);
            created = result.tag.id;
            return { library: result.library, consumers: consumers.map(consumer => consumer.id !== currentId ? consumer : {
                ...consumer, transcript: { ...(segmentId ? setSegmentTag(consumer.transcript, segmentId, created, true) : consumer.transcript),
                    tagCollection: admitTags(result.library, consumer.transcript.tagCollection!, [created], consumer.label) },
            }) };
        }, 'additions');
        return created;
    }, [run,projection.library]);
    const add = useCallback(async (segmentId: string, raw: string) => { if (normalizeTagName(raw)) await create(raw, undefined, segmentId); }, [create]);
    const attach = useCallback(async (segmentId: string, id: string) => { await create('', id, segmentId); }, [create]);
    const replace = useCallback(async (segmentId:string,oldId:string,raw:string) => {
        try { await run((_merge,library,consumers,currentId)=>{
            const current=consumers.find(consumer=>consumer.id===currentId);
            const segment=current?.transcript.segments.find(segment=>segment.id===segmentId);
            if(!segment?.tagIds?.includes(oldId))throw Error('tag_segment_not_found');
            const resolved=resolveTagInput(library,raw);
            if(resolved.tag.id===oldId)return {library,consumers};
            const restriction=latest.current.storage?.structureBlocked?.();
            if(restriction&&resolved.library!==library)rejectSharedTagStructure(restriction);
            return {library:resolved.library,consumers:consumers.map(consumer=>consumer.id!==currentId?consumer:{...consumer,transcript:{
                ...setSegmentTag(setSegmentTag(consumer.transcript,segmentId,oldId,false),segmentId,resolved.tag.id,true),
                tagCollection:admitTags(resolved.library,consumer.transcript.tagCollection!,[resolved.tag.id],consumer.label),
            }})};
        },'additions'); } catch(error) {throw Error(tagErrorMessage(error),{cause:error});}
    },[run]);
    const remove = useCallback((segmentId: string, id: string) => {
        return run((_merge, library, consumers, currentId) => ({ library, consumers: consumers.map(consumer => consumer.id !== currentId ? consumer
            : { ...consumer, transcript: setSegmentTag(consumer.transcript, segmentId, id, false) }) }), 'current').catch(() => {});
    }, [run]);
    const renamePath = useCallback(async (id: string, path: string) => {
        try { await run((merge, library, consumers) => changeSharedTag(library, id, path, consumers, merge)); }
        catch(error) { throw Error(tagErrorMessage(error), {cause:error}); }
    }, [run]);
    const rename = useCallback(async (id: string, name: string) => {
        if (name.includes('/')) throw Error(msg('tags.leafOnly'));
        try { await run((merge, library, consumers) => {
            const prefix = tagAncestors(library, id).reverse().map(tag => tag.name);
            return changeSharedTag(library, id, [...prefix, name].join('/'), consumers, merge);
        }); } catch(error) { throw Error(tagErrorMessage(error), {cause:error}); }
    }, [run]);
    const reparent = useCallback(async (id: string, parentId: string | null,anchor?:string|null,after=true) => {
        await run((merge, library, consumers,currentId) => {
            const path=[parentId?tagPath(library,parentId):'',library.tags.find(tag=>tag.id===id)!.name].filter(Boolean).join('/');
            const changed=changeSharedTag(library,id,path,consumers,merge);
            const retainedId=changed.library.tags.some(tag=>tag.id===id)?id:changed.library.tags.find(tag=>tagPath(changed.library,tag.id).toLowerCase()===path.toLowerCase())!.id;
            if(anchor!==undefined){
                if(changed.library.schemaVersion===4)changed.library=dragProjectTree(changed.library,retainedId,anchor,after);
                else changed.consumers=changed.consumers.map(consumer=>consumer.id===currentId?{...consumer,transcript:{...consumer.transcript,tagCollection:dragSiblingOrder(changed.library,consumer.transcript.tagCollection!,'level',retainedId,anchor,after)}}:consumer);
            }
            return changed;
        });
    }, [run]);
    const reorder = useCallback(async(view:TagOrderView,id:string,anchor:string|null,after:boolean,groupId?:string)=>{
        const shared=latest.current.library?.schemaVersion===4;
        if(shared&&view!=='level')throw Error('unsupported_tag_operation');
        await run((_merge,library,consumers,currentId)=>shared?{library:dragProjectTree(library,id,anchor,after),consumers}:{library,consumers:consumers.map(row=>row.id===currentId?{...row,transcript:{...row.transcript,tagCollection:dragSiblingOrder(library,row.transcript.tagCollection!,view,id,anchor,after,groupId)}}:row)},shared?'order':'current');
    },[run]);
    const sortByName=useCallback(async(view:'level'|'groups')=>{
        const shared=latest.current.library?.schemaVersion===4;
        if(shared&&view!=='level')throw Error('unsupported_tag_operation');
        await run((_merge,library,consumers,currentId)=>shared?{library:sortProjectTree(library),consumers}:{library,consumers:consumers.map(row=>row.id===currentId?{...row,transcript:{...row.transcript,tagCollection:sortVersionTagsByName(library,row.transcript.tagCollection!,view)}}:row)},shared?'order':'current',view);
    },[run]);
    const placeInGroup=useCallback(async(placement:GroupTagPlacement)=>{
        const source=latest.current.library?.tags.find(tag=>tag.id===placement.tagId);
        await run((merge,library,consumers,currentId)=>placeGroupTag(library,consumers,currentId,placement,merge),(source?.parentId??null)===placement.parentId?'current':'project');
    },[run]);
    const removeCurrent = useCallback(async(id:string)=>{
        await run((_merge,library,consumers,currentId)=>({library,consumers:consumers.map(consumer=>consumer.id!==currentId?consumer:
            {...consumer,transcript:removeVersionTagBranch(library,consumer.transcript,id)})}), 'current');
    },[run]);
    const anchor = useMemo(() => tagHistoryAnchor(o.transcript), [o.transcript]), canUndo = !!past.length && past.at(-1)!.afterAnchor === anchor && o.undoActionKey===past.at(-1)!.key,
        canRedo = !!future.length && future.at(-1)!.beforeAnchor === anchor && o.redoActionKey===future.at(-1)!.key;
    const history = async (redo: boolean) => {
        const current = latest.current, entry = (redo ? future : past).at(-1);
        if (!entry || !(redo ? canRedo : canUndo) || current.readOnly || pending.current || !current.storage) return;
        pending.current = true;
        try {
            await current.flush(); current.lock(true); setBusy(true);
            const project=await current.storage.restore(entry.receipt, redo);
            const publish=()=>{
                current.publish(current.transcript!, redo ? 'redo' : 'undo');
                if (redo) { setFuture(old => old.slice(0, -1)); setPast(old => [...old, entry]); }
                else { setPast(old => old.slice(0, -1)); setFuture(old => [...old, entry]); }
                setBusy(false);
            };
            if(current.storage.publish)current.storage.publish(project,publish);else publish();
        } catch (error) { if(isSharedTagRestriction(error))showSharedTagRestriction(undefined,error);else current.onError(tagErrorMessage(error)); }
        finally { pending.current = false; current.lock(false); if (mounted.current) setBusy(false); }
    };
    return { ...projection, busy, change, create, add, replace, remove, removeCurrent, rename, renamePath, reparent,reorder,sortByName,placeInGroup, attach, canUndo, canRedo, acceptTransaction,
        undo: () => history(false), redo: () => history(true), discardRedo, mergePrompt };
}
