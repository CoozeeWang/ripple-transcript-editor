import { msg } from '../i18n';
import type { ImportMaterial } from './materialImport';
import type { InterviewMetadata, TranscriptManifest } from '../types';
import { AUDIO_EXT, defaultMetadata, readEdited, stemOf, createModel } from '../localStore';
import { decodeNativeHandles, encodeNativeHandles, nativeDesktopAvailable } from './desktopFs';

export interface ProjectRecording {
  id: string; name: string; file: string; storage: 'copy' | 'reference' | 'none'; fingerprint: string;
  manuscriptDirectory?: string;
  manuscriptOrder?: string[];
}
export interface ProjectInterview { id: string; title: string; metadata?: InterviewMetadata; recordings: ProjectRecording[] }
export interface ProjectTrashItem {
  id: string; name: string; deletedAt: string; interviewId: string;
  recording: ProjectRecording; position: number;
  originalRecordingId?: string; keptDocumentId?: string;
}
export interface RippleProject {
  kind: 'ripple-project'; schemaVersion: 1; id: string; title: string; description: string;
  revision: number; interviews: ProjectInterview[]; trash?: ProjectTrashItem[];
}
export interface OpenProject { directory: FileSystemDirectoryHandle; data: RippleProject }
const INDEX = 'ripple-project.json';
const safeName = (s: unknown): s is string => typeof s === 'string' && !!s && s !== '.' && s !== '..' && !/[\\/]/.test(s);
const id = (s: unknown): s is string => typeof s === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(s);
const notFound = (error: unknown) => (error as { name?: string }).name === 'NotFoundError';

export function parseProject(raw: string): RippleProject {
  let p: RippleProject;
  try { p = JSON.parse(raw) as RippleProject; } catch { throw new Error(msg('projectStore.m1382')); }
  if (p?.kind !== 'ripple-project' || p.schemaVersion !== 1 || !id(p.id) || typeof p.title !== 'string' || !p.title.trim()
      || typeof p.description !== 'string' || !Number.isSafeInteger(p.revision) || p.revision < 0 || !Array.isArray(p.interviews)) throw new Error(msg('projectStore.m1383'));
  const identifiers = new Set<string>();
  for (const interview of p.interviews) {
    if (!interview || !id(interview.id) || identifiers.has(interview.id) || typeof interview.title !== 'string' || !interview.title.trim() || !Array.isArray(interview.recordings)) throw new Error(msg('projectStore.m1384'));
    if (interview.metadata && (typeof interview.metadata.location !== 'string' || !Array.isArray(interview.metadata.topics) || !interview.metadata.topics.every(t => typeof t === 'string')
        || !Array.isArray(interview.metadata.participants) || !interview.metadata.participants.every(person => person && typeof person.name === 'string' && typeof person.role === 'string')
        || (interview.metadata.recorded_at !== null && typeof interview.metadata.recorded_at !== 'string'))) throw new Error(msg('projectStore.m1385'));
    identifiers.add(interview.id);
    for (const recording of interview.recordings) {
      if (!recording || !id(recording.id) || identifiers.has(recording.id) || !safeName(recording.file) || typeof recording.name !== 'string'
          || !['copy', 'reference', 'none'].includes(recording.storage) || typeof recording.fingerprint !== 'string'
          || (recording.storage !== 'none' && !/^\d+:[a-f0-9]{64}$/.test(recording.fingerprint))) throw new Error(msg('projectStore.m1386'));
      if (recording.manuscriptOrder && (!Array.isArray(recording.manuscriptOrder) || !recording.manuscriptOrder.every(id) || new Set(recording.manuscriptOrder).size !== recording.manuscriptOrder.length)) throw new Error(msg('projectStore.m1387'));
      identifiers.add(recording.id);
      if (recording.manuscriptDirectory !== undefined && (!safeName(recording.manuscriptDirectory) || !/^import-[a-zA-Z0-9-]+\.transcript$/.test(recording.manuscriptDirectory))) throw new Error(msg('projectStore.m1388'));
    }
  }
  if (p.trash !== undefined) {
    if (!Array.isArray(p.trash)) throw new Error(msg('projectStore.m1389'));
    const trashIds = new Set<string>();
    for (const item of p.trash) {
      if (!item || !id(item.id) || trashIds.has(item.id) || typeof item.name !== 'string' || typeof item.deletedAt !== 'string'
          || !p.interviews.some(i=>i.id===item.interviewId) || !Number.isInteger(item.position) || item.position < 0
          || (item.originalRecordingId !== undefined && !id(item.originalRecordingId)) || (item.keptDocumentId !== undefined && !id(item.keptDocumentId))) throw new Error(msg('projectStore.m1390'));
      trashIds.add(item.id);
      parseProject(JSON.stringify({ ...p, trash: undefined, interviews: [{ id:item.interviewId, title:'回收站', recordings:[item.recording] }] }));
    }
  }
  return p;
}
async function readText(dir: FileSystemDirectoryHandle, name: string): Promise<string | null> {
  try { return await (await (await dir.getFileHandle(name)).getFile()).text(); }
  catch (error) { if (notFound(error)) return null; throw error; }
}
async function writeText(dir: FileSystemDirectoryHandle, name: string, text: string) {
  const handle = await dir.getFileHandle(name, { create: true });
  const stream = await handle.createWritable();
  try { await stream.write(text); await stream.close(); }
  catch (error) { await stream.abort().catch(() => {}); throw error; }
  if (await readText(dir, name) !== text) throw new Error(msg('projectStore.m1392'));
}
export async function openProject(directory: FileSystemDirectoryHandle): Promise<OpenProject> {
  const raw = await readText(directory, INDEX);
  if (raw === null) throw new Error(msg('projectStore.m1393'));
  // Do not silently open an older backup: it could hide newly created interviews.
  return { directory, data: parseProject(raw) };
}
export async function acquireProjectEditor(projectId: string): Promise<() => void> {
  if (typeof navigator === 'undefined' || !navigator.locks) return () => {};
  return new Promise((resolve, reject) => {
    void navigator.locks.request(`ripple-project-editor:${projectId}`, { ifAvailable: true }, async lock => {
      if (!lock) { reject(new Error(msg('projectStore.m1394'))); return; }
      await new Promise<void>(release => resolve(release));
    }).catch(reject);
  });
}
async function locked<T>(projectId: string, work: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request(`ripple-project:${projectId}`, work);
  return work();
}
export async function saveProject(project: OpenProject, next: RippleProject): Promise<OpenProject> {
  return locked(project.data.id, async () => {
    const original = await readText(project.directory, INDEX);
    if (original === null) throw new Error(msg('projectStore.m1395'));
    const current = parseProject(original);
    if (current.id !== project.data.id || current.revision !== project.data.revision) throw new Error(msg('projectStore.m1396'));
    const updated = { ...next, id: current.id, revision: current.revision + 1 };
    const text = JSON.stringify(updated, null, 2);
    parseProject(text);
    await writeText(project.directory, `${INDEX}.bak`, original);
    try { await writeText(project.directory, INDEX, text); }
    catch (error) {
      try { await writeText(project.directory, INDEX, original); } catch { /* Verified backup is retained. */ }
      throw error;
    }
    return { directory: project.directory, data: updated };
  });
}
export async function createProject(parent: FileSystemDirectoryHandle, title: string): Promise<OpenProject> {
  const name = title.trim();
  if (!safeName(name) || name.length > 120) throw new Error(msg('projectStore.m1397'));
  const folder = `${name}.ripple`;
  try { await parent.getDirectoryHandle(folder); throw new Error(msg('projectStore.m1398')); }
  catch (error) { if (!notFound(error)) throw error; }
  const directory = await parent.getDirectoryHandle(folder, { create: true });
  const data: RippleProject = { kind: 'ripple-project', schemaVersion: 1, id: crypto.randomUUID(), title: name, description: '', revision: 0, interviews: [] };
  await writeText(directory, INDEX, JSON.stringify(data, null, 2));
  return { directory, data };
}

