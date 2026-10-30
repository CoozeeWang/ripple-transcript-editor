import type { Transcript } from '../types';
import { stemOf, withTagVersionStorage } from '../localStore';
import { parseProject, recordingDirectory, withProjectLock, type OpenProject, type ProjectInterview, type ProjectRecording, type TagRequestReceipt } from './projectStore';
import { commitTagFileTransaction, recoverTagFileTransaction, readTagFile, type TagFilePatch } from './tagFileTransaction';
import { projectTagCatalog, validateTagCollection, versionTagCollection, type TagConsumer } from './tagCollections';
import type { TagLibrary } from './tags';

export interface CurrentTagVersion { recordingId: string; modelId: string; editId: string; transcript: Transcript }
/** Current-version changes cannot modify shared definitions; additions may only append entities. */
export type TagTransactionScope = 'project' | 'current' | 'additions';
interface StoredConsumer extends TagConsumer { path: string[]; raw: string; readOnly: boolean }
export interface TagFields { collection: Transcript['tagCollection']; segments: [string, string[] | undefined][] }
export interface TagTransactionReceipt {
    beforeLibrary: TagLibrary; afterLibrary: TagLibrary;
    versions: { id?: string; path: string[]; before: TagFields; after: TagFields }[];
    scope?: TagTransactionScope;
    beforeHead?: string; afterHead?: string; requestId?: string;
}
export interface ProjectTagChange {
    library: TagLibrary;
    consumers: TagConsumer[];
}
export const tagFields = (transcript: Transcript): TagFields => ({ collection: transcript.tagCollection,
    segments: transcript.segments.map(segment => [segment.id, segment.tagIds]) });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const safe = (name: string) => !!name && name !== '.' && name !== '..' && !/[\\/]/.test(name) && !Array.from(name).some(char=>char.charCodeAt(0)<32);

function recordingSources(project: OpenProject, include: (session: ProjectInterview, recording: ProjectRecording) => boolean = () => true): { session: ProjectInterview; recording: ProjectRecording }[] {
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
                        const path = ['interviews', session.id, container.name, version.file], identity = JSON.stringify(path);
                        if (paths && !paths.has(identity)) continue;
                        if (seen.has(identity)) continue; seen.add(identity);
                        const raw = await readTagFile(project.directory, path);
                        if (raw === null) throw Error('tag_consumer_version_unavailable');
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
function versionPatch(consumer: StoredConsumer, next: TagFields): TagFilePatch {
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
    return withProjectLock(project.data.id, async () => {
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
            const currentId = `${current.recordingId}:${current.modelId}:${current.editId}`;
            const active = stored.find(consumer => consumer.id === currentId);
            if (!active || active.readOnly) throw Error('tag_write_read_only');
            const source = data.tagLibrary ?? { schemaVersion: 3, tags: [], groups: [] };
            const library = projectTagCatalog(source);
            const consumers = stored.map(consumer => ({ ...consumer, transcript: { ...consumer.transcript,
                tagCollection: versionTagCollection(consumer.transcript, source) } }));
            const result = await operation(library, consumers, currentId);
            request?.assert();
            const nextLibrary = projectTagCatalog(result.library);
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
                    changed.push({ id: previous.id, path: previous.path, before, after }); patches.push(versionPatch(previous, after));
                }
            }
            const semanticChange=!!patches.length||!same(source,nextLibrary), afterHead=semanticChange?crypto.randomUUID():data.tagHead;
            const receipt = { beforeLibrary: source, afterLibrary: nextLibrary, versions: changed, scope, beforeHead:data.tagHead, afterHead, requestId:request?.id };
            const transcript = result.consumers.find(consumer => consumer.id === currentId)!.transcript;
            if (!semanticChange&&!request) return { project, transcript, receipt, changed: false };
            const tagRequests=request?Object.fromEntries([...Object.entries(data.tagRequests??{}).slice(-99),[request.id,request.receipt()]]):data.tagRequests;
            const nextData = { ...data, tagLibrary: nextLibrary, tagHead:afterHead, ...(tagRequests?{tagRequests}:{}), revision: data.revision + 1 };
            const afterIndex = JSON.stringify(nextData, null, 2); parseProject(afterIndex);
            patches.push({ path: ['ripple-project.json'], before: index, after: afterIndex });
            request?.assert();
            await commitTagFileTransaction(project.directory, patches);
            return { project: { ...project, data: nextData }, transcript, receipt, changed: semanticChange };
        }, scope === 'project' ? undefined : { currentOnly: true });
    });
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
                patches.push(versionPatch(previous, redo ? version.after : version.before));
            }
            const tagRequests=receipt.requestId&&data.tagRequests?.[receipt.requestId]?{...data.tagRequests,[receipt.requestId]:{...data.tagRequests[receipt.requestId],undone:!redo}}:data.tagRequests;
            const next = { ...data, tagLibrary: redo ? receipt.afterLibrary : receipt.beforeLibrary,
                ...(receipt.afterHead?{tagHead:redo?receipt.afterHead:receipt.beforeHead}:{}),...(tagRequests?{tagRequests}:{}), revision: data.revision + 1 };
            patches.push({ path: ['ripple-project.json'], before: index, after: JSON.stringify(next, null, 2) });
            await commitTagFileTransaction(project.directory, patches);
            return { ...project, data: next };
        }, receipt.scope && receipt.scope !== 'project' ? { paths: receipt.versions.map(version => version.path) } : undefined);
    });
}
