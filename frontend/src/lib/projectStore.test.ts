import { prepareMaterials } from './materialImport';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mutateProjectManuscript, checkedMediaFile, trashProjectMaterial, restoreProjectMaterial, clearProjectTrash, reassignManuscript, importProjectMaterials, forgetRecentProject, rememberProject, recentProjects, findExistingManuscripts, importExistingManuscript, acquireProjectEditor, createProject, openProject, addInterview, addRecordings, recordingDirectory, saveProject, mediaFingerprint, relinkMedia, savePortableProject, parseProject, searchProject } from './projectStore';
import { createEdit, setModelOriginal, saveActiveEdit, createModel, readEdited, readManifest, readModelOriginal, renameModelLabel } from '../localStore';

interface TestDirectory { handle: FileSystemDirectoryHandle; files: Map<string, File>; dirs: Map<string, TestDirectory> }
function directory(name = 'root'): TestDirectory {
  const files = new Map<string, File>(); const dirs = new Map<string, TestDirectory>();
  const missing = () => new DOMException('missing', 'NotFoundError');
  const getFileHandle = async (fileName: string, options?: { create?: boolean }) => {
    if (!files.has(fileName)) { if (!options?.create) throw missing(); files.set(fileName, new File([], fileName)); }
    return { kind: 'file', name: fileName, getFile: async () => { const file = files.get(fileName); if (!file) throw missing(); return file; },
      createWritable: async () => {
        const chunks: BlobPart[] = [];
        const write = async (chunk: BlobPart) => { chunks.push(chunk); };
        const close = async () => { files.set(fileName, new File(chunks, fileName)); };
        const stream = new WritableStream({ write, close });
        return Object.assign(stream, { write, close });
      },
    } as unknown as FileSystemFileHandle;
  };
  const handle = { kind: 'directory', name, getFileHandle,
    getDirectoryHandle: async (key: string, options?: { create?: boolean }) => {
      if (!dirs.has(key)) { if (!options?.create) throw missing(); dirs.set(key, directory(key)); }
      return dirs.get(key)!.handle;
    },
    removeEntry: async (key: string) => { files.delete(key); dirs.delete(key); },
    async *entries() { for (const name of files.keys()) yield [name, await getFileHandle(name)]; for (const [name, dir] of dirs) yield [name, dir.handle]; },
  } as unknown as FileSystemDirectoryHandle;
  return { handle, files, dirs };
}
const handles = new Map();
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
beforeEach(() => {
  handles.clear();
  vi.stubGlobal('indexedDB', { open: () => {
    const request: Record<string, unknown> = {};
    const db = { close() {}, transaction() {
      const tx: Record<string, unknown> = {};
      const finish = () => queueMicrotask(() => (tx.oncomplete as (() => void))?.());
      tx.objectStore = () => ({
        get(key: string) { const req = { result: handles.get(key) }; finish(); return req; },
        put(value: unknown, key: string) { handles.set(key, value); finish(); return {}; },
      }); return tx;
    } };
    queueMicrotask(() => { request.result = db; (request.onsuccess as (() => void))(); });
    return request;
  } });
});
async function fixture(storage: 'copy' | 'reference' = 'copy') {
  const parent = directory(); const source = directory('source');
  source.files.set('interview.wav', new File(['original audio'], 'interview.wav'));
  let p = await createProject(parent.handle, '研究');
  p = await addInterview(p, '第一次访谈');
  p = await addRecordings(p, p.data.interviews[0].id, [await source.handle.getFileHandle('interview.wav')], storage);
  return { parent, source, p, interview: p.data.interviews[0], recording: p.data.interviews[0].recordings[0] };
}
it('creates a separate project, rejects existing folders, and keeps source audio intact', async () => {
  const { parent, source, p, recording } = await fixture();
  expect((await openProject(p.directory)).data).toEqual(p.data);
  expect(await source.files.get('interview.wav')!.text()).toBe('original audio');
  await expect(createProject(parent.handle, '研究')).rejects.toThrow('同名');
  expect(recording.storage).toBe('copy');
});
it('supports multiple recordings and independent interviews without filename collisions', async () => {
  const { p, source, interview } = await fixture();
  const next = await addRecordings(p, interview.id, [await source.handle.getFileHandle('interview.wav')], 'copy');
  const final = await addInterview(next, '第二次访谈');
  expect(final.data.interviews).toHaveLength(2);
  const recordings = final.data.interviews[0].recordings;
  expect(recordings).toHaveLength(2); expect(recordings[0].file).not.toBe(recordings[1].file);
});
it('renaming display titles preserves paths and detects stale updates', async () => {
  const { p } = await fixture(); const before = p.data.interviews[0].recordings[0].file;
  const next = await saveProject(p, { ...p.data, title: '新标题' });
  expect(next.data.interviews[0].recordings[0].file).toBe(before);
  await expect(saveProject(p, { ...p.data, title: '过期修改' })).rejects.toThrow('其他窗口');
  expect((await openProject(p.directory)).data.title).toBe('新标题');
});
it('uses linked media without copying and refuses changed contents or incorrect relinking', async () => {
  const { p, source, recording, interview, parent } = await fixture('reference');
  const media = parent.dirs.get('研究.ripple')!.dirs.get('interviews')!.dirs.get(interview.id)!.dirs.get('media')!;
  expect(media.files.size).toBe(0);
  const view = await recordingDirectory(p, interview.id, recording);
  expect(await (await (await view.getFileHandle(recording.file)).getFile()).text()).toBe('original audio');
  source.files.set('interview.wav', new File(['different audio'], 'interview.wav'));
  await expect((await view.getFileHandle(recording.file)).getFile()).rejects.toThrow('内容已变化');
  await expect(relinkMedia(p, interview.id, recording, await source.handle.getFileHandle('interview.wav'))).rejects.toThrow('不同');
});
it('relinks identical contents under a new filename without changing manuscript identity', async () => {
  const { p, source, recording, interview } = await fixture('reference');
  source.files.set('renamed.wav', new File(['original audio'], 'renamed.wav'));
  const next = await relinkMedia(p, interview.id, recording, await source.handle.getFileHandle('renamed.wav'));
  source.files.delete('interview.wav');
  const view = await recordingDirectory(next, interview.id, next.data.interviews[0].recordings[0]);
  expect((await (await view.getFileHandle(recording.file)).getFile()).name).toBe('renamed.wav');
  expect(next.data.interviews[0].recordings[0].id).toBe(recording.id);
});
it('checks the whole recording, including changes beyond the first chunk', async () => {
  const a = new Blob([new Uint8Array(3 * 1024 * 1024), 'a']);
  const b = new Blob([new Uint8Array(3 * 1024 * 1024), 'b']);
  expect(await mediaFingerprint(a)).not.toBe(await mediaFingerprint(b));
});
it('exports external audio references as notes without reading the original', async () => {
  const { p, source, recording, interview } = await fixture('reference');
  source.files.clear(); handles.clear();
  const target=directory('backup');
  const copy=await savePortableProject(p,target.handle,'归档');
  expect(copy.data.interviews[0].recordings[0].storage).toBe('reference');
  const scene=target.dirs.get('归档.ripple')!.dirs.get('interviews')!.dirs.get(interview.id)!;
  expect(await scene.files.get(recording.id+'-引用说明.txt')!.text()).toContain('音频文件本身未包含');
  expect(scene.dirs.has('media')).toBe(false);
  expect((await openProject(p.directory)).data.interviews[0].recordings[0].storage).toBe('reference');
});
it('does not publish an incomplete portable project when copied audio is missing', async () => {
 const {p,interview,recording}=await fixture();
 const dir=await(await p.directory.getDirectoryHandle('interviews')).getDirectoryHandle(interview.id);
 await(await dir.getDirectoryHandle('media')).removeEntry(recording.file);
 const target=directory('backup');
 await expect(savePortableProject(p,target.handle,'归档')).rejects.toThrow();
 expect(target.dirs.get('归档.ripple')!.files.has('ripple-project.json')).toBe(false);
});
it('rejects unsafe manifest paths and corruption without rewriting files', async () => {
  const { p } = await fixture();
  expect(() => parseProject(JSON.stringify({ ...p.data, interviews: [{ ...p.data.interviews[0], id: '../outside' }] }))).toThrow();
  const file = await p.directory.getFileHandle('ripple-project.json'); const writable = await file.createWritable(); await writable.write('{broken'); await writable.close();
  await expect(openProject(p.directory)).rejects.toThrow();
  expect(await (await file.getFile()).text()).toBe('{broken');
});
it('existing manuscript storage works through the project view and remains searchable without audio', async () => {
  const { p, source, recording, interview } = await fixture('reference');
  const view = await recordingDirectory(p, interview.id, recording);
  const transcript = { audio: { filename: recording.file, duration: 1 }, speakers: [], segments: [{ id: 's1', text: '保留的口述史', start: 0, end: 1, speaker_id: 's1' }] };
  await createModel(view, recording.file, { engine: 'test', transcript, original: transcript });
  source.files.clear();
  expect((await readEdited(view, recording.file))?.transcript.segments[0].text).toBe('保留的口述史');
  expect((await searchProject(p, '口述史'))[0].recordingId).toBe(recording.id);
});
it('retains the verified index backup and restores the index after a failed write', async () => {
  const { p } = await fixture();
  const original = p.directory.getFileHandle.bind(p.directory);
  let fail = true;
  vi.spyOn(p.directory, 'getFileHandle').mockImplementation(async (name, options) => {
    if (name === 'ripple-project.json' && options?.create && fail) {
      fail = false; throw new Error('disk full');
    }
    return original(name, options);
  });
  await expect(saveProject(p, { ...p.data, title: '不应保存' })).rejects.toThrow('disk full');
  expect((await openProject(p.directory)).data).toEqual(p.data);
  const backup = await (await p.directory.getFileHandle('ripple-project.json.bak')).getFile();
  expect(JSON.parse(await backup.text())).toEqual(p.data);
});
it('finds interviews before they have recordings', async () => {
  const parent = directory();
  const p = await addInterview(await createProject(parent.handle, '研究'), '待访谈对象');
  expect(await searchProject(p, '待访谈')).toEqual([{ interviewId: p.data.interviews[0].id, recordingId: null, title: '待访谈对象', text: '尚未添加录音' }]);
});
it('prevents a second editor or archive until the active editor releases its lease', async () => {
  let held = false;
  vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown, work: (lock: object | null) => Promise<void>) => {
    if (held) return work(null);
    held = true;
    try { await work({}); } finally { held = false; }
  } } });
  const release = await acquireProjectEditor('example');
  await expect(acquireProjectEditor('example')).rejects.toThrow('另一个窗口');
  release();
  await vi.waitFor(() => expect(held).toBe(false));
  const releaseAgain = await acquireProjectEditor('example');
  expect(held).toBe(true); releaseAgain();
});
async function legacyFixture() {
  const result = await fixture();
  const old = await result.source.handle.getDirectoryHandle('interview.transcript', { create: true });
  const transcript = { audio: { filename: 'interview.wav', duration: 1 }, speakers: [], segments: [{ id: 's1', text: '旧版正文', start: 0, end: 1, speaker_id: 's1' }] };
  const manifest = { schemaVersion: 2, audio: 'interview.wav', title: '旧访谈标题', interviewDetails: { recorded_at: '2026-09-11T11:09:00', location: '北京', topics: ['口述史'] }, models: [{ id: 'm1', engine: 'ElevenLabs Scribe v2', label: '引擎自定义名', original: 'original.json', edits: [{ id: 'e1', label: 'v1 自定义', file: 'v1.json', updated_at: '' }, { id: 'e2', label: '精修稿', file: 'v2.json', comparisonBaseId: 'e1', updated_at: '' }], activeEditId: 'e2' }], activeModelId: 'm1' };
  const files = result.source.dirs.get('interview.transcript')!.files;
  for (const name of ['original.json', 'v1.json', 'v2.json']) files.set(name, new File([JSON.stringify({ kind: name === 'original.json' ? 'te-original' : 'te-edited', audio: 'interview.wav', metadata: { notes: '采访笔记' }, transcript })], name));
  files.set('manifest.json', new File([JSON.stringify(manifest)], 'manifest.json'));
  return { ...result, old, files, manifest };
}
it('imports original and all edits, labels, comparison links and metadata without modifying the source', async () => {
  const { p, source, recording, interview, files, manifest } = await legacyFixture();
  const before = await Promise.all([...files.values()].map(f => f.text()));
  const [candidate] = await findExistingManuscripts(source.handle, [recording]);
  const imported = await importExistingManuscript(p, interview.id, recording, candidate);
  const updated = imported.data.interviews[0];
  expect(updated.metadata?.location).toBe('北京');
  expect(updated.metadata?.notes).toBe('采访笔记');
  expect(updated.title).toBe(interview.title);
  const view = await recordingDirectory(imported, interview.id, updated.recordings[0]);
  const read = await readEdited(view, recording.file);
  expect(read?.transcript.segments[0].text).toBe('旧版正文');
  const copied = await view.getDirectoryHandle(recording.file.replace(/\.[^.]+$/, '.transcript'));
  const saved = JSON.parse(await (await (await copied.getFileHandle('manifest.json')).getFile()).text());
  expect(saved.models).toEqual(manifest.models);
  expect(saved.activeModelId).toBe('m1');
  expect(saved.audio).toBe(recording.file);
  expect(await Promise.all([...files.values()].map(f => f.text()))).toEqual(before);
  const portable = await savePortableProject(imported, directory('backup').handle, '完整');
  const reopened = await recordingDirectory(portable, interview.id, portable.data.interviews[0].recordings[0]);
  expect((await readEdited(reopened, recording.file))?.transcript.segments[0].text).toBe('旧版正文');
  await expect(importExistingManuscript(imported, interview.id, updated.recordings[0], candidate)).rejects.toThrow('已经有转录稿');
});
it('rejects mismatched audio and incomplete version sets before publishing an import', async () => {
  const { p, source, recording, interview, files } = await legacyFixture();
  const [candidate] = await findExistingManuscripts(source.handle, [recording]);
  source.files.set('interview.wav', new File(['other audio'], 'interview.wav'));
  expect(await findExistingManuscripts(source.handle, [recording])).toEqual([]);
  await expect(importExistingManuscript(p, interview.id, recording, candidate)).rejects.toThrow('内容已变化');
  source.files.set('interview.wav', new File(['original audio'], 'interview.wav'));
  files.delete('v1.json');
  await expect(importExistingManuscript(p, interview.id, recording, candidate)).rejects.toThrow('缺少文件');
  expect((await openProject(p.directory)).data).toEqual(p.data);
});
it('does not attach a staged manuscript when project publication fails', async () => {
  const { p, source, recording, interview } = await legacyFixture();
  const [candidate] = await findExistingManuscripts(source.handle, [recording]);
  const original = p.directory.getFileHandle.bind(p.directory);
  vi.spyOn(p.directory, 'getFileHandle').mockImplementation(async (name, options) => {
    if (options?.create && name === 'ripple-project.json.bak') throw new Error('disk full');
    return original(name, options);
  });
  await expect(importExistingManuscript(p, interview.id, recording, candidate)).rejects.toThrow('disk full');
  expect((await openProject(p.directory)).data.interviews[0].recordings[0].manuscriptDirectory).toBeUndefined();
  const view = await recordingDirectory(p, interview.id, recording);
  expect(await readEdited(view, recording.file)).toBeNull();
});

