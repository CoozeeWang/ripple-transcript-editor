import {cachedProjectTagCounts,storeProjectTagCounts,updateProjectTagCounts,type TagCountTotals} from './tagCountCache';
import type { Transcript } from '../types';
import { stemOf, withTagVersionStorage } from '../localStore';
import { parseProject, recordingDirectory, withProjectLock, type OpenProject, type ProjectInterview, type ProjectRecording, type TagRequestReceipt } from './projectStore';
import { commitTagFileTransaction, recoverTagFileTransaction, readTagFile, type TagFilePatch } from './tagFileTransaction';
import { projectTagCatalog, validateTagCollection, versionTagCollection, type TagConsumer } from './tagCollections';
import type { TagLibrary } from './tags';
import {beginTagProbe} from './tagPerformance';
import {cleanTagOrders} from './tagOrdering';
import {sidecarName,parseTagSidecar,sidecarTranscript,verifyTagSource,tagFields as fieldsOf, type TagSidecar} from './tagSidecar';

export interface CurrentTagVersion { recordingId: string; modelId: string; editId: string; transcript: Transcript }
/** Current-version changes cannot modify shared definitions; additions may only append entities. */
export type TagTransactionScope = 'project' | 'current' | 'additions';
interface StoredConsumer extends TagConsumer { path: string[]; raw: string; readOnly: boolean; metadata?:TagSidecar }
export interface TagFields { collection: Transcript['tagCollection']; segments: [string, string[] | undefined][] }
export interface TagTransactionReceipt {
    beforeLibrary: TagLibrary; afterLibrary: TagLibrary;
    versions: { id?: string; path: string[]; before: TagFields; after: TagFields; beforeRevision?:string;afterRevision?:string }[];
    scope?: TagTransactionScope;
    beforeHead?: string; afterHead?: string; requestId?: string;
}
export interface ProjectTagChange {
    library: TagLibrary;
    consumers: TagConsumer[];
}
export const tagFields = fieldsOf;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const safe = (name: string) => !!name && name !== '.' && name !== '..' && !/[\\/]/.test(name) && !Array.from(name).some(char=>char.charCodeAt(0)<32);

export function recordingSources(project: OpenProject, include: (session: ProjectInterview, recording: ProjectRecording) => boolean = () => true): { session: ProjectInterview; recording: ProjectRecording }[] {
    const result = project.data.interviews.flatMap(session => session.recordings.map(recording => ({ session, recording })));
    for (const trash of project.data.trash ?? []) {
        const session = project.data.interviews.find(session => session.id === trash.interviewId);
        if (session) result.push({ session, recording: trash.recording });
    }
    for (const trash of project.data.sessionTrash ?? []) {
        result.push(...trash.interview.recordings.map(recording => ({ session: trash.interview, recording })));
        result.push(...(trash.materialTrash ?? []).map(item => ({ session: trash.interview, recording: item.recording })));
    }
    const seen = new Set<string>();
    return result.filter(({ session, recording }) => {
        if (!include(session, recording)) return false;
        const key = `${session.id}:${recording.manuscriptDirectory ?? stemOf(recording.file)}`;
        if (seen.has(key)) return false; seen.add(key); return true;
    }).sort((a, b) => a.recording.id.localeCompare(b.recording.id));
}

