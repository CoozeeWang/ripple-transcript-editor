// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { defaultMetadata } from '../localStore';
import type { Transcript, TranscriptManifest } from '../types';
import { useTranscriptHistory } from '../useTranscriptHistory';
import { type OpenProject, type RippleProject } from '../lib/projectStore';
import { restoreProjectTagTransaction, transactProjectTags } from '../lib/projectTagRepository';
import { tagTestFs } from '../lib/tagTestFs';
import { removeTagBranch, type TagLibrary } from '../lib/tags';
import { useProjectTags, type TagStorage } from './useProjectTags';

afterEach(cleanup);
function setup() {
 let failCommit = false;
 const fs = tagTestFs('synthetic-delete.ripple', path => {
  if (failCommit && path === 'ripple-project.json') { failCommit = false; throw Error('synthetic disk failure'); }
 }), folder = 'interviews/session/sample.transcript';
 for (const path of ['interviews', 'interviews/session', folder]) fs.directories.add(path);
 const library: TagLibrary = { schemaVersion: 3, groups: [], tags: [
  { id: 'root', name: 'Synthetic root', parentId: null, groupIds: [] },
  { id: 'leaf', name: 'Unused leaf', parentId: 'root', groupIds: [] },
  { id: 'keep', name: 'Keep', parentId: null, groupIds: [] },
 ] };
 const transcript: Transcript = { audio: { filename: 'sample.wav', duration: 1 }, speakers: [],
  segments: [{ id: 's', text: 'Synthetic manuscript', speaker_id: 'speaker', start: 0, end: 1 }],
  tagCollection: { schemaVersion: 1, tagIds: ['root', 'leaf', 'keep'], levelOrder: ['root', 'leaf', 'keep'], ungroupedOrder: ['root'],
   groups: [{ id: 'g', name: 'Synthetic group', tagIds: ['leaf', 'keep'], order: ['root', 'leaf', 'keep'] }] } };
 const data: RippleProject = { kind: 'ripple-project', schemaVersion: 1, id: 'synthetic-project', title: 'Synthetic', description: '', revision: 0, tagLibrary: library,
  interviews: [{ id: 'session', title: 'Synthetic session', recordings: [{ id: 'r', name: 'Synthetic recording', file: 'sample.wav', storage: 'none', fingerprint: '' }] }] };
 const manifest: TranscriptManifest = { schemaVersion: 2, audio: 'sample.wav', activeModelId: 'm', models: [{ id: 'm', engine: 'imported', activeEditId: 'e1', original: 'original.json',
  edits: [{ id: 'e1', file: 'e1.json', updated_at: '2026-01-01' }, { id: 'e2', file: 'e2.json', updated_at: '2026-01-01' }] }] };
 fs.files.set('ripple-project.json', JSON.stringify(data)); fs.files.set(folder + '/manifest.json', JSON.stringify(manifest));
 for (const name of ['e1.json', 'e2.json', 'original.json']) fs.files.set(folder + '/' + name, JSON.stringify({ kind: 'te-edited', metadata: defaultMetadata('Synthetic'), transcript }));
 const errors = vi.fn(), hook = renderHook(() => {
  const [project, setProject] = useState<OpenProject>({ directory: fs.root, data }), history = useTranscriptHistory<Transcript>();
  const value = history.transcript ?? transcript;
  const storage: TagStorage = {
   transact: async (current, operation, scope) => { const result = await transactProjectTags(project, current, operation, scope); setProject(result.project); return result; },
   restore: async (receipt, redo) => { const next = await restoreProjectTagTransaction(project, receipt, redo); setProject(next); return next; },
  };
  const tags = useProjectTags({ library: project.data.tagLibrary, storage, recordingId: 'r', modelId: 'm', editId: 'e1', context: 'synthetic', transcript: value,
   flush: async () => {}, lock: () => {}, readOnly: false, onError: errors, errorMessage: 'Synthetic failure', undoActionKey: history.undoActionKey, redoActionKey: history.redoActionKey,
   publish: (next, action, key) => { if (action === 'undo') history.undo(); else if (action === 'redo') history.redo(); else { if (!history.transcript) history.reset(value); history.commit(() => next, key); } } });
  return { ...tags, transcript: value };
 });
 return { ...hook, fs, folder, errors, failNextCommit: () => { failCommit = true; } };
}
it('deletes a zero-association leaf and its saved group order across every version with one undo and redo', async () => {
 const h = setup(), before = new Map(h.fs.files);
 await act(() => h.result.current.change(removeTagBranch(h.result.current.library, 'leaf')));
 expect(h.result.current.library.tags.map(t => t.id)).toEqual(['root', 'keep']);
 for (const file of ['e1.json', 'e2.json', 'original.json']) {
  const saved = JSON.parse(h.fs.files.get(h.folder + '/' + file)!).transcript as Transcript;
  expect(saved.tagCollection?.groups[0]).toEqual({ id: 'g', name: 'Synthetic group', tagIds: ['keep'], order: ['keep'] });
  expect(saved.tagCollection?.levelOrder).toEqual(['root', 'keep']); expect(saved.tagCollection?.ungroupedOrder).toEqual(['root']);
  expect(saved.segments).toEqual(h.result.current.transcript.segments);
 }
 expect(h.fs.files.has('.ripple-tag-transaction.json')).toBe(false); expect(h.errors).not.toHaveBeenCalled();
 await act(() => h.result.current.undo());
 for (const file of ['e1.json', 'e2.json', 'original.json']) expect(JSON.parse(h.fs.files.get(h.folder + '/' + file)!)).toEqual(JSON.parse(before.get(h.folder + '/' + file)!));
 expect(h.result.current.library.tags.map(t => t.id)).toEqual(['root', 'leaf', 'keep']);
 await act(() => h.result.current.redo()); expect(h.result.current.collection.groups[0].order).toEqual(['keep']);
});
it('rolls back every version and publishes no deletion when the shared index write fails', async () => {
 const h = setup(), before = new Map(h.fs.files), snapshot = h.result.current.transcript;
 h.failNextCommit();
 await act(async () => { await expect(h.result.current.change(removeTagBranch(h.result.current.library, 'leaf'))).rejects.toThrow('synthetic disk failure'); });
 expect(h.fs.files).toEqual(before); expect(h.result.current.transcript).toBe(snapshot); expect(h.result.current.library.tags).toHaveLength(3);
 expect(h.result.current.canUndo).toBe(false); expect(h.result.current.busy).toBe(false);
});