it('removes only the selected recent entry and allows an intact project to be reopened', async () => {
  const { p } = await fixture();
  const other = await createProject(directory().handle, '另一项目');
  await rememberProject(p); await rememberProject(other);
  await forgetRecentProject(p.data.id);
  expect((await recentProjects()).map(item => item.id)).toEqual([other.data.id]);
  expect((await openProject(p.directory)).data).toEqual(p.data);
  await rememberProject(p);
  expect((await recentProjects())[0].id).toBe(p.data.id);
});

it('imports manuscript-only interviews with a read-only import baseline, archives them, and later attaches audio', async () => {
  const source = directory('source');
  source.files.set('已有访谈.txt', new File(['口述原话\n第二段'], '已有访谈.txt'));
  const materials = await prepareMaterials([{ handle: await source.handle.getFileHandle('已有访谈.txt') }]);
  const p = await importProjectMaterials(await createProject(directory().handle, '纯转录稿'), materials, 'copy');
  const interview = p.data.interviews[0], recording = interview.recordings[0];
  expect(recording.storage).toBe('none');
  const view = await recordingDirectory(p, interview.id, recording);
  const edited = await readEdited(view, recording.file);
  expect(edited?.transcript.timeAligned).toBe(false);
  expect(edited?.transcript.segments[0].text).toBe('口述原话');
  const manuscript = await view.getDirectoryHandle(recording.file.replace('.wav', '.transcript'));
  const manifest = JSON.parse(await (await (await manuscript.getFileHandle('manifest.json')).getFile()).text());
  expect(manifest.models[0].sourceKind).toBe('import');
  expect(manifest.models[0].original).toContain('导入稿');
  const baseline = await (await manuscript.getFileHandle(manifest.models[0].original)).getFile();
  expect(JSON.parse(await baseline.text()).transcript.segments[0].text).toBe('口述原话');
  const portable = await savePortableProject(p, directory().handle, '副本');
  expect(portable.data.interviews[0].recordings[0].storage).toBe('none');
  source.files.set('later.m4a', new File(['audio'], 'later.m4a'));
  const linked = await relinkMedia(p, interview.id, recording, await source.handle.getFileHandle('later.m4a'));
  const updated = linked.data.interviews[0].recordings[0];
  const reopened = await recordingDirectory(linked, interview.id, updated);
  expect((await readEdited(reopened, updated.file))?.transcript.segments[0].text).toBe('口述原话');
  expect(await (await (await reopened.getFileHandle(updated.file)).getFile()).text()).toBe('audio');
});
it('groups multiple recordings in one interview and attaches a matching manuscript without changing its source', async () => {
  const source = directory('source');
  for (const name of ['上午.wav', '下午.wav', '上午.txt']) source.files.set(name, new File([name === '上午.txt' ? '转录稿正文' : 'audio'], name));
  const files = await Promise.all([...source.files.keys()].map(async name => ({ handle: await source.handle.getFileHandle(name), group: '同一次访谈' })));
  const materials = await prepareMaterials(files);
  for (const item of materials) item.audioId = item.suggestedAudioId ?? ''; // User confirms suggestion.
  const p = await importProjectMaterials(await createProject(directory().handle, '项目'), materials, 'copy');
  expect(p.data.interviews).toHaveLength(1);
  expect(p.data.interviews[0].recordings).toHaveLength(2);
  expect(await source.files.get('上午.txt')!.text()).toBe('转录稿正文');
});
it('keeps the existing project unchanged when a material batch cannot be published', async () => {
  const source=directory(); source.files.set('访谈.txt',new File(['完整正文'],'访谈.txt'));
  const materials=await prepareMaterials([{handle:await source.handle.getFileHandle('访谈.txt')}]);
  const p=await createProject(directory().handle,'导入失败');
  const original=p.directory.getFileHandle.bind(p.directory);
  vi.spyOn(p.directory,'getFileHandle').mockImplementation(async(name,options)=>{
    if(name==='ripple-project.json.bak'&&options?.create)throw new Error('disk full');
    return original(name,options);
  });
  await expect(importProjectMaterials(p,materials,'copy')).rejects.toThrow('disk full');
  expect((await openProject(p.directory)).data.interviews).toEqual([]);
  expect(await source.files.get('访谈.txt')!.text()).toBe('完整正文');
});

