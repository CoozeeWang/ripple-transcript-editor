import { expect, it } from 'vitest';
import type { Transcript, TranscriptManifest } from '../types';
import { defaultMetadata } from '../localStore';
import { openProject, type OpenProject, type RippleProject } from './projectStore';
import { restoreProjectTagTransaction, transactProjectTags } from './projectTagRepository';
import { admitTags, changeSharedTag, removeVersionTagBranch, TagMergeRequired, type TagConsumer } from './tagCollections';
import { setSegmentTag, setTagPath, type TagLibrary } from './tags';
import { tagTestFs } from './tagTestFs';
import type { TagTransactionScope } from './projectTagRepository';

function fixture(fail?: (path: string) => void) {
    const fs = tagTestFs('synthetic.ripple', fail), root = 'interviews/session/sample.transcript';
    for (const path of ['interviews', 'interviews/session', root]) fs.directories.add(path);
    const library: TagLibrary = { schemaVersion: 3, tags: [], groups: [] };
    const data: RippleProject = { kind: 'ripple-project', schemaVersion: 1, id: 'project', title: '合成事务项目', description: '', revision: 0,
        tagLibrary: library, interviews: [{ id: 'session', title: '合成场次', recordings: [{ id: 'recording', name: '合成访谈', file: 'sample.wav', storage: 'none', fingerprint: '' }] }] };
    const transcript: Transcript = { audio: { filename: 'sample.wav', duration: 1 }, speakers: [], segments: [{ id: 'segment', text: '合成正文', speaker_id: 'speaker', start: 0, end: 1 }] };
    const manifest: TranscriptManifest = { schemaVersion: 2, audio: 'sample.wav', activeModelId: 'm1', models: [{ id: 'm1', engine: 'imported', activeEditId: 'e1', original: 'original.json',
        edits: [{ id: 'e1', file: 'e1.json', updated_at: '2026-01-01' }, { id: 'e2', file: 'e2.json', updated_at: '2026-01-01' }] }] };
    fs.files.set('ripple-project.json', JSON.stringify(data)); fs.files.set(root + '/manifest.json', JSON.stringify(manifest));
    for (const file of ['e1.json', 'e2.json', 'original.json']) fs.files.set(root + '/' + file, JSON.stringify({ kind: 'te-edited', audio: 'sample.wav', metadata: defaultMetadata('合成'), transcript }));
    return { ...fs, project: { directory: fs.root, data } as OpenProject, transcript, root,
        current: { recordingId: 'recording', modelId: 'm1', editId: 'e1', transcript } };
}
function addPath(library: TagLibrary, consumers: TagConsumer[], currentId: string) {
    const next = setTagPath(library, '经历/求学/小学');
    return { library: next.library, consumers: consumers.map(consumer => consumer.id !== currentId ? consumer : {
        ...consumer, transcript: { ...setSegmentTag(consumer.transcript, 'segment', next.tag.id, true),
            tagCollection: admitTags(next.library, consumer.transcript.tagCollection!, [next.tag.id], consumer.label) },
    }) };
}
it('atomically stores project definitions and only the current version collection/association', async () => {
    const fs = fixture(), other = fs.files.get(fs.root + '/e2.json'), original = fs.files.get(fs.root + '/original.json');
    const result = await transactProjectTags(fs.project, fs.current, addPath);
    const reopened = await openProject(fs.project.directory);
    expect(reopened.data.tagLibrary?.tags).toHaveLength(3);
    expect(result.transcript.tagCollection?.tagIds).toHaveLength(3);
    expect(result.transcript.segments[0].tagIds).toHaveLength(1);
    expect(fs.files.get(fs.root + '/e2.json')).toBe(other);
    expect(fs.files.get(fs.root + '/original.json')).toBe(original);
    expect(fs.files.get(fs.root + '/manifest.json')).toBeTruthy();
});
it('restores definitions and associations with one undo while preserving later manuscript text', async () => {
    const fs = fixture(), result = await transactProjectTags(fs.project, fs.current, addPath);
    const path = fs.root + '/e1.json', saved = JSON.parse(fs.files.get(path)!);
    saved.transcript.segments[0].text = '后来修改的合成正文'; fs.files.set(path, JSON.stringify(saved));
    const undone = await restoreProjectTagTransaction(result.project, result.receipt, false);
    const restored = JSON.parse(fs.files.get(path)!).transcript as Transcript;
    expect(restored.segments[0].text).toBe('后来修改的合成正文');
    expect(restored.segments[0].tagIds).toBeUndefined(); expect(undone.data.tagLibrary?.tags).toEqual([]);
    await restoreProjectTagTransaction(undone, result.receipt, true);
    const redone = JSON.parse(fs.files.get(path)!).transcript as Transcript;
    expect(redone.segments[0].text).toBe('后来修改的合成正文'); expect(redone.segments[0].tagIds).toHaveLength(1);
});
it('rolls back the entire transaction on a disk failure and never changes another version', async () => {
    let fail = true;
    const fs = fixture(path => { if (path === 'ripple-project.json' && fail) { fail = false; throw Error('synthetic full disk'); } });
    const before = new Map(fs.files);
    await expect(transactProjectTags(fs.project, fs.current, addPath)).rejects.toThrow('synthetic full disk');
    for (const [path, value] of before) expect(fs.files.get(path)).toBe(value);
});
it('forbids direct writes to an original and blocks stale project revisions before touching version files', async () => {
    const fs = fixture(), before = new Map(fs.files);
    await expect(transactProjectTags(fs.project, { ...fs.current, editId: 'original' }, addPath)).rejects.toThrow('read_only');
    fs.files.set('ripple-project.json', JSON.stringify({ ...fs.project.data, revision: 2 }));
    await expect(transactProjectTags(fs.project, fs.current, addPath)).rejects.toThrow('project_changed');
    for (const [path, value] of before) if (path !== 'ripple-project.json') expect(fs.files.get(path)).toBe(value);
});
it('validates every saved consumer and restores multi-version shared rename/merge transactions', async () => {
    const fs = fixture(), added = await transactProjectTags(fs.project, fs.current, addPath);
    const leaf = added.transcript.segments[0].tagIds![0];
    const result = await transactProjectTags(added.project, { ...fs.current, transcript: added.transcript }, (library, consumers) => changeSharedTag(library, leaf, '经历/求学/童年', consumers));
    expect(result.project.data.tagLibrary?.tags.find(tag => tag.id === leaf)?.name).toBe('童年');
    const undone = await restoreProjectTagTransaction(result.project, result.receipt, false);
    expect(undone.data.tagLibrary?.tags.find(tag => tag.id === leaf)?.name).toBe('小学');
});