// Browser handles are machine-local. Project metadata remains portable; external media can be relinked.
async function handleDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('ripple-project-handles', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
}
export async function handleValue<T>(key: string, value?: T): Promise<T | undefined> {
  const db = await handleDb();
  try { return await new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction('handles', value === undefined ? 'readonly' : 'readwrite');
    const native = nativeDesktopAvailable();
    const req = value === undefined ? tx.objectStore('handles').get(key) : tx.objectStore('handles').put(native ? encodeNativeHandles(value) : value, key);
    tx.oncomplete = () => resolve(value === undefined ? native ? decodeNativeHandles(req.result as T) : req.result as T : value);
    tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}
export async function recentProjects(): Promise<{ title: string; id: string; directory: FileSystemDirectoryHandle }[]> {
  return await handleValue('recent') ?? [];
}
export async function rememberProject(project: OpenProject) {
  await locked('recent-projects', async () => {
    const recent = await recentProjects();
    await handleValue('recent', [{ title: project.data.title, id: project.data.id, directory: project.directory }, ...recent.filter(p => p.id !== project.data.id)].slice(0, 20));
  });
}
export async function forgetRecentProject(projectId: string) {
  await locked('recent-projects', async () => {
    await handleValue('recent', (await recentProjects()).filter(p => p.id !== projectId));
  });
}
export async function permit(handle: FileSystemHandle, mode: 'read' | 'readwrite') {
  const h = handle as FileSystemHandle & { requestPermission?: (options: { mode: string }) => Promise<string> };
  if (h.requestPermission && await h.requestPermission({ mode }) !== 'granted') throw new Error(msg('projectStore.m1399'));
}
export async function mediaFingerprint(file: Blob): Promise<string> {
  // Hash every byte in bounded chunks, rather than identifying a recording by name or its first few seconds.
  const parts: Uint8Array[] = [];
  for (let offset = 0; offset < file.size; offset += 2 * 1024 * 1024) {
    parts.push(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.slice(offset, offset + 2 * 1024 * 1024).arrayBuffer())));
  }
  const hashes = new Uint8Array(parts.length * 32);
  parts.forEach((part, i) => hashes.set(part, i * 32));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', hashes));
  return `${file.size}:${Array.from(digest, n => n.toString(16).padStart(2, '0')).join('')}`;
}
async function interviewDirectory(project: OpenProject, interviewId: string, create = false) {
  return (await project.directory.getDirectoryHandle('interviews', { create })).getDirectoryHandle(interviewId, { create });
}
export async function addInterview(project: OpenProject, title: string): Promise<OpenProject> {
  if (!title.trim()) throw new Error(msg('projectStore.m1400'));
  const interviewId = crypto.randomUUID();
  const interview: ProjectInterview = { id: interviewId, title: title.trim(), metadata: { ...defaultMetadata(title.trim()), id: interviewId }, recordings: [] };
  await interviewDirectory(project, interview.id, true);
  return saveProject(project, { ...project.data, interviews: [...project.data.interviews, interview] });
}
export async function addRecordings(project: OpenProject, interviewId: string, handles: FileSystemFileHandle[], storage: 'copy' | 'reference'): Promise<OpenProject> {
  const interview = project.data.interviews.find(i => i.id === interviewId);
  if (!interview) throw new Error(msg('projectStore.m1401'));
  const directory = await interviewDirectory(project, interviewId, true);
  const media = await directory.getDirectoryHandle('media', { create: true });
  const added: ProjectRecording[] = [];
  for (const handle of handles) {
    const file = await handle.getFile();
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!AUDIO_EXT.includes(ext)) throw new Error(msg('projectStore.m1402', { v0: file.name }));
    const recordingId = crypto.randomUUID();
    const recording: ProjectRecording = { id: recordingId, name: file.name, file: `${recordingId}.${ext}`, storage, fingerprint: await mediaFingerprint(file) };
    if (storage === 'copy') {
      const target = await media.getFileHandle(recording.file, { create: true });
      const writable = await target.createWritable();
      try { await file.stream().pipeTo(writable); } catch (error) { await writable.abort().catch(() => {}); throw error; }
      if (await mediaFingerprint(await target.getFile()) !== recording.fingerprint) throw new Error(msg('projectStore.m1403'));
    } else await handleValue(`media:${project.data.id}:${recording.id}`, handle);
    added.push(recording);
  }
  return saveProject(project, { ...project.data, interviews: project.data.interviews.map(i => i.id === interviewId ? { ...i, recordings: [...i.recordings, ...added] } : i) });
}
export async function resolveMedia(project: OpenProject, interviewId: string, recording: ProjectRecording): Promise<FileSystemFileHandle> {
  if (recording.storage === 'none') throw new ProjectMediaUnavailable('');
  if (recording.storage === 'copy') {
    const dir = await interviewDirectory(project, interviewId);
    return (await dir.getDirectoryHandle('media')).getFileHandle(recording.file);
  }
  const handle = await handleValue<FileSystemFileHandle>(`media:${project.data.id}:${recording.id}`);
  if (!handle) throw new Error(msg('projectStore.m1404'));
  return handle;
}
export async function relinkMedia(project: OpenProject, interviewId: string, recording: ProjectRecording, handle: FileSystemFileHandle): Promise<OpenProject> {
  return checkedTrashMutation(project,async()=>{
  const file = await handle.getFile();
  const fingerprint = await mediaFingerprint(file);
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!AUDIO_EXT.includes(ext)) throw new Error(msg('projectStore.m1405'));
  if (recording.storage !== 'none' && fingerprint !== recording.fingerprint) throw new Error(msg('projectStore.m1406'));
  await handleValue(`media:${project.data.id}:${recording.id}`, handle);
  return saveProject(project, { ...project.data, interviews: project.data.interviews.map(i => i.id === interviewId ? { ...i, recordings: i.recordings.map(r => r.id === recording.id ? { ...r, storage: 'reference', fingerprint, ...(r.storage === 'none' ? { file: `${r.id}.${ext}`, name: file.name } : {}) } : r) } : i) });
  });
}
export class ProjectMediaUnavailable extends Error {}
export async function recordingDirectory(project: OpenProject, interviewId: string, recording: ProjectRecording): Promise<FileSystemDirectoryHandle> {
  const directory = await interviewDirectory(project, interviewId);
  // A single recording view isolates existing editor/version code without duplicating external media.
  // Manuscript filenames use stable IDs, independent of display titles or source filenames.
  const audioHandle = {
    kind: 'file', name: recording.file,
    async getFile() {
      if (recording.storage === 'none') throw new ProjectMediaUnavailable('');
      try {
        const file = await (await resolveMedia(project, interviewId, recording)).getFile();
        if (await mediaFingerprint(file) !== recording.fingerprint) throw new Error(msg('projectStore.m1407'));
        return file;
      } catch { throw new ProjectMediaUnavailable(msg('projectStore.m1408')); }
    },
  };
  return {
    kind: 'directory', name: `${project.data.id}-${recording.id}`,
    getFileHandle: (name: string, options?: FileSystemGetFileOptions) => {
      if (name === recording.file) {
        if (options?.create) throw new Error(msg('projectStore.m1409'));
        return Promise.resolve(audioHandle);
      }
      return directory.getFileHandle(name, options);
    },
    getDirectoryHandle: (name: string, options?: FileSystemGetDirectoryOptions) => directory.getDirectoryHandle(
      name === `${stemOf(recording.file)}.transcript` && recording.manuscriptDirectory ? recording.manuscriptDirectory : name, options),
    removeEntry: async (name: string, options?: FileSystemRemoveOptions) => {
      if (name === recording.file || name === 'media') throw new Error(msg('projectStore.m1410'));
      return directory.removeEntry(name, options);
    },
    async *entries() { yield [recording.file, audioHandle]; },
    isSameEntry: async () => false,
  } as unknown as FileSystemDirectoryHandle;
}
export async function searchProject(project: OpenProject, query: string) {
  const results: { interviewId: string; recordingId: string | null; title: string; text: string }[] = [];
  const term = query.trim().toLocaleLowerCase();
  if (!term) return results;
  for (const interview of project.data.interviews) {
    if (!interview.recordings.length && interview.title.toLocaleLowerCase().includes(term)) {
      results.push({ interviewId: interview.id, recordingId: null, title: interview.title, text: msg('projectStore.m1411') });
    }
    for (const recording of interview.recordings) {
    const directory = await recordingDirectory(project, interview.id, recording);
    const edited = await readEdited(directory, recording.file);
    const matches = edited?.transcript.segments.filter(s => s.text.toLocaleLowerCase().includes(term)) ?? [];
    if (interview.title.toLocaleLowerCase().includes(term) || recording.name.toLocaleLowerCase().includes(term) || matches.length) {
      results.push({ interviewId: interview.id, recordingId: recording.id, title: `${interview.title} · ${recording.name}`, text: matches.slice(0, 3).map(s => s.text).join(' … ').slice(0, 350) });
    }
  }
  }
  return results;
}