it('detaches and reassigns the complete manuscript without overwriting versions or source media', async () => {
  const { p, recording, interview } = await fixture();
  const view = await recordingDirectory(p, interview.id, recording);
  const transcript = { timeAligned: false, audio: { filename: recording.file, duration: 0 }, speakers: [], segments: [{ id: 's1', speaker_id: 's', start: 0, end: 0, text: '保留编辑内容' }] };
  await createModel(view, recording.file, { engine: 'imported', sourceKind: 'import', transcript, original: transcript });
  const detached = await reassignManuscript(p, interview.id, recording.id, '');
  const standalone = detached.data.interviews[0].recordings.find(r => r.storage === 'none')!;
  expect((await readEdited(await recordingDirectory(detached, interview.id, standalone), standalone.file))?.transcript.segments[0].text).toBe('保留编辑内容');
  const restored = await reassignManuscript(detached, interview.id, standalone.id, recording.id);
  expect(restored.data.interviews[0].recordings).toHaveLength(1);
  const restoredRecording = restored.data.interviews[0].recordings[0];
  expect((await readEdited(await recordingDirectory(restored, interview.id, restoredRecording), recording.file))?.transcript.segments[0].text).toBe('保留编辑内容');
  await expect(reassignManuscript(p, interview.id, recording.id, '')).rejects.toThrow('项目已更新');
});
it('rejects reassignment onto existing manuscripts and keeps both histories intact', async () => {
  const { p, recording, interview, source } = await fixture();
  const next = await addRecordings(p, interview.id, [await source.handle.getFileHandle('interview.wav')], 'copy');
  const target = next.data.interviews[0].recordings[1];
  for (const record of [recording, target]) {
    const transcript = { audio: { filename: record.file, duration: 1 }, speakers: [], segments: [{ id: 's1', speaker_id: 's', start: 0, end: 1, text: record.id }] };
    await createModel(await recordingDirectory(next, interview.id, record), record.file, { engine: 'imported', transcript, original: transcript });
  }
  await expect(reassignManuscript(next, interview.id, recording.id, target.id)).rejects.toThrow('已有转录稿');
  expect((await openProject(next.directory)).data).toEqual(next.data);
  for (const record of [recording, target]) expect((await readEdited(await recordingDirectory(next, interview.id, record), record.file))?.transcript.segments[0].text).toBe(record.id);
});