it('removes only the current admitted branch, retains zero-use ancestors, and restores it after reopen', async () => {
    const fs = fixture(), added = await transactProjectTags(fs.project, fs.current, addPath);
    const leaf = added.transcript.segments[0].tagIds![0];
    const second = JSON.parse(fs.files.get(fs.root + '/e2.json')!);
    second.transcript = structuredClone(added.transcript);
    fs.files.set(fs.root + '/e2.json', JSON.stringify(second));
    const other = fs.files.get(fs.root + '/e2.json');
    const removed = await transactProjectTags(added.project, { ...fs.current, transcript: added.transcript }, (library, consumers, currentId) => ({ library,
        consumers: consumers.map(consumer => consumer.id === currentId ? { ...consumer, transcript: removeVersionTagBranch(library, consumer.transcript, leaf) } : consumer) }));
    expect(removed.transcript.tagCollection!.tagIds).toHaveLength(2);
    expect(removed.transcript.segments[0].tagIds).toEqual([]);
    expect(fs.files.get(fs.root + '/e2.json')).toBe(other);
    expect((await openProject(fs.project.directory)).data.tagLibrary?.tags).toHaveLength(3);
    const undone = await restoreProjectTagTransaction(removed.project, removed.receipt, false);
    expect(JSON.parse(fs.files.get(fs.root + '/e1.json')!).transcript.segments[0].tagIds).toEqual([leaf]);
    await restoreProjectTagTransaction(undone, removed.receipt, true);
    expect(JSON.parse(fs.files.get(fs.root + '/e1.json')!).transcript.tagCollection.tagIds).toHaveLength(2);
});