async function copyTree(source: FileSystemDirectoryHandle, target: FileSystemDirectoryHandle) {
  for await (const [name, handle] of (source as FileSystemDirectoryHandle & { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
    if (handle.kind === 'directory') await copyTree(handle as FileSystemDirectoryHandle, await target.getDirectoryHandle(name, { create: true }));
    else {
      const file = await (handle as FileSystemFileHandle).getFile();
      const destination = await target.getFileHandle(name, { create: true });
      await file.stream().pipeTo(await destination.createWritable());
      if (await mediaFingerprint(await destination.getFile()) !== await mediaFingerprint(file) || await mediaFingerprint(await (handle as FileSystemFileHandle).getFile()) !== await mediaFingerprint(file)) throw new Error(msg('projectStore.m1412'));
    }
  }
}
export async function savePortableProject(project: OpenProject, parent: FileSystemDirectoryHandle, title: string): Promise<OpenProject> {
  // Prevent an active editor in another window from changing manuscripts during the copy.
  const release = await acquireProjectEditor(project.data.id);
  try { return await locked(project.data.id, async () => {
    const source = await openProject(project.directory);
    if (source.data.revision !== project.data.revision) throw new Error(msg('projectStore.m1413'));
    if (project.directory.resolve && await project.directory.resolve(parent) !== null) throw new Error(msg('projectStore.m1414'));
    const created = await createProject(parent, title);
    // Keep a failed copy unmistakably incomplete: canonical index is published only after verification.
    await created.directory.removeEntry(INDEX);
    await writeText(created.directory, 'COPY-INCOMPLETE.txt', msg('projectStore.m1415'));
    const interviews = await created.directory.getDirectoryHandle('interviews', { create: true });
    for (const interview of source.data.interviews) {
      const to = await interviews.getDirectoryHandle(interview.id, { create: true });
      // Empty interviews are valid and need no source directory.
      if (!interview.recordings.length) continue;
      const from = await interviewDirectory(source, interview.id);
      for (const recording of interview.recordings) {
        const folderName = recording.manuscriptDirectory ?? `${stemOf(recording.file)}.transcript`;
        let manuscripts: FileSystemDirectoryHandle | undefined;
        try { manuscripts = await from.getDirectoryHandle(folderName); }
        catch(e) { if(!notFound(e))throw e; }
        let manuscriptNames:string[]=[];
        if(manuscripts) {
          const raw=await readText(manuscripts,'manifest.json');
          if(!raw)throw new Error(msg('projectStore.m1416', { v0: recording.name }));
          const manifest=JSON.parse(raw) as TranscriptManifest;
          if(!Array.isArray(manifest.models))throw new Error(msg('projectStore.m1417'));
          manuscriptNames=manifest.models.map(m=>m.label||m.sourceName||m.engine);
          const target=await to.getDirectoryHandle(folderName,{create:true});
          const files=new Set(manifest.models.flatMap(m=>[...(m.original?[m.original]:[]),...m.edits.map(e=>e.file)]));
          for(const file of files){
            if(!safeName(file))throw new Error(msg('projectStore.m1418'));
            const text=await readText(manuscripts,file);
            if(text===null)throw new Error(msg('projectStore.m1419', { v0: file }));
            await writeText(target,file,text);
          }
          await writeText(target,'manifest.json',raw);
        }
        if (recording.storage === 'none') continue;
        if (recording.storage === 'reference') {
          await writeText(to,msg('projectStore.m1420', { v0: recording.id }),referenceAudioNotice(recording,interview.title,manuscriptNames));
          continue;
        }
        const file = await checkedMediaFile(source, interview.id, recording);
        const media = await to.getDirectoryHandle('media', { create: true });
        await file.stream().pipeTo(await (await media.getFileHandle(recording.file, { create: true })).createWritable());
        if (await mediaFingerprint(await (await media.getFileHandle(recording.file)).getFile()) !== recording.fingerprint) throw new Error(msg('projectStore.m1421'));
      }
    }
    const finalSource = await openProject(project.directory);
    if (finalSource.data.revision !== source.data.revision) throw new Error(msg('projectStore.m1422'));
    const data: RippleProject = { ...source.data, id: created.data.id, title: title.trim(), revision: 0, trash: [] };
    await writeText(created.directory, INDEX, JSON.stringify(data, null, 2));
    await created.directory.removeEntry('COPY-INCOMPLETE.txt');
    return { directory: created.directory, data };
  }); } finally { release(); }
}

export interface ExistingManuscript {
  recordingId: string;
  parent: FileSystemDirectoryHandle;
  directory: FileSystemDirectoryHandle;
  manifestText: string;
  manifest: TranscriptManifest;
}
/** Read-only discovery: never use legacy readManifest, which can migrate its source. */
export async function findExistingManuscripts(parent: FileSystemDirectoryHandle, recordings: ProjectRecording[]): Promise<ExistingManuscript[]> {
  const found: ExistingManuscript[] = [];
  const fingerprints = new Map<string, string>();
  for await (const [name, handle] of (parent as FileSystemDirectoryHandle & { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
    if (handle.kind !== 'directory' || !name.endsWith('.transcript')) continue;
    const directory = handle as FileSystemDirectoryHandle;
    const raw = await readText(directory, 'manifest.json');
    if (!raw) continue;
    let manifest: TranscriptManifest;
    try { manifest = JSON.parse(raw); } catch { continue; }
    if (!manifest || !safeName(manifest.audio)) continue;
    let fingerprint = fingerprints.get(manifest.audio);
    if (!fingerprint) {
      try {
        const audio = await (await parent.getFileHandle(manifest.audio)).getFile();
        if (!recordings.some(r => r.fingerprint.startsWith(`${audio.size}:`))) continue;
        fingerprint = await mediaFingerprint(audio);
      }
      catch (error) { if (notFound(error)) continue; throw error; }
      fingerprints.set(manifest.audio, fingerprint);
    }
    for (const recording of recordings) if (recording.fingerprint === fingerprint) {
      await validateSourceAudio(parent, manifest, recording);
      await validateManuscript(directory, manifest);
      found.push({ recordingId: recording.id, parent, directory, manifestText: raw, manifest });
    }
  }
  return found;
}
async function validateSourceAudio(parent: FileSystemDirectoryHandle, manifest: TranscriptManifest, recording: ProjectRecording) {
  const audio = await (await parent.getFileHandle(manifest.audio)).getFile();
  if (await mediaFingerprint(audio) !== recording.fingerprint) throw new Error(msg('projectStore.m1423'));
  if (manifest.audioFingerprint) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await audio.slice(0, 65536).arrayBuffer()));
    const fingerprint = `${audio.size}:${Array.from(digest, n => n.toString(16).padStart(2, '0')).join('')}`;
    if (fingerprint !== manifest.audioFingerprint) throw new Error(msg('projectStore.m1424'));
  }
}
async function validateManuscript(directory: FileSystemDirectoryHandle, manifest: TranscriptManifest) {
  if (manifest.schemaVersion !== 2 || !Array.isArray(manifest.models) || !manifest.models.length) throw new Error(msg('projectStore.m1425'));
  const ids = new Set<string>();
  for (const model of manifest.models) {
    if (!model || !id(model.id) || ids.has(model.id) || !Array.isArray(model.edits) || !model.edits.length || typeof model.engine !== 'string') throw new Error(msg('projectStore.m1426'));
    ids.add(model.id);
    const edits = new Set<string>();
    for (const edit of model.edits) {
      if (!edit || !id(edit.id) || edits.has(edit.id)) throw new Error(msg('projectStore.m1427'));
      edits.add(edit.id);
    }
    if (!edits.has(model.activeEditId) || model.edits.some(e => e.comparisonBaseId && !edits.has(e.comparisonBaseId))) throw new Error(msg('projectStore.m1428'));
    for (const file of [...(model.original ? [model.original] : []), ...model.edits.map(e => e.file)]) {
      if (!safeName(file)) throw new Error(msg('projectStore.m1429'));
      const text = await readText(directory, file);
      if (!text) throw new Error(msg('projectStore.m1430', { v0: file }));
      const data = JSON.parse(text);
      if (!data?.transcript || !Array.isArray(data.transcript.segments) || !Array.isArray(data.transcript.speakers)
          || data.transcript.segments.some((s: { text?: unknown }) => !s || typeof s.text !== 'string')) throw new Error(msg('projectStore.m1431', { v0: file }));
    }
  }
  if (!ids.has(manifest.activeModelId)) throw new Error(msg('projectStore.m1432'));
}
/** Stage a complete copy, then publish its pointer in the project index. Never replace existing manuscripts. */
export async function importExistingManuscript(project: OpenProject, interviewId: string, recording: ProjectRecording, source: ExistingManuscript): Promise<OpenProject> {
  const release = await acquireProjectEditor(project.data.id);
  try {
    const fresh = await openProject(project.directory);
    if (fresh.data.revision !== project.data.revision) throw new Error(msg('projectStore.m1433'));
    if (source.recordingId !== recording.id) throw new Error(msg('projectStore.m1434'));
    await validateSourceAudio(source.parent, source.manifest, recording);
    const directory = await interviewDirectory(project, interviewId);
    const targetName = recording.manuscriptDirectory ?? `${stemOf(recording.file)}.transcript`;
    try {
      const previous = await directory.getDirectoryHandle(targetName);
      for await (const _entry of (previous as FileSystemDirectoryHandle & { entries(): AsyncIterable<unknown> }).entries()) {
        void _entry;
        throw new Error(msg('projectStore.m1435'));
      }
    } catch (error) { if (!notFound(error)) throw error; }
    if (await readText(source.directory, 'manifest.json') !== source.manifestText) throw new Error(msg('projectStore.m1436'));
    await validateManuscript(source.directory, source.manifest);
    const manuscriptDirectory = `import-${crypto.randomUUID()}.transcript`;
    const staged = await directory.getDirectoryHandle(manuscriptDirectory, { create: true });
    await copyTree(source.directory, staged);
    if (await readText(source.directory, 'manifest.json') !== source.manifestText || await readText(staged, 'manifest.json') !== source.manifestText) throw new Error(msg('projectStore.m1437'));
    const manifest = { ...source.manifest, audio: recording.file };
    await writeText(staged, 'manifest.json', JSON.stringify(manifest, null, 2));
    const active = manifest.models.find(m => m.id === manifest.activeModelId)!;
    const activeFile = active.edits.find(e => e.id === active.activeEditId)!;
    const data = JSON.parse((await readText(staged, activeFile.file))!);
    // Preserve source metadata in every copied version; fill only missing shared interview fields.
    const incoming = { ...data.metadata, ...manifest.interviewDetails } as Partial<InterviewMetadata>;
    return await saveProject(project, { ...project.data, interviews: project.data.interviews.map(i => {
      if (i.id !== interviewId) return i;
      const metadata = i.metadata ?? defaultMetadata(i.title);
      return { ...i, metadata: { ...metadata,
        recorded_at: metadata.recorded_at ?? incoming.recorded_at ?? null,
        location: metadata.location || incoming.location || '',
        topics: metadata.topics.length ? metadata.topics : incoming.topics ?? [],
        participants: metadata.participants.length ? metadata.participants : incoming.participants ?? [],
        notes: metadata.notes || incoming.notes || '',
      }, recordings: i.recordings.map(r => r.id === recording.id ? { ...r, manuscriptDirectory } : r) };
    }) });
  } finally { release(); }
}

/** Stage all selected materials; publish once so a failure cannot expose half an import. */
export async function importProjectMaterials(project: OpenProject, materials: ImportMaterial[], storage: 'copy' | 'reference', existingInterviewId?: string, sessions?: ProjectInterview[]): Promise<OpenProject> {
  if (!materials.length && !sessions?.length) throw new Error(msg('projectStore.m1438'));
  const release = await acquireProjectEditor(project.data.id);
  try {
    const fresh = await openProject(project.directory);
    if (fresh.data.revision !== project.data.revision) throw new Error(msg('projectStore.m1439'));
    const groups = new Map<string, ProjectInterview>();
    const existing = existingInterviewId ? project.data.interviews.find(i => i.id === existingInterviewId) : undefined;
    if (existingInterviewId && !existing) throw new Error(msg('projectStore.m1440'));
    if (sessions) for (const session of sessions) {
      if (!session.title.trim()) throw new Error(msg('projectStore.m1441'));
      const matched = project.data.interviews.find(i => i.id === session.id);
      groups.set(session.id, { ...session, recordings: [...(matched?.recordings ?? [])] });
      await interviewDirectory(project, session.id, true);
    }
    for (const item of materials) {
      if (sessions && !groups.has(item.group)) throw new Error(msg('projectStore.m1442'));
      if (!item.group.trim()) throw new Error(msg('projectStore.m1443'));
      if (item.audioId && !materials.some(m => m.id === item.audioId && m.kind === 'audio' && (existing || m.group.trim() === item.group.trim()))) throw new Error(msg('projectStore.m1444'));
      const group = sessions ? item.group : existing ? existing.title : item.group.trim();
      if (!groups.has(group)) {
        const matches = project.data.interviews.filter(i => i.title === group);
        if (!existing && matches.length > 1) throw new Error(msg('projectStore.m1445'));
        const matched = existing ?? matches[0];
        const interviewId = matched?.id ?? crypto.randomUUID();
        groups.set(group, matched ? { ...matched, recordings: [...matched.recordings] } : { id: interviewId, title: group, metadata: { ...defaultMetadata(group), id: interviewId }, recordings: [] });
      }
    }
    const records = new Map<string, ProjectRecording>();
    for (const item of materials.filter(m => m.kind === 'audio' || !m.audioId)) {
      const interview = groups.get(sessions ? item.group : existing?.title ?? item.group.trim())!;
      const directory = await interviewDirectory(project, interview.id, true);
      if (item.existingRecordingId) {
        const original = interview.recordings.find(r => r.id === item.existingRecordingId && r.storage !== 'none');
        if (!original) throw new Error(msg('projectStore.m1446'));
        const recording = { ...original, name: item.name };
        if (materials.some(m => m.audioId === item.id)) {
          const stagedName = `import-${crypto.randomUUID()}.transcript`;
          const staged = await directory.getDirectoryHandle(stagedName, { create: true });
          let previous: FileSystemDirectoryHandle | undefined;
          try { previous = await directory.getDirectoryHandle(original.manuscriptDirectory ?? `${stemOf(original.file)}.transcript`); }
          catch (error) { if (!notFound(error)) throw error; }
          if (previous) await copyTree(previous, staged);
          recording.manuscriptDirectory = stagedName;
        }
        interview.recordings = interview.recordings.map(r => r.id === recording.id ? recording : r);
        records.set(item.id, recording);
        continue;
      }
      const id = crypto.randomUUID();
      const file = item.kind === 'audio' ? await item.handle.getFile() : undefined;
      const ext = file?.name.split('.').pop()?.toLowerCase() ?? 'wav';
      const recording: ProjectRecording = { id, name: item.name, file: `${id}.${ext}`, storage: file ? item.storage ?? storage : 'none', fingerprint: file ? await mediaFingerprint(file) : '' };
      if (file && recording.storage === 'copy') {
        const media = await directory.getDirectoryHandle('media', { create: true });
        const target = await media.getFileHandle(recording.file, { create: true });
        await file.stream().pipeTo(await target.createWritable());
        if (await mediaFingerprint(await target.getFile()) !== recording.fingerprint) throw new Error(msg('projectStore.m1447'));
      } else if (file) await handleValue(`media:${project.data.id}:${id}`, item.handle);
      interview.recordings.push(recording); records.set(item.id, recording);
    }
    for (const item of materials.filter(m=>m.kind==='manuscript')) {
      if (!item.transcript) throw new Error(msg('projectStore.m1448'));
      const interview = groups.get(sessions ? item.group : existing?.title ?? item.group.trim())!;
      const recording = records.get(item.audioId || item.id)!;
      const view = await recordingDirectory(project, interview.id, recording);
      const transcript = { ...item.transcript, audio: { ...item.transcript.audio, filename: recording.storage === 'none' ? '' : recording.name } };
      await createModel(view, recording.file, { engine:item.ripple?.engine||'imported',sourceKind:'import',sourceName:item.name,transcript,original:transcript,originalOnly:!!item.isOriginal,designatedOriginal:!!item.isOriginal,metadata:{...defaultMetadata(stemOf(item.name)),recorded_at:interview.metadata?.recorded_at??null,location:interview.metadata?.location??'',...item.ripple?.metadata} });
    }
    const updated = new Map([...groups.values()].map(i => [i.id, i]));
    return await saveProject(project, { ...project.data, interviews: [
      ...project.data.interviews.map(i => updated.get(i.id) ?? i),
      ...[...updated.values()].filter(i => !project.data.interviews.some(old => old.id === i.id)),
    ] });
  } finally { release(); }
}

/** Move a complete manuscript history within an interview; never overwrite another history. */
export async function reassignManuscript(project: OpenProject, interviewId: string, sourceId: string, targetId: string, modelId?: string): Promise<OpenProject> {
  const release = await acquireProjectEditor(project.data.id);
  try {
    const fresh = await openProject(project.directory);
    if (fresh.data.revision !== project.data.revision) throw new Error(msg('projectStore.m1449'));
    const interview = project.data.interviews.find(i => i.id === interviewId);
    const source = interview?.recordings.find(r => r.id === sourceId);
    const target = interview?.recordings.find(r => r.id === targetId);
    if (!interview || !source || sourceId === targetId || (targetId && (!target || target.storage === 'none'))) throw new Error(msg('projectStore.m1450'));
    const directory = await interviewDirectory(project, interviewId);
    const manuscript = await directory.getDirectoryHandle(source.manuscriptDirectory ?? `${stemOf(source.file)}.transcript`);
    const sourceManifest = JSON.parse(await (await manuscript.getFileHandle('manifest.json')).getFile().then(f => f.text()));
    if (!sourceManifest.models?.length) throw new Error(msg('projectStore.m1451'));
    if (modelId && !sourceManifest.models.some((m: { id: string }) => m.id === modelId)) throw new Error(msg('projectStore.m1452'));
    // Whole-history legacy moves still require an empty destination. Individual documents can append.
    let targetSnapshot: { folder: FileSystemDirectoryHandle; manifest: TranscriptManifest } | undefined;
    if (target) {
      let existing: FileSystemDirectoryHandle | undefined;
      try { existing = await directory.getDirectoryHandle(target.manuscriptDirectory ?? `${stemOf(target.file)}.transcript`); }
      catch (e) { if (!notFound(e)) throw e; }
      if (existing) {
        const manifest = JSON.parse(await (await existing.getFileHandle('manifest.json')).getFile().then(f => f.text()));
        if (!Array.isArray(manifest.models) || (!modelId && manifest.models.length)) throw new Error(msg('projectStore.m1453'));
        targetSnapshot={folder:existing,manifest};
      }
    }
    const stagedName = `import-${crypto.randomUUID()}.transcript`;
    await copyTree(manuscript, await directory.getDirectoryHandle(stagedName, { create: true }));
    const movedModels = sourceManifest.models.filter((m: { id: string }) => !modelId || m.id === modelId);
    const keptModels = sourceManifest.models.filter((m: { id: string }) => modelId && m.id !== modelId);
    if (modelId) await writeText(await directory.getDirectoryHandle(stagedName), 'manifest.json', JSON.stringify({ ...sourceManifest, models: movedModels, activeModelId: movedModels[0].id }));
    if (targetSnapshot && modelId) {
      const folder=await directory.getDirectoryHandle(stagedName);
      // Start with the destination; imported version files receive unique names.
      await copyTree(targetSnapshot.folder,folder);
      const merged={...targetSnapshot.manifest,models:[...targetSnapshot.manifest.models]};
      for(const model of movedModels as TranscriptManifest['models']){
        let nextId=model.id;
        if(merged.models.some(m=>m.id===nextId)){let n=1;while(merged.models.some(m=>m.id===`m${n}`))n++;nextId=`m${n}`;}
        const copyVersion=async(file:string)=>{
          if(!safeName(file))throw new Error(msg('projectStore.m1454'));
          const raw=await readText(manuscript,file);if(raw===null)throw new Error(msg('projectStore.m1455'));
          const value=JSON.parse(raw);
          const remap=(node:unknown):void=>{
            if(!node||typeof node!=='object')return;
            if(Array.isArray(node)){node.forEach(remap);return;}
            for(const [key,child] of Object.entries(node)){
              if(key==='origins'&&Array.isArray(child))for(const origin of child)if(origin?.model===model.id)origin.model=nextId;
              remap(child);
            }
          };
          if(nextId!==model.id)remap(value);
          const name=`associated-${crypto.randomUUID()}.json`;await writeText(folder,name,JSON.stringify(value));return name;
        };
        merged.models.push({...model,id:nextId,original:model.original?await copyVersion(model.original):undefined,edits:await Promise.all(model.edits.map(async edit=>({...edit,file:await copyVersion(edit.file)})))});
        if(!merged.activeModelId)merged.activeModelId=nextId;
      }
      await writeText(folder,'manifest.json',JSON.stringify(merged));
    }
    // Stage the remaining history too; keep original files untouched for recovery.
    const emptyName = `import-${crypto.randomUUID()}.transcript`;
    const emptyDirectory = await directory.getDirectoryHandle(emptyName, { create: true });
    if (keptModels.length) await copyTree(manuscript, emptyDirectory);
    await writeText(emptyDirectory, 'manifest.json', JSON.stringify({ ...sourceManifest, models: keptModels, activeModelId: keptModels.some((m: { id: string }) => m.id === sourceManifest.activeModelId) ? sourceManifest.activeModelId : keptModels[0]?.id ?? '' }));
    const detachedId = crypto.randomUUID();
    const destination: ProjectRecording = target ? { ...target, manuscriptDirectory: stagedName } : {
      id: detachedId, name: `${source.name} · 转录稿`, file: `${detachedId}.wav`, storage: 'none', fingerprint: '', manuscriptDirectory: stagedName,
    };
    const recordings = interview.recordings.flatMap(r => r.id === sourceId ? source.storage === 'none' && !keptModels.length ? [] : [{ ...r, manuscriptDirectory: emptyName }] : r.id === targetId ? [destination] : [r]);
    if (!target) recordings.push(destination);
    return await saveProject(project, { ...project.data, interviews: project.data.interviews.map(i => i.id === interviewId ? { ...i, recordings } : i) });
  } finally { release(); }
}

async function checkedTrashMutation<T>(project: OpenProject, work: () => Promise<T>): Promise<T> {
  const release = await acquireProjectEditor(project.data.id);
  try {
    if ((await openProject(project.directory)).data.revision !== project.data.revision) throw new Error(msg('projectStore.m1457'));
    return await work();
  } finally { release(); }
}
async function manuscriptSnapshot(project: OpenProject, interviewId: string, recording: ProjectRecording) {
  const directory = await interviewDirectory(project, interviewId);
  let folder: FileSystemDirectoryHandle;
  try { folder = await directory.getDirectoryHandle(recording.manuscriptDirectory ?? `${stemOf(recording.file)}.transcript`); }
  catch (error) { if (notFound(error)) return null; throw error; }
  const raw = await readText(folder, 'manifest.json');
  if (!raw) throw new Error(msg('projectStore.m1458'));
  const manifest = JSON.parse(raw) as TranscriptManifest;
  if (!Array.isArray(manifest.models)) throw new Error(msg('projectStore.m1459'));
  return { directory, folder, manifest };
}
async function stageModels(directory: FileSystemDirectoryHandle, source: FileSystemDirectoryHandle | null, manifest: TranscriptManifest) {
  const name = `import-${crypto.randomUUID()}.transcript`;
  const folder = await directory.getDirectoryHandle(name, { create: true });
  if (source) await copyTree(source, folder);
  await writeText(folder, 'manifest.json', JSON.stringify(manifest));
  return name;
}
/** Publish deletion by changing only the project index; source snapshots remain intact. */
export async function trashProjectMaterial(project: OpenProject, interviewId: string, recordingId: string, options: { modelId?: string; keepDocuments?: boolean } = {}): Promise<OpenProject> {
  return checkedTrashMutation(project, async () => {
    const session = project.data.interviews.find(i=>i.id===interviewId);
    const recording = session?.recordings.find(r=>r.id===recordingId);
    if (!session || !recording) throw new Error(msg('projectStore.m1460'));
    const snapshot = await manuscriptSnapshot(project, interviewId, recording);
    const position = session.recordings.indexOf(recording);
    let recordings = [...session.recordings];
    const item: ProjectTrashItem = { id:crypto.randomUUID(), name:recording.name, deletedAt:new Date().toISOString(), interviewId, recording, position };
    if (options.modelId) {
      const model = snapshot?.manifest.models.find(m=>m.id===options.modelId);
      if (!snapshot || !model) throw new Error(msg('projectStore.m1461'));
      const kept = snapshot.manifest.models.filter(m=>m.id!==model.id);
      const trashDirectory = await stageModels(snapshot.directory, snapshot.folder, { ...snapshot.manifest, models:[model], activeModelId:model.id });
      const remainingDirectory = await stageModels(snapshot.directory, snapshot.folder, { ...snapshot.manifest, models:kept, activeModelId:kept.some(m=>m.id===snapshot.manifest.activeModelId)?snapshot.manifest.activeModelId:kept[0]?.id??'' });
      const docId=crypto.randomUUID();
      item.name=model.label||model.sourceName||model.engine;
      item.recording={id:docId,name:item.name,file:`${docId}.wav`,storage:'none',fingerprint:'',manuscriptDirectory:trashDirectory};
      if(recording.storage!=='none')item.originalRecordingId=recording.id;
      recordings=recordings.flatMap(r=>r.id!==recording.id?[r]:recording.storage==='none'&&!kept.length?[]:[{...r,manuscriptDirectory:remainingDirectory}]);
    } else {
      recordings=recordings.filter(r=>r.id!==recording.id);
      if(options.keepDocuments && snapshot?.manifest.models.length) {
        const docId=crypto.randomUUID();
        const empty=await stageModels(snapshot.directory,null,{...snapshot.manifest,models:[],activeModelId:''});
        const standalone:ProjectRecording={id:docId,name:recording.name,file:`${docId}.wav`,storage:'none',fingerprint:'',manuscriptOrder:recording.manuscriptOrder,manuscriptDirectory:recording.manuscriptDirectory??`${stemOf(recording.file)}.transcript`};
        // A staged name is also portable and accepted by the project index validator.
        standalone.manuscriptDirectory=await stageModels(snapshot.directory,snapshot.folder,snapshot.manifest);
        recordings.splice(position,0,standalone);
        item.keptDocumentId=docId;item.recording={...recording,manuscriptDirectory:empty};
      }
    }
    return saveProject(project,{...project.data,interviews:project.data.interviews.map(i=>i.id===interviewId?{...i,recordings}:i),trash:[...(project.data.trash??[]),item]});
  });
}
export async function restoreProjectMaterial(project:OpenProject, trashId:string):Promise<OpenProject> {
  return checkedTrashMutation(project,async()=>{
    const item=project.data.trash?.find(t=>t.id===trashId);
    const session=project.data.interviews.find(i=>i.id===item?.interviewId);
    if(!item||!session)throw new Error(msg('projectStore.m1462'));
    let recordings=[...session.recordings];
    let restored={...item.recording};
    if(recordings.some(r=>r.id===restored.id))throw new Error(msg('projectStore.m1463'));
    const kept=recordings.find(r=>r.id===item.keptDocumentId&&r.storage==='none');
    if(kept){restored={...restored,manuscriptDirectory:kept.manuscriptDirectory};recordings=recordings.filter(r=>r.id!==kept.id);}
    const target=recordings.find(r=>r.id===item.originalRecordingId&&r.storage!=='none');
    let attached=false;
    if(target){
      const from=await manuscriptSnapshot(project,session.id,restored);
      const to=await manuscriptSnapshot(project,session.id,target);
      if(from && !from.manifest.models.some(m=>to?.manifest.models.some(t=>t.id===m.id))){
        const dir=await interviewDirectory(project,session.id);
        const merged:TranscriptManifest={...(to?.manifest??from.manifest),models:[...(to?.manifest.models??[])],activeModelId:to?.manifest.activeModelId||from.manifest.activeModelId};
        const stagedName=await stageModels(dir,to?.folder??null,merged);
        const staged=await dir.getDirectoryHandle(stagedName);
        const copyFile=async(name:string)=>{
          if(!safeName(name))throw new Error(msg('projectStore.m1464'));
          const next=`restored-${crypto.randomUUID()}.json`;
          const raw=await readText(from.folder,name);if(raw===null)throw new Error(msg('projectStore.m1465'));
          await writeText(staged,next,raw);return next;
        };
        for(const m of from.manifest.models)merged.models.push({...m,original:m.original?await copyFile(m.original):undefined,edits:await Promise.all(m.edits.map(async e=>({...e,file:await copyFile(e.file)})))});
        await writeText(staged,'manifest.json',JSON.stringify(merged));
        recordings=recordings.map(r=>r.id===target.id?{...r,manuscriptDirectory:stagedName}:r);attached=true;
      }
    }
    if(!attached)recordings.splice(Math.min(item.position,recordings.length),0,restored);
    return saveProject(project,{...project.data,interviews:project.data.interviews.map(i=>i.id===session.id?{...i,recordings}:i),trash:project.data.trash!.filter(t=>t.id!==trashId)});
  });
}
/** Clearing removes recovery entries; external audio is never touched. */
export async function clearProjectTrash(project:OpenProject):Promise<OpenProject>{
  return checkedTrashMutation(project,async()=>{
    const next=await saveProject(project,{...project.data,trash:[]});
    // The index is committed first. Cleanup failure must never resurrect a partly removed item.
    // Recovery snapshots created by earlier operations are deliberately left alone.
    for(const item of project.data.trash??[]){
      const active=next.data.interviews.find(i=>i.id===item.interviewId)?.recordings??[];
      try{
        const directory=await interviewDirectory(next,item.interviewId);
        const folder=item.recording.manuscriptDirectory??`${stemOf(item.recording.file)}.transcript`;
        if(!active.some(r=>(r.manuscriptDirectory??`${stemOf(r.file)}.transcript`)===folder))await directory.removeEntry(folder,{recursive:true});
      }catch{/* Unreferenced recovery files may remain if the filesystem refuses cleanup. */}
      if(item.recording.storage==='copy'&&!active.some(r=>r.storage==='copy'&&r.file===item.recording.file)){
        try{await(await(await interviewDirectory(next,item.interviewId)).getDirectoryHandle('media')).removeEntry(item.recording.file);}catch{/* Never touch external audio. */}
      }
    }
    return next;
  });
}

/** All management manuscript mutations participate in the editor lease. */
export async function mutateProjectManuscript<T>(project:OpenProject, work:()=>Promise<T>):Promise<T>{
  return checkedTrashMutation(project,work);
}
export function referenceAudioNotice(recording:ProjectRecording, interviewTitle:string, manuscripts:string[]=[]):string {
 return msg('projectStore.m1466', { v0: recording.name, v1: interviewTitle, v2: manuscripts.length?manuscripts.join("、"):msg('projectStore.m1467') });
}
export async function checkedMediaFile(project:OpenProject, interviewId:string, recording:ProjectRecording):Promise<File>{
 const file=await(await resolveMedia(project,interviewId,recording)).getFile();
 if(await mediaFingerprint(file)!==recording.fingerprint)throw new Error(msg('projectStore.m1468', { v0: recording.name }));
 return file;
}