it('imports multiple transcripts for one audio with independent originals and names, even at the same clock time', async () => {
  const source = directory('source');
  for (const name of ['访谈.wav', '机器.txt', '人工.txt', '整理.txt']) source.files.set(name, new File([name], name));
  const materials = await prepareMaterials(await Promise.all([...source.files.keys()].map(async name => ({ handle: await source.handle.getFileHandle(name) }))));
  const audio = materials.find(m => m.kind === 'audio')!;
  for (const item of materials) { item.group = '第一场'; if (item.kind === 'manuscript') item.audioId = audio.id; }
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    const project = await importProjectMaterials(await createProject(directory().handle, '研究'), materials, 'copy');
    const interview = project.data.interviews[0], recording = interview.recordings[0];
    expect(interview.recordings).toHaveLength(1);
    const view = await recordingDirectory(project, interview.id, recording);
    const manifest = await readManifest(view, recording.file);
    expect(manifest?.models.map(m => m.label)).toEqual(['机器', '人工', '整理']);
    expect(new Set(manifest?.models.map(m => m.original)).size).toBe(3);
    for (const model of manifest!.models) expect((await readModelOriginal(view, recording.file, model.id))?.transcript.segments[0].text).toBe(model.sourceName);
    await renameModelLabel(view, recording.file, manifest!.models[1].id, '人工校订');
    const renamed = await readManifest(view, recording.file);
    expect(renamed?.models[1].label).toBe('人工校订');
    expect(renamed?.models[1].sourceName).toBe('人工.txt');
  } finally { vi.useRealTimers(); }
});

