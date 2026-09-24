import { apiErrorMessage } from '../i18n/errors';
import { msg } from '../i18n';
import type { InterviewMetadata, Transcript } from '../types';
import { inspectTranscript } from './import';
import { AUDIO_EXT, stemOf } from '../localStore';
export const MANUSCRIPT_EXT = ['txt', 'doc', 'docx', 'srt', 'vtt', 'json'];
export interface ImportMaterial {
  storage?: 'copy' | 'reference';
  ripple?: { kind: 'te-original' | 'te-edited' | 'te-imported'; metadata?: Partial<InterviewMetadata>; engine?: string };
  isOriginal?: boolean;
  existingRecordingId?: string;
  id: string; handle: FileSystemFileHandle; name: string; group: string;
  kind: 'audio' | 'manuscript'; audioId: string; suggestedAudioId?: string; transcript?: Transcript;
}
export function materialKind(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return AUDIO_EXT.includes(ext) ? 'audio' : MANUSCRIPT_EXT.includes(ext) ? 'manuscript' : null;
}
function plainTranscript(text: string): Transcript {
  const paragraphs = text.replace(/\r\n?/g, '\n').split(/\n+/).filter(line => line.trim());
  if (!paragraphs.length) throw new Error(msg('materialImport.m1363'));
  return { timeAligned: false, audio: { filename: '', duration: 0 }, speakers: [{ id: 'unknown', name: '未标注说话人' }],
    segments: paragraphs.map((text, i) => ({ id: `s${i + 1}`, speaker_id: 'unknown', start: 0, end: 0, text })) };
}
function seconds(value: string) {
  const parts = value.replace(',', '.').split(':').map(Number);
  if (parts.some(n => !Number.isFinite(n)) || parts.length < 2 || parts.length > 3) throw new Error(msg('materialImport.m1365'));
  return parts.reduce((total, n) => total * 60 + n, 0);
}
export async function parseManuscript(file: File): Promise<Transcript> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (file.size > 50 * 1024 * 1024) throw new Error(msg('materialImport.m1366'));
  if (ext === 'doc') {
    const form = new FormData(); form.append('file', file);
    let response: Response;
    try { response = await fetch('/api/manuscripts/legacy-word', { method: 'POST', body: form, signal: AbortSignal.timeout(45000) }); }
    catch { throw new Error(msg('materialImport.m1367')); }
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(apiErrorMessage(result, response.status, msg('materialImport.m1368')));
    if (typeof result?.text !== 'string') throw new Error(msg('materialImport.m1369'));
    return plainTranscript(result.text);
  }
  if (ext === 'docx') {
    const { default: JSZip } = await import('jszip');
    const archive = await JSZip.loadAsync(new Uint8Array(await file.arrayBuffer()));
    const entry = archive.file('word/document.xml');
    if (!entry) throw new Error(msg('materialImport.m1370'));
    const xml = new DOMParser().parseFromString(await entry.async('string'), 'application/xml');
    if (xml.querySelector('parsererror')) throw new Error(msg('materialImport.m1371'));
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const lines = Array.from(xml.getElementsByTagNameNS(ns, 'p')).map(p => Array.from(p.getElementsByTagNameNS(ns, '*')).map(e => e.localName === 't' ? e.textContent ?? '' : e.localName === 'tab' ? '\t' : ['br', 'cr'].includes(e.localName) ? '\n' : '').join(''));
    return plainTranscript(lines.join('\n'));
  }
  const text = (await file.text()).replace(/^\uFEFF/, '');
  if (ext === 'json') {
    const data = JSON.parse(text);
    const raw = data?.transcript ?? data;
    const untimed = Array.isArray(raw?.segments) && raw.segments.every((s: { start?: unknown; end?: unknown }) => s && s.start === undefined && s.end === undefined);
    const checked = inspectTranscript(untimed ? { ...raw, timeAligned: false, segments: raw.segments.map((s: object) => ({ ...s, start: 0, end: 0 })) } : raw);
    if (!checked.ok) throw new Error(checked.message);
    return { ...checked.transcript, timeAligned: !untimed && raw.timeAligned !== false };
  }
  if (ext === 'txt') return plainTranscript(text);
  if (ext !== 'srt' && ext !== 'vtt') throw new Error(msg('materialImport.m1372'));
  const transcript = plainTranscript('占位');
  transcript.timeAligned = true; transcript.segments = [];
  for (const block of text.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    const lines = block.split('\n');
    const index = lines.findIndex(line => line.includes('-->'));
    if (index < 0) continue;
    const match = lines[index].match(/(\d{1,2}:\d{2}(?::\d{2})?[.,]\d+)\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?[.,]\d+)/);
    if (!match) throw new Error(msg('materialImport.m1374'));
    const start = seconds(match[1]), end = seconds(match[2]);
    if (end < start) throw new Error(msg('materialImport.m1375'));
    const content = lines.slice(index + 1).join('\n');
    if (!content.trim()) continue;
    transcript.segments.push({ id: `s${transcript.segments.length + 1}`, speaker_id: 'unknown', start, end, text: content });
  }
  if (!transcript.segments.length) throw new Error(msg('materialImport.m1376'));
  transcript.audio.duration = Math.max(...transcript.segments.map(s => s.end));
  return transcript;
}
export async function prepareMaterials(files: { handle: FileSystemFileHandle; group?: string }[]): Promise<ImportMaterial[]> {
  const materials: ImportMaterial[] = [];
  for (const { handle, group } of files) {
    const kind = materialKind(handle.name);
    if (!kind) throw new Error(msg('materialImport.m1377', { v0: handle.name }));
    const file = kind === 'manuscript' ? await handle.getFile() : undefined;
    const transcript = file ? await parseManuscript(file) : undefined;
    let ripple: ImportMaterial['ripple'];
    if (file && file.name.toLowerCase().endsWith('.json')) {
      const data = JSON.parse((await file.text()).replace(/^\uFEFF/, ''));
      if (['te-original','te-edited','te-imported'].includes(data?.kind) && data.transcript) {
        const m = data.metadata;
        const metadata: Partial<InterviewMetadata> = {};
        if (m && typeof m === 'object') {
          for (const key of ['id','title','location','notes','created_at','updated_at'] as const) if(typeof m[key] === 'string') metadata[key]=m[key];
          if(m.recorded_at===null || typeof m.recorded_at==='string') metadata.recorded_at=m.recorded_at;
          if(Array.isArray(m.topics)) metadata.topics=m.topics.filter((v: unknown)=>typeof v==='string');
          if(Array.isArray(m.participants)) metadata.participants=m.participants.filter((v: {name?: unknown;role?: unknown})=>v && typeof v.name==='string' && typeof v.role==='string');
        }
        ripple={kind:data.kind, metadata, ...(typeof data.engine==='string'?{engine:data.engine}:{})};
      }
    }
    materials.push({ id: crypto.randomUUID(), handle, name: handle.name, group: group || stemOf(handle.name), kind, audioId: '', transcript, ...(ripple?{ripple,isOriginal:ripple.kind==='te-original'}: {}) });
  }
  for (const item of materials.filter(m => m.kind === 'manuscript')) {
    const matching = materials.filter(m => m.kind === 'audio' && m.group === item.group && stemOf(m.name).toLowerCase() === stemOf(item.name).toLowerCase());
    if (matching.length === 1) item.suggestedAudioId = matching[0].id;
  }
  return materials;
}
export async function collectMaterialFiles(directory: FileSystemDirectoryHandle, group = directory.name): Promise<{ handle: FileSystemFileHandle; group: string }[]> {
  const result: { handle: FileSystemFileHandle; group: string }[] = [];
  for await (const [name, handle] of (directory as FileSystemDirectoryHandle & { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
    if (name.startsWith('.') || name.endsWith('.transcript') || name.endsWith('.ripple')) continue;
    if (handle.kind === 'directory') result.push(...await collectMaterialFiles(handle as FileSystemDirectoryHandle, `${group}/${name}`));
    else if (materialKind(name)) result.push({ handle: handle as FileSystemFileHandle, group });
  }
  return result;
}

export function manuscriptImportNotice(item: ImportMaterial): string {
  const notes: string[] = [];
  if (/\.docx?$/i.test(item.handle.name)) notes.push(msg('materialImport.m1378'));
  if (item.transcript?.timeAligned === false) notes.push(msg('materialImport.m1379'));
  return notes.join('');
}