/** Hold every version directory in stable order, including versions in recoverable project trash. */
async function withConsumers<T>(project: OpenProject, current: CurrentTagVersion | null,
    work: (consumers: StoredConsumer[]) => Promise<T>, selection?: { currentOnly?: boolean; paths?: readonly string[][] }): Promise<T> {
    const paths = selection?.paths && new Set(selection.paths.map(path => JSON.stringify(path)));
    const folders = selection?.paths && new Set(selection.paths.map(path => `${path[1]}:${path[2]}`));
    const sources = recordingSources(project, (session, recording) =>
        (!selection?.currentOnly || recording.id === current?.recordingId) &&
        (!folders || folders.has(`${session.id}:${recording.manuscriptDirectory ?? stemOf(recording.file) + '.transcript'}`)));
    const consumers: StoredConsumer[] = [], seen = new Set<string>();
    async function next(index: number): Promise<T> {
        if (index === sources.length) return work(consumers);
        const { session, recording } = sources[index];
        const directory = await recordingDirectory(project, session.id, recording);
        return withTagVersionStorage(directory, recording.file, async (container, manifest) => {
            if (container && manifest) {
                for (const model of manifest.models) {
                    const versions = [...(model.original ? [{ id: 'original', file: model.original, label: model.label ?? model.id, readOnly: true }] : []),
                        ...model.edits.map(edit => ({ id: edit.id, file: edit.file, label: edit.label ?? edit.id, readOnly: !!model.designatedOriginal }))];
                    for (const version of versions) {
                        const active = current && recording.id === current.recordingId && model.id === current.modelId && version.id === current.editId;
                        if (selection?.currentOnly && !active) continue;
                        if (!safe(version.file) || !safe(container.name)) throw Error('tag_transaction_invalid_version_file');
                        const path = ['interviews', session.id, container.name, project.data.schemaVersion===2?await sidecarName(version.file):version.file], identity = JSON.stringify(path);
                        if (paths && !paths.has(identity)) continue;
                        if (seen.has(identity)) continue; seen.add(identity);
                        const raw = await readTagFile(project.directory, path);
                        if (raw === null) throw Error('tag_consumer_version_unavailable');
                        if(project.data.schemaVersion===2){
                            const metadata=parseTagSidecar(raw,version.file);metadata.body=await verifyTagSource(container,metadata);
                            if(active&&!same({...tagFields(current.transcript),collection:versionTagCollection(current.transcript,project.data.tagLibrary??{schemaVersion:3,tags:[],groups:[]})},{collection:metadata.collection,segments:metadata.segments}))throw Error('tag_metadata_stale_write');
                            consumers.push({id:`${recording.id}:${model.id}:${version.id}`,label:`${recording.name} · ${version.label}`,
                                transcript:active?current.transcript:sidecarTranscript(metadata),path,raw,readOnly:version.readOnly,metadata});
                            continue;
                        }
                        const parsed = JSON.parse(raw) as { transcript?: Transcript };
                        if (!parsed.transcript || !Array.isArray(parsed.transcript.segments)) throw Error('tag_consumer_version_unavailable');
                        const transcript = active ? current.transcript : parsed.transcript;
                        consumers.push({ id: `${recording.id}:${model.id}:${version.id}`, label: `${recording.name} · ${version.label}`,
                            transcript, path, raw, readOnly: version.readOnly });
                    }
                }
            }
            return next(index + 1);
        });
    }
    return next(0);
}

export function applyTagFields(transcript: Transcript, tags: TagFields): Transcript {
    const byId = new Map(tags.segments);
    // A new/deleted segment is a concurrent content edit, not permission to restore an old body.
    if (transcript.segments.length !== byId.size || transcript.segments.some(segment => !byId.has(segment.id)))
        throw Error('tag_transaction_content_changed');
    return { ...transcript, tagCollection: tags.collection,
        segments: transcript.segments.map(segment => same(segment.tagIds,byId.get(segment.id)) ? segment : { ...segment, tagIds: byId.get(segment.id) }) };
}
function versionPatch(consumer: StoredConsumer, next: TagFields, revision?:string): TagFilePatch {
    if(consumer.metadata){
        const metadata={...consumer.metadata,revision:revision??crypto.randomUUID(),collection:next.collection,segments:next.segments};
        const raw=JSON.stringify(metadata);parseTagSidecar(raw,consumer.metadata.file);
        return{path:consumer.path,before:consumer.raw,after:raw};
    }
    const document = JSON.parse(consumer.raw) as { transcript: Transcript };
    return { path: consumer.path, before: consumer.raw,
        after: JSON.stringify({ ...document, transcript: applyTagFields(document.transcript, next) }, null, 2) };
}
export class TagRequestAlreadySaved extends Error {
    constructor(readonly receipt:TagRequestReceipt) { super('tag_request_already_saved'); }
}
export interface TagRequest {
    id:string; receipt:()=>TagRequestReceipt; signature:string; client:string; assert:()=>void;
}