it('saves explicitly ordered scenes with identical names and independently seeded transcript metadata', async () => {
  const parent = directory(); const source = directory('files');
  source.files.set('one.txt', new File(['one'], 'one.txt'));
  source.files.set('two.txt', new File(['two'], 'two.txt'));
  const p = await createProject(parent.handle, '新流程');
  const { defaultMetadata } = await import('../localStore');
  const sessions = ['scene-b', 'scene-a'].map(id => ({ id, title: '同名访谈', metadata: { ...defaultMetadata('同名访谈'), id, recorded_at: '2026-09-11', location: '家中' }, recordings: [] }));
  const materials = await prepareMaterials([{ handle: await source.handle.getFileHandle('one.txt'), group: 'scene-b' }, { handle: await source.handle.getFileHandle('two.txt'), group: 'scene-a' }]);
  const saved = await importProjectMaterials(p, materials, 'copy', undefined, sessions);
  expect(saved.data.interviews.map(i => i.id)).toEqual(['scene-b', 'scene-a']);
  const scene = saved.data.interviews[0], rec = scene.recordings[0];
  const edited = await readEdited(await recordingDirectory(saved, scene.id, rec), rec.file);
  expect(edited?.metadata.location).toBe('家中');expect(edited?.metadata.title).toBe('one');
  const changed = await saveProject(saved, { ...saved.data, interviews: saved.data.interviews.map(i => ({ ...i, metadata: { ...i.metadata!, location: '新地点' } })) });
  expect((await readEdited(await recordingDirectory(changed, scene.id, rec), rec.file))?.metadata.location).toBe('家中');
});
it('appends transcripts to existing audio using a staged copy, preserving previous history and source files', async () => {
  const { p, source, interview, recording } = await fixture();
  const view = await recordingDirectory(p, interview.id, recording);
  const transcript = { audio: { filename: recording.file, duration: 1 }, speakers: [], segments: [] };
  await createModel(view, recording.file, { engine: 'old', transcript, original: transcript });
  source.files.set('new.txt', new File(['new text'], 'new.txt'));
  const [doc] = await prepareMaterials([{ handle: await source.handle.getFileHandle('new.txt'), group: interview.id }]);
  const audio = { id: 'audio', existingRecordingId: recording.id, handle: await source.handle.getFileHandle('interview.wav'), name: recording.name, kind: 'audio' as const, group: interview.id, audioId: '' };
  const result = await importProjectMaterials(p, [audio, { ...doc, audioId: 'audio' }], 'copy', undefined, [interview]);
  expect(result.data.interviews[0].recordings).toHaveLength(1);
  expect((await readManifest(view, recording.file))?.models).toHaveLength(1);
  const current = await recordingDirectory(result, interview.id, result.data.interviews[0].recordings[0]);
  expect((await readManifest(current, recording.file))?.models).toHaveLength(2);
  expect(await source.files.get('new.txt')!.text()).toBe('new text');
});
it('keeps an existing manuscript manifest unchanged when appending fails', async () => {
  const { p, source, interview, recording } = await fixture();
  const view = await recordingDirectory(p, interview.id, recording);
  const transcript = { audio: { filename: recording.file, duration: 1 }, speakers: [], segments: [] };
  await createModel(view, recording.file, { engine: 'old', transcript, original: transcript });
  const before = await readManifest(view, recording.file);
  const audio = { id: 'audio', existingRecordingId: recording.id, handle: await source.handle.getFileHandle('interview.wav'), name: recording.name, kind: 'audio' as const, group: interview.id, audioId: '' };
  await expect(importProjectMaterials(p, [audio, { id:'broken', handle:audio.handle, name:'broken.txt', kind:'manuscript', group:interview.id, audioId:'audio' }], 'copy', undefined, [interview])).rejects.toThrow('解析未完成');
  expect(await readManifest(view, recording.file)).toEqual(before);
  expect((await openProject(p.directory)).data).toEqual(p.data);
});
it('imports multiple designated originals read-only alongside editable manuscripts',async()=>{
 const source=directory('source');
 const transcript={audio:{filename:'a.wav',duration:1},speakers:[{id:'p',name:'张三'}],segments:[{id:'s',speaker_id:'p',start:0,end:1,text:'正文'}]};
 for(const name of ['原稿.json','另一原稿.json','修改稿.json'])source.files.set(name,new File([JSON.stringify({kind:'te-edited',metadata:{location:'上海',notes:'备注'},transcript})],name));
 source.files.set('a.wav',new File(['audio'],'a.wav'));
 const materials=await prepareMaterials(await Promise.all([...source.files.keys()].map(async name=>({handle:await source.handle.getFileHandle(name),group:'访谈'}))));
 const audio=materials.find(m=>m.kind==='audio')!;
 for(const m of materials.filter(m=>m.kind==='manuscript')){m.audioId=audio.id;m.isOriginal=m.name!=='修改稿.json';}
 const saved=await importProjectMaterials(await createProject(directory().handle,'研究'),materials,'copy');
 const interview=saved.data.interviews[0],recording=interview.recordings[0];expect(interview.recordings).toHaveLength(1);
 const view=await recordingDirectory(saved,interview.id,recording),manifest=await readManifest(view,recording.file);
 expect(manifest!.models).toHaveLength(3);
 expect(manifest!.models.filter(m=>m.designatedOriginal)).toHaveLength(2);
 for(const model of manifest!.models){expect(model.sourceKind).toBe('import');expect(model.edits).toHaveLength(model.designatedOriginal?0:1);expect(model.original).toBeTruthy();}
 const edited=await readEdited(view,recording.file);expect(edited?.metadata).toMatchObject({location:'上海',notes:'备注'});
 expect(JSON.parse(await source.files.get('原稿.json')!.text()).transcript.segments[0].text).toBe('正文');
});