it('requires explicit merge confirmation and atomically remaps associations in every consuming version', async () => {
    const fs = fixture(), added = await transactProjectTags(fs.project, fs.current, addPath);
    const source = added.transcript.segments[0].tagIds![0], targetPath = setTagPath(added.project.data.tagLibrary!, '另一主题/童年');
    const prepared = await transactProjectTags(added.project, { ...fs.current, transcript: added.transcript }, (_library, consumers) => ({ library: targetPath.library, consumers }));
    const second = JSON.parse(fs.files.get(fs.root + '/e2.json')!);
    second.transcript = { ...fs.transcript, tagCollection: admitTags(targetPath.library, { schemaVersion: 1, tagIds: [], groups: [] }, [targetPath.tag.id]),
        segments: [{ ...fs.transcript.segments[0], tagIds: [targetPath.tag.id] }] };
    fs.files.set(fs.root + '/e2.json', JSON.stringify(second));
    const before = new Map(fs.files);
    const operation = (merge: boolean) => (library: TagLibrary, consumers: TagConsumer[]) => changeSharedTag(library, source, '另一主题/童年', consumers, merge);
    await expect(transactProjectTags(prepared.project, { ...fs.current, transcript: prepared.transcript }, operation(false))).rejects.toBeInstanceOf(TagMergeRequired);
    expect(fs.files).toEqual(before);
    const merged = await transactProjectTags(prepared.project, { ...fs.current, transcript: prepared.transcript }, operation(true));
    expect(merged.transcript.segments[0].tagIds).toEqual([targetPath.tag.id]);
    expect(JSON.parse(fs.files.get(fs.root + '/e2.json')!).transcript.segments[0].tagIds).toEqual([targetPath.tag.id]);
    const undone = await restoreProjectTagTransaction(merged.project, merged.receipt, false);
    expect(JSON.parse(fs.files.get(fs.root + '/e1.json')!).transcript.segments[0].tagIds).toEqual([source]);
    expect(undone.data.tagLibrary!.tags.some(tag => tag.id === source)).toBe(true);
});

it('reads no unopened versions for additions, current memberships, removal or their undo/redo', async () => {
    const fs = fixture(), get = fs.files.get.bind(fs.files);
    const untouched = [fs.root + '/original.json', fs.root + '/e2.json'];
    const originals = untouched.map(path => get(path));
    fs.files.get = path => { if (untouched.includes(path)) throw Error('unopened version must not be read'); return get(path); };
    const added = await transactProjectTags(fs.project, fs.current, addPath, 'additions');
    const leaf = added.transcript.segments[0].tagIds![0];
    const removed = await transactProjectTags(added.project, { ...fs.current, transcript: added.transcript }, (library, consumers, id) => ({ library,
        consumers: consumers.map(consumer => consumer.id === id ? { ...consumer, transcript: removeVersionTagBranch(library, consumer.transcript, leaf) } : consumer) }), 'current');
    const undone = await restoreProjectTagTransaction(removed.project, removed.receipt, false);
    expect(JSON.parse(get(fs.root + '/e1.json')!).transcript.segments[0].tagIds).toEqual([leaf]);
    const redone = await restoreProjectTagTransaction(undone, removed.receipt, true);
    expect(JSON.parse(get(fs.root + '/e1.json')!).transcript.segments[0].tagIds).toEqual([]);
    const undoRemoved = await restoreProjectTagTransaction(redone, removed.receipt, false);
    const undoAdded = await restoreProjectTagTransaction(undoRemoved, added.receipt, false);
    expect(undoAdded.data.tagLibrary?.tags).toEqual([]);
    untouched.forEach((path, i) => expect(get(path)).toBe(originals[i]));
});

it.each(['current', 'additions'] as TagTransactionScope[])('rejects shared definition edits in a %s transaction before writing', async scope => {
    const fs = fixture(), added = await transactProjectTags(fs.project, fs.current, addPath, 'additions');
    const before = new Map(fs.files);
    await expect(transactProjectTags(added.project, { ...fs.current, transcript: added.transcript }, (library, consumers) => ({
        library: { ...library, tags: library.tags.map((tag, i) => i ? tag : { ...tag, name: 'Changed globally' }) }, consumers,
    }), scope)).rejects.toThrow('scope_violation');
    expect(fs.files).toEqual(before);
});