/** Caller flushes the active editor first and holds human/AI navigation guards until publication. */
export async function transactProjectTags(project: OpenProject, current: CurrentTagVersion,
    operation: (library: TagLibrary, consumers: TagConsumer[], currentId: string) => ProjectTagChange | Promise<ProjectTagChange>,
    scope: TagTransactionScope = 'project', request?:TagRequest): Promise<{
        project: OpenProject; transcript: Transcript; receipt: TagTransactionReceipt; changed: boolean;
    }> {
    const probe=beginTagProbe('repository-'+scope,project.directory,project.data.id);
    probe?.mark('lockRequested');
    return withProjectLock(project.data.id, async () => {
        probe?.mark('projectLock');
        await recoverTagFileTransaction(project.directory);
        const index = await readTagFile(project.directory, ['ripple-project.json']);
        if (!index) throw Error('project_changed');
        const data = parseProject(index);
        if(request){
            request.assert();const saved=data.tagRequests?.[request.id];
            if(saved){if(saved.signature!==request.signature||saved.client!==request.client)throw Error('tag_request_conflict');throw new TagRequestAlreadySaved(saved);}
        }
        if (data.id !== project.data.id || data.revision !== project.data.revision) throw Error('project_changed');
        return withConsumers(project, current, async stored => {
            probe?.mark('consumersLoaded');
            const currentId = `${current.recordingId}:${current.modelId}:${current.editId}`;
            const active = stored.find(consumer => consumer.id === currentId);
            if (!active || active.readOnly) throw Error('tag_write_read_only');
            const source = data.tagLibrary ?? { schemaVersion: 3, tags: [], groups: [] };
            const library = projectTagCatalog(source);
            const consumers = stored.map(consumer => ({ ...consumer, transcript: { ...consumer.transcript,
                tagCollection: versionTagCollection(consumer.transcript, source) } }));
            const computed = await operation(library, consumers, currentId);
            request?.assert();
            const nextLibrary = projectTagCatalog(computed.library);
            const result={...computed,consumers:computed.consumers.map(consumer=>{
                if(!consumer.transcript.tagCollection)return consumer;
                const collection=cleanTagOrders(nextLibrary,consumer.transcript.tagCollection);
                return collection===consumer.transcript.tagCollection?consumer:{...consumer,transcript:{...consumer.transcript,tagCollection:collection}};
            })};
            // The fast path is an explicit capability, never a heuristic that can skip a shared edit's preflight.
            if (scope === 'current' && !same(library, nextLibrary)) throw Error('tag_transaction_scope_violation');
            if (scope === 'additions') {
                const retained = { ...nextLibrary, tags: nextLibrary.tags.filter(tag => library.tags.some(old => old.id === tag.id)) };
                if (!same(library, retained)) throw Error('tag_transaction_scope_violation');
            }
            if (new Set(result.consumers.map(consumer => consumer.id)).size !== stored.length) throw Error('tag_transaction_missing_consumer');
            const changed: TagTransactionReceipt['versions'] = [], patches: TagFilePatch[] = [];
            for (const previous of stored) {
                const updated = result.consumers.find(consumer => consumer.id === previous.id);
                if (!updated?.transcript.tagCollection) throw Error('tag_transaction_missing_consumer');
                validateTagCollection(nextLibrary, updated.transcript.tagCollection, previous.label);
                const before = tagFields(previous.transcript), after = tagFields(updated.transcript);
                const baseline = tagFields(consumers.find(consumer => consumer.id === previous.id)!.transcript);
                // A read-only legacy view is not a batch migration of every unopened version.
                if (!same(before, after) && (!same(baseline, after) || previous.id === currentId)) {
                    const patch=versionPatch(previous,after);
                    changed.push({ id: previous.id, path: previous.path, before, after,
                        ...(previous.metadata?{beforeRevision:previous.metadata.revision,afterRevision:parseTagSidecar(patch.after!).revision}:{}) });
                    patches.push(patch);
                }
            }
            const semanticChange=!!patches.length||!same(source,nextLibrary), afterHead=semanticChange?crypto.randomUUID():data.tagHead;
            const receipt = { beforeLibrary: source, afterLibrary: nextLibrary, versions: changed, scope, beforeHead:data.tagHead, afterHead, requestId:request?.id };
            let transcript = result.consumers.find(consumer => consumer.id === currentId)!.transcript;
            const currentChange=changed.find(change=>change.id===currentId);
            if(currentChange?.afterRevision)transcript={...transcript,tagStorageRevision:currentChange.afterRevision};
            if (!semanticChange&&!request) return { project, transcript, receipt, changed: false };
            const tagRequests=request?Object.fromEntries([...Object.entries(data.tagRequests??{}).slice(-99),[request.id,request.receipt()]]):data.tagRequests;
            const nextData = { ...data, tagLibrary: nextLibrary, tagHead:afterHead, ...(tagRequests?{tagRequests}:{}), revision: data.revision + 1 };
            const afterIndex = JSON.stringify(nextData, null, 2); parseProject(afterIndex);
            patches.push({ path: ['ripple-project.json'], before: index, after: afterIndex });
            request?.assert();
            await commitTagFileTransaction(project.directory, patches);
            updateProjectTagCounts(project.directory,index,afterIndex,changed.map(v=>({id:v.id,path:v.path,fields:v.after})),nextLibrary);
            probe?.mark('durableCommit');
            return { project: { ...project, data: nextData }, transcript, receipt, changed: semanticChange };
        }, scope === 'project' ? undefined : { currentOnly: true });
    }).finally(()=>probe?.finish());
}