it('detaches only the requested manuscript and preserves other manuscripts on the audio', async () => {
  const { p, recording, interview } = await fixture();
  const view = await recordingDirectory(p, interview.id, recording);
  const transcript = { timeAligned: false, audio: { filename: recording.file, duration: 0 }, speakers: [], segments: [{ id: 's1', speaker_id: 's', start: 0, end: 0, text: '第一份内容' }] };
  const first = await createModel(view, recording.file, { engine: 'imported', transcript, original: transcript });
  const second = await createModel(view, recording.file, { engine: 'imported', transcript: { ...transcript, segments: [{ ...transcript.segments[0], text: '第二份内容' }] } });
  const next = await reassignManuscript(p, interview.id, recording.id, '', first.model.id);
  const audio = next.data.interviews[0].recordings.find(r => r.id === recording.id)!;
  const standalone = next.data.interviews[0].recordings.find(r => r.storage === 'none')!;
  const audioDir = await recordingDirectory(next, interview.id, audio);
  const docDir = await recordingDirectory(next, interview.id, standalone);
  expect((await readManifest(audioDir, audio.file))?.models.map(m=>m.id)).toEqual([second.model.id]);
  expect((await readManifest(docDir, standalone.file))?.models.map(m=>m.id)).toEqual([first.model.id]);
  expect((await readEdited(audioDir, audio.file))?.transcript.segments[0].text).toBe('第二份内容');
  expect((await readEdited(docDir, standalone.file))?.transcript.segments[0].text).toBe('第一份内容');
  expect((await readManifest(view, recording.file))?.models).toHaveLength(2);
});

