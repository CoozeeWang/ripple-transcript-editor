import type { Transcript, TranscriptEdit, TranscriptManifest, TranscriptModel, WordOrigin } from '../types';

/** Opaque, recording-independent provenance. Local model IDs can change on association. */
export const validOriginalGroupId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export const hasVisibleOriginal = (model: TranscriptModel) => Boolean(model.designatedOriginal || (model.sourceKind !== 'import' && model.original));
export const originalSourceFile = (model: TranscriptModel) => model.designatedOriginal
  ? (model.edits.find(edit => edit.id === (model.designatedOriginalEditId ?? model.activeEditId)) ?? model.edits[0])?.file ?? model.original
  : model.original;

export interface OriginalGroup {
  original: TranscriptModel | null;
  models: TranscriptModel[];
  missingOriginal?: boolean;
}

/** One original followed by a flat list of related editing models/versions. Never guess by order or name. */
export function originalGroups(models: TranscriptModel[]): OriginalGroup[] {
  const owners = new Map<string, TranscriptModel[]>();
  for (const model of models) if (hasVisibleOriginal(model) && validOriginalGroupId(model.originalGroupId)) {
    owners.set(model.originalGroupId, [...(owners.get(model.originalGroupId) ?? []), model]);
  }
  const owner = (model: TranscriptModel) => {
    const roots = model.originalGroupId ? owners.get(model.originalGroupId) : undefined;
    return roots?.length === 1 ? roots[0] : null;
  };
  return models.flatMap<OriginalGroup>(model => {
    if (hasVisibleOriginal(model)) return [{ original:model, models:[model, ...models.filter(child => !hasVisibleOriginal(child) && owner(child) === model)] }];
    return owner(model) ? [] : [{ original:null, models:[model], missingOriginal:Boolean(model.originalGroupId && !owners.get(model.originalGroupId)?.length) }];
  });
}

export function visibleEdits(model: TranscriptModel): TranscriptEdit[] {
  // A designated manuscript is the read-only source, not another editable choice.
  return model.designatedOriginal ? [] : model.edits;
}

/** Reorder originals with their related models; dragging an edit never changes its original. */
export function reorderOriginalModels(models: TranscriptModel[], id: string, target: string, after: boolean): TranscriptModel[] {
  if (id === target) return models;
  const groups = originalGroups(models);
  const source = groups.findIndex(group => group.models.some(model => model.id === id));
  const destination = groups.findIndex(group => group.models.some(model => model.id === target));
  if (source < 0 || destination < 0) return models;
  const group = groups[source];
  if (source === destination) {
    if (group.original?.id === id) return models;
    const members = [...group.models], from = members.findIndex(model => model.id === id);
    const [moved] = members.splice(from, 1);
    let to = members.findIndex(model => model.id === target) + Number(after);
    if (group.original) to = Math.max(1, to);
    members.splice(to, 0, moved);
    groups[source] = { ...group, models:members };
  } else {
    if (group.original && group.original.id !== id) return models;
    groups.splice(source, 1);
    groups.splice(destination - Number(source < destination) + Number(after), 0, group);
  }
  const next = groups.flatMap(group => group.models);
  return next.every((model, index) => model.id === models[index]?.id) ? models : next;
}

function sourceTranscript(raw: string | null): Transcript | null {
  if (!raw) return null;
  try { const value = JSON.parse(raw).transcript; return Array.isArray(value?.segments)
    && value.segments.every((segment: { text?: unknown } | null) => segment && typeof segment.text === 'string') ? value : null; }
  catch { return null; }
}

/** Backfill in memory only. Persisted word-origin coordinates are evidence, labels are not.
 * Missing/unreadable/ambiguous legacy data stays independent and remains openable. */
export async function withOriginalGroups(manifest: TranscriptManifest, read: (file: string) => Promise<string | null>): Promise<TranscriptManifest> {
  const originals = manifest.models.filter(hasVisibleOriginal);
  const possibleSource = (source: TranscriptModel, copy: TranscriptModel) => {
    const born=Date.parse(source.createdAt ?? ''),copied=Date.parse(copy.createdAt ?? '');
    return (source.sourceKind ?? 'transcription') === (copy.sourceKind ?? 'transcription')
      && Number.isFinite(born) && Number.isFinite(copied) && born <= copied;
  };
  const candidates = manifest.models.filter(model => !hasVisibleOriginal(model) && !model.originalGroupId && Array.isArray(model.edits)
    && model.edits.length && originals.some(source => possibleSource(source, model)));
  if (!originals.length || !candidates.length) return manifest;
  const cache = new Map<string, Promise<string | null>>();
  const load = (file: string) => {
    if (!cache.has(file)) cache.set(file, read(file).catch(() => null));
    return cache.get(file)!;
  };
  const groups = new Map<string, string>();
  for (const model of candidates) {
    const transcript = sourceTranscript(await load(model.edits[0].file));
    if (!transcript) continue;
    if (transcript.segments.some(segment => segment.words && (!Array.isArray(segment.words)
      || segment.words.some(word => !word || (word.origins && !Array.isArray(word.origins)))))) continue;
    const refs: WordOrigin[] = transcript.segments.flatMap(segment => (segment.words ?? []).flatMap(word => word.origins ?? []));
    if (refs.some(ref => !ref || typeof ref.model !== 'string')) continue;
    const sourceIds = new Set(refs.map(ref => ref.model));
    if (!refs.length || sourceIds.size !== 1) continue;
    const sources = originals.filter(original => sourceIds.has(original.id) && possibleSource(original, model));
    const source = sources.length === 1 ? sources[0] : undefined;
    const file = source && originalSourceFile(source);
    if (!source || !file) continue;
    const raw = await load(file), original = sourceTranscript(raw);
    if (!original || !refs.every(ref => {
      const segment = original.segments.find(segment => segment.id === ref.segment);
      return segment && Number.isInteger(ref.from) && Number.isInteger(ref.to) && ref.from >= 0 && ref.to > ref.from && ref.to <= segment.text.length;
    })) continue;
    const anchors = transcript.segments.flatMap(segment => segment.words ?? []).filter(word => word.origins?.length
      && word.timing !== 'replacement' && word.timing !== 'approximate');
    if (!anchors.length || !anchors.every(word => word.origins!.map(ref => original.segments.find(segment => segment.id === ref.segment)!
      .text.slice(ref.from, ref.to)).join('') === word.text)) continue;
    let group = validOriginalGroupId(source.originalGroupId) ? source.originalGroupId : groups.get(source.id);
    if (!group) {
      if (!globalThis.crypto?.subtle) continue;
      // Immutable original bytes keep legacy identity stable across file/folder renaming.
      let hash: ArrayBuffer;
      try { hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([source.id, raw]))); }
      catch { continue; }
      group = `legacy-${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')}`;
    }
    groups.set(source.id, group); groups.set(model.id, group);
  }
  return groups.size ? { ...manifest, models:manifest.models.map(model => groups.has(model.id) ? { ...model, originalGroupId:groups.get(model.id) } : model) } : manifest;
}