/** Undo replaces only tag fields in fresh files; it never restores stale manuscript text. */
export async function restoreProjectTagTransaction(project: OpenProject, receipt: TagTransactionReceipt, redo: boolean): Promise<OpenProject> {
    return withProjectLock(project.data.id, async () => {
        await recoverTagFileTransaction(project.directory);
        const index = await readTagFile(project.directory, ['ripple-project.json']);
        if (!index) throw Error('project_changed');
        const data = parseProject(index), expected = redo ? receipt.beforeLibrary : receipt.afterLibrary;
        if (data.id !== project.data.id || data.revision !== project.data.revision || !same(data.tagLibrary, expected)) throw Error('project_changed');
        if(receipt.afterHead && data.tagHead!==(redo?receipt.beforeHead:receipt.afterHead))throw Error('tag_history_changed');
        return withConsumers(project, null, async stored => {
            const patches: TagFilePatch[] = [];
            for (const version of receipt.versions) {
                const previous = stored.find(consumer => same(consumer.path, version.path));
                if (!previous || !same(tagFields(previous.transcript), redo ? version.before : version.after)) throw Error('tag_transaction_content_changed');
                patches.push(versionPatch(previous, redo ? version.after : version.before,redo?version.afterRevision:version.beforeRevision));
            }
            const tagRequests=receipt.requestId&&data.tagRequests?.[receipt.requestId]?{...data.tagRequests,[receipt.requestId]:{...data.tagRequests[receipt.requestId],undone:!redo}}:data.tagRequests;
            const next = { ...data, tagLibrary: redo ? receipt.afterLibrary : receipt.beforeLibrary,
                ...(receipt.afterHead?{tagHead:redo?receipt.afterHead:receipt.beforeHead}:{}),...(tagRequests?{tagRequests}:{}), revision: data.revision + 1 };
            patches.push({ path: ['ripple-project.json'], before: index, after: JSON.stringify(next, null, 2) });
            await commitTagFileTransaction(project.directory, patches);
            updateProjectTagCounts(project.directory,index,JSON.stringify(next,null,2),receipt.versions.map(version=>({id:version.id,path:version.path,fields:redo?version.after:version.before})),next.tagLibrary??{schemaVersion:3,tags:[],groups:[]});
            return { ...project, data: next };
        }, receipt.scope && receipt.scope !== 'project' ? { paths: receipt.versions.map(version => version.path) } : undefined);
    });
}

/** Project counts use exact IDs in every independently saved version, never body/content equivalence. */
export async function readProjectTagCounts(project:OpenProject,currentId?:string):Promise<TagCountTotals>{
    return withProjectLock(project.data.id,async()=>{
        await recoverTagFileTransaction(project.directory);
        const index=await readTagFile(project.directory,['ripple-project.json']);if(!index)throw Error('project_changed');
        const data=parseProject(index);if(data.id!==project.data.id||data.revision!==project.data.revision)throw Error('project_changed');
        if(data.schemaVersion!==2)throw Error('tag_storage_migration_required');
        const cached=cachedProjectTagCounts(project.directory,index,currentId);if(cached)return cached;
        const library=projectTagCatalog(data.tagLibrary??{schemaVersion:3,tags:[],groups:[]});
        return withConsumers({...project,data},null,async consumers=>{for(const consumer of consumers)validateTagCollection(library,consumer.transcript.tagCollection!,consumer.label);return storeProjectTagCounts(project.directory,index,
            consumers.map(consumer=>({id:consumer.id,path:consumer.path,fields:tagFields(consumer.transcript)})),library,currentId)});
    });
}