it('persists deleted audio across reopen and restores it with its manuscripts',async()=>{
 const {p,recording,interview}=await fixture();
 const view=await recordingDirectory(p,interview.id,recording);
 const transcript={audio:{filename:recording.file,duration:0},speakers:[],segments:[]};
 await createModel(view,recording.file,{engine:'test',transcript,original:transcript});
 const deleted=await trashProjectMaterial(p,interview.id,recording.id);
 expect(deleted.data.interviews[0].recordings).toHaveLength(0);
 const reopened=await openProject(p.directory);expect(reopened.data.trash).toHaveLength(1);
 const restored=await restoreProjectMaterial(reopened,reopened.data.trash![0].id);
 expect(restored.data.interviews[0].recordings[0]).toEqual(recording);
 expect((await readManifest(await recordingDirectory(restored,interview.id,recording),recording.file))?.models).toHaveLength(1);
 expect(restored.data.trash).toEqual([]);
 await expect(trashProjectMaterial(p,interview.id,recording.id)).rejects.toThrow('项目已更新');
});
it('keeps documents independent when deleting audio and reconnects them on undo',async()=>{
 const {p,recording,interview}=await fixture();
 const transcript={audio:{filename:recording.file,duration:0},speakers:[],segments:[]};
 await createModel(await recordingDirectory(p,interview.id,recording),recording.file,{engine:'test',transcript});
 const deleted=await trashProjectMaterial(p,interview.id,recording.id,{keepDocuments:true});
 expect(deleted.data.interviews[0].recordings).toHaveLength(1);
 expect(deleted.data.interviews[0].recordings[0].storage).toBe('none');
 const restored=await restoreProjectMaterial(deleted,deleted.data.trash![0].id);
 expect(restored.data.interviews[0].recordings).toHaveLength(1);
 expect(restored.data.interviews[0].recordings[0].id).toBe(recording.id);
 expect((await readManifest(await recordingDirectory(restored,interview.id,restored.data.interviews[0].recordings[0]),recording.file))?.models).toHaveLength(1);
});
it('deletes just one manuscript and restores its complete model beside the remaining models',async()=>{
 const {p,recording,interview}=await fixture();
 const view=await recordingDirectory(p,interview.id,recording);
 const transcript={audio:{filename:recording.file,duration:0},speakers:[],segments:[]};
 const first=await createModel(view,recording.file,{engine:'test',transcript,original:transcript});
 const second=await createModel(view,recording.file,{engine:'test',transcript});
 const deleted=await trashProjectMaterial(p,interview.id,recording.id,{modelId:first.model.id});
 const active=deleted.data.interviews[0].recordings[0];
 expect((await readManifest(await recordingDirectory(deleted,interview.id,active),active.file))?.models.map(m=>m.id)).toEqual([second.model.id]);
 const restored=await restoreProjectMaterial(deleted,deleted.data.trash![0].id);
 const current=restored.data.interviews[0].recordings[0];
 const dir=await recordingDirectory(restored,interview.id,current);
 const models=(await readManifest(dir,current.file))!.models;
 expect(models.map(m=>m.id)).toEqual([second.model.id,first.model.id]);
 expect(models[1].edits).toHaveLength(first.model.edits.length);
 expect((await readModelOriginal(dir,current.file,first.model.id))?.transcript).toBeTruthy();
});
it('clears copied audio from the project but never touches a referenced source',async()=>{
 const {p,recording,interview}=await fixture();
 const source=directory('外部');source.files.set('external.wav',new File(['original'],'external.wav'));
 const linked=await addRecordings(p,interview.id,[await source.handle.getFileHandle('external.wav')],'reference');
 const ref=linked.data.interviews[0].recordings.at(-1)!;
 const removed=await trashProjectMaterial(linked,interview.id,ref.id);
 const deleted=await trashProjectMaterial(removed,interview.id,recording.id);
 const cleared=await clearProjectTrash(deleted);
 expect((await openProject(cleared.directory)).data.trash).toEqual([]);
 expect(await source.files.get('external.wav')!.text()).toBe('original');
 await expect(restoreProjectMaterial(cleared,deleted.data.trash![0].id)).rejects.toThrow('找不到这项材料');
});
it('restores as an independent document when the original audio was deleted',async()=>{
 const {p,recording,interview}=await fixture();
 const transcript={audio:{filename:recording.file,duration:0},speakers:[],segments:[]};
 const model=await createModel(await recordingDirectory(p,interview.id,recording),recording.file,{engine:'test',transcript});
 const docDeleted=await trashProjectMaterial(p,interview.id,recording.id,{modelId:model.model.id});
 const allDeleted=await trashProjectMaterial(docDeleted,interview.id,recording.id);
 const restored=await restoreProjectMaterial(allDeleted,docDeleted.data.trash![0].id);
 expect(restored.data.interviews[0].recordings[0].storage).toBe('none');
 expect(restored.data.trash).toHaveLength(1);
});
it('does not publish or lose a manuscript when deleting fails to save the project index',async()=>{
 const {p,recording,interview}=await fixture();
 const view=await recordingDirectory(p,interview.id,recording);
 const transcript={audio:{filename:recording.file,duration:0},speakers:[],segments:[]};
 const model=await createModel(view,recording.file,{engine:'test',transcript});
 const original=p.directory.getFileHandle.bind(p.directory);
 let fail=true;
 vi.spyOn(p.directory,'getFileHandle').mockImplementation(async(name,options)=>{if(name==='ripple-project.json'&&options?.create&&fail){fail=false;throw new Error('disk full');}return original(name,options);});
 await expect(trashProjectMaterial(p,interview.id,recording.id,{modelId:model.model.id})).rejects.toThrow('disk full');
 expect((await openProject(p.directory)).data).toEqual(p.data);
 expect((await readManifest(view,recording.file))?.models).toHaveLength(1);
});
it('restores a conflicting model independently rather than replacing a newer manuscript',async()=>{
 const {p,recording,interview}=await fixture();
 const transcript={audio:{filename:recording.file,duration:0},speakers:[],segments:[]};
 const model=await createModel(await recordingDirectory(p,interview.id,recording),recording.file,{engine:'test',transcript});
 const deleted=await trashProjectMaterial(p,interview.id,recording.id,{modelId:model.model.id});
 const current=deleted.data.interviews[0].recordings[0];
 const dir=await recordingDirectory(deleted,interview.id,current);
 const newer=await createModel(dir,recording.file,{engine:'new',transcript});
 expect(newer.model.id).toBe(model.model.id);
 const restored=await restoreProjectMaterial(deleted,deleted.data.trash![0].id);
 expect(restored.data.interviews[0].recordings).toHaveLength(2);
 expect((await readManifest(dir,recording.file))?.models[0].engine).toBe('new');
 expect(restored.data.interviews[0].recordings.some(r=>r.storage==='none')).toBe(true);
});
it('excludes trash from portable projects without requiring deleted external audio',async()=>{
 const {p,recording,interview,source}=await fixture('reference');
 const removed=await trashProjectMaterial(p,interview.id,recording.id);
 source.files.clear();handles.clear();
 const destination=directory('backup');
 const portable=await savePortableProject(removed,destination.handle,'副本');
 expect(portable.data.trash).toEqual([]);
 expect(portable.data.interviews[0].recordings).toEqual([]);
 expect(destination.dirs.get('副本.ripple')!.dirs.get('interviews')!.dirs.get(interview.id)!.files.size).toBe(0);
 expect(removed.data.trash).toHaveLength(1);
});
it('associates one independent manuscript with audio that already has a manuscript',async()=>{
 const {p,recording,interview}=await fixture();
 const transcript={audio:{filename:recording.file,duration:0},speakers:[],segments:[]};
 const original=await createModel(await recordingDirectory(p,interview.id,recording),recording.file,{engine:'original',transcript,original:transcript});
 const detached=await reassignManuscript(p,interview.id,recording.id,'',original.model.id);
 const independent=detached.data.interviews[0].recordings.find(r=>r.storage==='none')!;
 const audio=detached.data.interviews[0].recordings.find(r=>r.id===recording.id)!;
 await createModel(await recordingDirectory(detached,interview.id,audio),audio.file,{engine:'existing',transcript});
 const joined=await reassignManuscript(detached,interview.id,independent.id,audio.id,original.model.id);
 expect(joined.data.interviews[0].recordings).toHaveLength(1);
 const dir=await recordingDirectory(joined,interview.id,joined.data.interviews[0].recordings[0]);
 const models=(await readManifest(dir,audio.file))!.models;
 expect(models.map(m=>m.engine)).toEqual(['existing','original']);expect(new Set(models.map(m=>m.id)).size).toBe(2);
 expect((await readModelOriginal(dir,audio.file,models[1].id))?.transcript).toBeTruthy();
});

it('toggles original status without losing current content or other manuscripts', async () => {
 const dir=directory().handle;
 const transcript={audio:{filename:'a.m4a',duration:1},speakers:[],segments:[{id:'s',start:0,end:1,text:'当前内容',speaker_id:'s'}]} as import('../types').Transcript;
 const first=await createModel(dir,'a.m4a',{engine:'test',sourceKind:'import',transcript});
 const second=await createModel(dir,'a.m4a',{engine:'test2',sourceKind:'import',transcript});
 await setModelOriginal(dir,'a.m4a',first.model.id,true);
 const manifest=await setModelOriginal(dir,'a.m4a',second.model.id,true);
 expect(manifest.models.every(m=>m.designatedOriginal)).toBe(true);
 expect((await readModelOriginal(dir,'a.m4a',first.model.id))?.transcript.segments[0].text).toBe('当前内容');
 const data=await readEdited(dir,'a.m4a');
 await expect(saveActiveEdit(dir,'a.m4a',second.model.id,second.model.activeEditId,data!)).rejects.toThrow('只读');
 const restored=await setModelOriginal(dir,'a.m4a',second.model.id,false);
 expect(restored.models[1].edits).toEqual(second.model.edits);
 expect(restored.models[0].designatedOriginal).toBe(true);
 await expect(saveActiveEdit(dir,'a.m4a',second.model.id,second.model.activeEditId,data!)).resolves.toBeUndefined();
});
it('makes an imported original editable when its designation is removed', async () => {
 const dir=directory().handle;
 const transcript={audio:{filename:'a.m4a',duration:0},speakers:[],segments:[]} as import('../types').Transcript;
 const first=await createModel(dir,'a.m4a',{engine:'imported',sourceKind:'import',transcript,original:transcript,originalOnly:true,designatedOriginal:true});
 const next=await setModelOriginal(dir,'a.m4a',first.model.id,false);
 expect(next.models[0].designatedOriginal).toBe(false);
 expect(next.models[0].original).toBe(first.model.original);
 expect(next.models[0].edits).toHaveLength(1);
});