it.each(['current', 'additions'] as TagTransactionScope[])('keeps original protection and rollback on the %s path', async scope => {
    let fail = false;
    const fs = fixture(path => { if (fail && path === 'ripple-project.json') { fail = false; throw Error('synthetic failure'); } });
    const added = await transactProjectTags(fs.project, fs.current, addPath, 'additions');
    const before = new Map(fs.files), leaf = added.transcript.segments[0].tagIds![0];
    const op = (library: TagLibrary, consumers: TagConsumer[], id: string) => ({ library, consumers: consumers.map(c => c.id === id ? { ...c,
        transcript: setSegmentTag(c.transcript, 'segment', leaf, false) } : c) });
    await expect(transactProjectTags(added.project, { ...fs.current, editId: 'original' }, op, scope)).rejects.toThrow('read_only');
    fail = true;
    await expect(transactProjectTags(added.project, { ...fs.current, transcript: added.transcript }, op, scope)).rejects.toThrow('synthetic failure');
    for (const [path, value] of before) expect(fs.files.get(path)).toBe(value);
});

it('continues to inspect other consumers for shared edits and reject cross-version name conflicts', async () => {
    const fs = fixture(), added = await transactProjectTags(fs.project, fs.current, addPath, 'additions');
    const otherPath = setTagPath(added.project.data.tagLibrary!, '别的主题/童年');
    const library = otherPath.library, index = { ...added.project.data, tagLibrary: library };
    fs.files.set('ripple-project.json', JSON.stringify(index));
    const other = JSON.parse(fs.files.get(fs.root + '/e2.json')!);
    other.transcript = { ...added.transcript, tagCollection: admitTags(library, added.transcript.tagCollection!, [otherPath.tag.id]) };
    fs.files.set(fs.root + '/e2.json', JSON.stringify(other));
    const before = new Map(fs.files), leaf = added.transcript.segments[0].tagIds![0];
    await expect(transactProjectTags({ ...added.project, data: index }, { ...fs.current, transcript: added.transcript },
        (catalog, consumers) => changeSharedTag(catalog, leaf, '经历/求学/童年', consumers))).rejects.toThrow('tag_collection_name_conflict');
    expect(fs.files).toEqual(before);
});

it('blocks undo after a later foreign tag transaction, preventing dangling IDs in another version',async()=>{
 const fs=fixture(),added=await transactProjectTags(fs.project,fs.current,addPath,'additions');
 const leaf=added.transcript.segments[0].tagIds![0],other=JSON.parse(fs.files.get(fs.root+'/e2.json')!).transcript as Transcript;
 const later=await transactProjectTags(added.project,{...fs.current,editId:'e2',transcript:other},(library,consumers,id)=>({library,consumers:consumers.map(c=>c.id===id?{...c,transcript:{...setSegmentTag(c.transcript,'segment',leaf,true),tagCollection:admitTags(library,c.transcript.tagCollection!,[leaf])}}:c)}),'current');
 await expect(restoreProjectTagTransaction(later.project,added.receipt,false)).rejects.toThrow('tag_history_changed');
 expect(JSON.parse(fs.files.get(fs.root+'/e2.json')!).transcript.segments[0].tagIds).toEqual([leaf]);
});

it('atomically rolls back request receipts and assignments on failure, and recognizes committed request IDs',async()=>{
 let fail=true;const fs=fixture(path=>{if(path==='ripple-project.json'&&fail){fail=false;throw Error('synthetic failure')}});
 const signature='a'.repeat(64),request={id:'synthetic-request',signature,client:'chatgpt',assert:()=>{},receipt:()=>({signature,client:'chatgpt',recording:'recording',model:'m1',version:'e1',count:1,savedAt:'2026-01-01T00:00:00Z',references:{tags:{},groups:{}}})};
 const before=new Map(fs.files);
 await expect(transactProjectTags(fs.project,fs.current,addPath,'additions',request)).rejects.toThrow('synthetic failure');
 for(const [path,value]of before)expect(fs.files.get(path)).toBe(value);
 const result=await transactProjectTags(fs.project,fs.current,addPath,'additions',request);
 expect((await openProject(fs.project.directory)).data.tagRequests?.['synthetic-request'].count).toBe(1);
 await expect(transactProjectTags(result.project,{...fs.current,transcript:result.transcript},addPath,'additions',request)).rejects.toThrow('tag_request_already_saved');
});