it('regression: empty scene created by management remains exportable',async()=>{
 const {p}=await fixture();
 const next=await saveProject(p,{...p.data,interviews:[...p.data.interviews,{id:'new-empty',title:'空场次',recordings:[]}]});
 await expect(savePortableProject(next,directory('export').handle,'副本')).resolves.toBeTruthy();
});
it('regression: cleared manuscript is excluded from portable export',async()=>{
 const {p,recording,interview}=await fixture();
 const dir=await recordingDirectory(p,interview.id,recording);
 const text='AUDIT-DELETED-SECRET-CONTENT';
 const transcript={audio:{filename:recording.file,duration:0},speakers:[],segments:[{id:'s',speaker_id:'unknown',start:0,end:0,text}]};
 const model=await createModel(dir,recording.file,{engine:'test',transcript});
 const deleted=await trashProjectMaterial(p,interview.id,recording.id,{modelId:model.model.id});
 const cleared=await clearProjectTrash(deleted);
 const exported=await savePortableProject(cleared,directory('export').handle,'副本');
 async function scan(folder:FileSystemDirectoryHandle):Promise<string[]> {
   const found:string[]=[];
   for await(const [name,handle] of (folder as FileSystemDirectoryHandle & {entries():AsyncIterable<[string,FileSystemHandle]>}).entries()){
     if(handle.kind==='directory')found.push(...(await scan(handle as FileSystemDirectoryHandle)).map(p=>name+'/'+p));
     else if(name.endsWith('.json')&&(await(await(handle as FileSystemFileHandle).getFile()).text()).includes(text))found.push(name);
   }return found;
 }
 expect(await scan(exported.directory)).toEqual([]);
});
it('regression: original designation preserves content after editor forks a version',async()=>{
 const dir=directory().handle;
 const transcript={audio:{filename:'a.wav',duration:0},speakers:[],segments:[{id:'s',speaker_id:'unknown',start:0,end:0,text:'最初导入'}]};
 const model=await createModel(dir,'a.wav',{engine:'test',sourceKind:'import',transcript,original:transcript});
 const current=await readEdited(dir,'a.wav');
 current!.transcript.segments[0].text='用户指定的原始稿';
 await saveActiveEdit(dir,'a.wav',model.model.id,model.model.activeEditId,current!);
 await setModelOriginal(dir,'a.wav',model.model.id,true);
 expect((await readModelOriginal(dir,'a.wav',model.model.id))!.transcript.segments[0].text).toBe('用户指定的原始稿');
 await createEdit(dir,'a.wav',model.model.id,{fromOriginal:true,label:'副本'});
 expect((await readModelOriginal(dir,'a.wav',model.model.id))!.transcript.segments[0].text).toBe('用户指定的原始稿');
});

it('locks Ripple originals and creates a distinct editable copy',async()=>{
 const dir=directory().handle;
 const transcript={audio:{filename:'a.wav',duration:0},speakers:[],segments:[]};
 const source=await createModel(dir,'a.wav',{engine:'scribe',transcript,original:transcript,originalOnly:true});
 expect(source.model.designatedOriginal).toBe(true);
 await expect(setModelOriginal(dir,'a.wav',source.model.id,false)).rejects.toThrow('必须保留');
 const copy=await createEdit(dir,'a.wav',source.model.id,{fromOriginal:true,label:'编辑副本'});
 expect(copy.model.id).not.toBe(source.model.id);
 expect(copy.model.designatedOriginal).not.toBe(true);
 expect(copy.manifest.models.find(m=>m.id===source.model.id)).toEqual(source.model);
});
it('blocks management manuscript mutations when another editor holds the project lease',async()=>{
 const {p}=await fixture();
 const work=vi.fn(async()=>{});
 vi.stubGlobal('navigator',{locks:{request:vi.fn(async(_name,_options,callback)=>callback(null))}});
 await expect(mutateProjectManuscript(p,work)).rejects.toThrow('另一个窗口');
 expect(work).not.toHaveBeenCalled();
});
it('rejects stale management mutations before touching manuscripts',async()=>{
 const {p}=await fixture();await saveProject(p,{...p.data,description:'其他窗口修改'});
 const work=vi.fn(async()=>{});
 await expect(mutateProjectManuscript(p,work)).rejects.toThrow('项目已更新');
 expect(work).not.toHaveBeenCalled();
});
it('validates copied media contents for materials export',async()=>{
 const {p,interview,recording}=await fixture();
 const media=await(await(await p.directory.getDirectoryHandle('interviews')).getDirectoryHandle(interview.id)).getDirectoryHandle('media');
 const file=await media.getFileHandle(recording.file);const w=await file.createWritable();await w.write('changed');await w.close();
 await expect(checkedMediaFile(p,interview.id,recording)).rejects.toThrow('音频内容已变化');
});

it('rejects malformed interview people before they can crash the project board', async () => {
  const { p } = await fixture();
  for (const participants of [[null], [{ name: { broken: true }, role: '' }], [{ name: '小林', role: 42 }]]) {
    const metadata = { id: 'i', title: '访谈', location: '', recorded_at: null, topics: [], notes: '', created_at: '', updated_at: '', participants };
    const raw = JSON.stringify({ ...p.data, interviews: [{ ...p.data.interviews[0], metadata }] });
    expect(() => parseProject(raw)).toThrow('场次信息损坏');
  }
});
