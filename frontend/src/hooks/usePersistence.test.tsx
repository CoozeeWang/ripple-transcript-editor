// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { InterviewMetadata, Transcript } from '../types';
import { usePersistence, type UsePersistenceDeps } from './usePersistence';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('flushes audio details and speakers before leaving even when no transcript version exists', async () => {
  const saveAudioDraft = vi.fn(async () => {});
  const base: InterviewMetadata = { id: 'audio-a', title: '音频 A', recorded_at: null,
    location: '', participants: [], topics: [], notes: '', created_at: '', updated_at: '' };
  const transcript: Transcript = { audio: { filename: 'synthetic.wav', duration: 0 }, speakers: [], segments: [] };
  const deps: UsePersistenceDeps = { dirHandleRef: { current: {} as FileSystemDirectoryHandle },
    initialLoadRef: { current: false }, hasLoadedTranscript: false, viewingOriginal: false,
    selectedAudio: 'synthetic.wav', transcript, metadata: base, activeModelId: null, models: [],
    saveStatus: 'saved', setSaveStatus: vi.fn(), setShuttingDown: vi.fn(), saveAudioDraft };
  const { result, rerender } = renderHook((value: UsePersistenceDeps) => usePersistence(value), { initialProps: deps });
  const changed = { ...base, recorded_at: '2026-09-20T10:30:00', location: '合成地点' };
  const speakers = [{ id: 'speaker-a', name: '合成说话人' }];
  rerender({ ...deps, metadata: changed, transcript: { ...transcript, speakers } });
  await act(async () => { await result.current.flushPendingSave(); });
  expect(saveAudioDraft).toHaveBeenLastCalledWith({ metadata: changed, speakers });
  expect(result.current.handleSave).toBeDefined();
});

it('reports a failed audio draft save so navigation can keep the editor open', async () => {
  const failure = new Error('合成写入失败');
  const setSaveStatus = vi.fn();
  const metadata: InterviewMetadata = { id: 'audio-a', title: '音频 A', recorded_at: null,
    location: '合成地点', participants: [], topics: [], notes: '', created_at: '', updated_at: '' };
  const { result } = renderHook(() => usePersistence({
    dirHandleRef: { current: {} as FileSystemDirectoryHandle }, initialLoadRef: { current: false },
    hasLoadedTranscript: false, viewingOriginal: false, selectedAudio: 'synthetic.wav',
    transcript: { audio: { filename: 'synthetic.wav', duration: 0 }, speakers: [], segments: [] },
    metadata, activeModelId: null, models: [], saveStatus: 'unsaved', setSaveStatus,
    setShuttingDown: vi.fn(), saveAudioDraft: vi.fn().mockRejectedValue(failure),
  }));
  await expect(result.current.flushPendingSave()).rejects.toThrow('合成写入失败');
  expect(setSaveStatus).toHaveBeenCalledWith('error');
});

import { saveActiveEdit, saveInterviewDetails } from '../localStore';
import { registerEditorDraft } from '../lib/editorDrafts';
vi.mock('../localStore', () => ({ saveActiveEdit: vi.fn(async () => {}), saveInterviewDetails: vi.fn(async () => {}) }));
function loadedDeps(): UsePersistenceDeps {
  const metadata: InterviewMetadata = { id: 'synthetic', title: 'Synthetic', recorded_at: null,
    location: '', participants: [], topics: [], notes: '', created_at: '', updated_at: '' };
  const transcript: Transcript = { audio: { filename: 'synthetic.wav', duration: 4 }, speakers: [],
    segments: [{ id: 's1', speaker_id: 'speaker', start: 0, end: 4, text: 'Synthetic original' }] };
  return { dirHandleRef: { current: {} as FileSystemDirectoryHandle }, initialLoadRef: { current: false },
    hasLoadedTranscript: true, viewingOriginal: false, selectedAudio: 'synthetic.wav', transcript, metadata,
    persistedContent: { transcript, metadata }, activeModelId: 'm1',
    models: [{ id: 'm1', engine: 'synthetic', original: 'original.json', edits: [{ id: 'e1', file: 'edit.json', updated_at: '' }], activeEditId: 'e1' }],
    saveStatus: 'saved', setSaveStatus: vi.fn(), setShuttingDown: vi.fn() };
}
function changed(deps: UsePersistenceDeps): Transcript {
  return { ...deps.transcript!, segments: [{ ...deps.transcript!.segments[0], text: 'Synthetic revised' }] };
}
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });
it('skips autosave, navigation writes and manual rewrites of explicitly loaded unchanged content', async () => {
  vi.useFakeTimers(); const deps = loadedDeps();
  const { result, rerender } = renderHook(usePersistence, { initialProps: deps });
  rerender({ ...deps, models: [...deps.models] });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); await result.current.flushPendingSave(); await result.current.handleSave(); });
  expect(saveActiveEdit).not.toHaveBeenCalled(); expect(deps.setSaveStatus).not.toHaveBeenCalledWith('saving');
});
it('recognizes a load finishing after render without requiring another render', async () => {
  const deps = loadedDeps(); deps.initialLoadRef.current = true;
  const { result } = renderHook(usePersistence, { initialProps: deps }); deps.initialLoadRef.current = false;
  await act(async () => { await result.current.flushPendingSave(); }); expect(saveActiveEdit).not.toHaveBeenCalled();
});
it('saves an edit made before asynchronous load completion', async () => {
  const deps = loadedDeps(); deps.initialLoadRef.current = true;
  const { result, rerender } = renderHook(usePersistence, { initialProps: deps }); const transcript = changed(deps);
  rerender({ ...deps, transcript }); deps.initialLoadRef.current = false;
  await act(async () => { await result.current.flushPendingSave(); });
  expect(saveActiveEdit).toHaveBeenCalledWith(deps.dirHandleRef.current, 'synthetic.wav', 'm1', 'e1', expect.objectContaining({ transcript }));
});
it('saves changes even when shared status still says saved, then skips repeat writes', async () => {
  const deps = loadedDeps(); const { result, rerender } = renderHook(usePersistence, { initialProps: deps }); const transcript = changed(deps);
  rerender({ ...deps, transcript });
  await act(async () => { await result.current.flushPendingSave(); await result.current.flushPendingSave(); });
  expect(saveActiveEdit).toHaveBeenCalledTimes(1);
  expect(saveActiveEdit).toHaveBeenLastCalledWith(deps.dirHandleRef.current, 'synthetic.wav', 'm1', 'e1', expect.objectContaining({ transcript }));
});
it('writes an undo back to loaded content when a newer edit already reached disk', async () => {
  const deps = loadedDeps(); const { result, rerender } = renderHook(usePersistence, { initialProps: deps });
  rerender({ ...deps, transcript: changed(deps) }); await act(async () => { await result.current.flushPendingSave(); });
  rerender(deps); await act(async () => { await result.current.flushPendingSave(); });
  expect(saveActiveEdit).toHaveBeenCalledTimes(2);
  expect(saveActiveEdit).toHaveBeenLastCalledWith(deps.dirHandleRef.current, 'synthetic.wav', 'm1', 'e1', expect.objectContaining({ transcript: deps.transcript }));
});
it('adopts loaded versions but never carries a clean baseline across save targets', async () => {
  const deps = loadedDeps(); const { result, rerender } = renderHook(usePersistence, { initialProps: deps });
  const next = loadedDeps(); next.dirHandleRef = deps.dirHandleRef; next.models = [{ ...next.models[0], activeEditId: 'e2' }];
  rerender(next); await act(async () => { await result.current.flushPendingSave(); }); expect(saveActiveEdit).not.toHaveBeenCalled();
  rerender({ ...next, models: [{ ...next.models[0], activeEditId: 'e3' }] });
  await act(async () => { await result.current.flushPendingSave(); });
  expect(saveActiveEdit).toHaveBeenCalledWith(deps.dirHandleRef.current, 'synthetic.wav', 'm1', 'e3', expect.anything());
});
it('keeps originals read-only while saving changed interview details', async () => {
  const deps = { ...loadedDeps(), viewingOriginal: true }; const { result, rerender } = renderHook(usePersistence, { initialProps: deps });
  await act(async () => { await result.current.flushPendingSave(); }); expect(saveInterviewDetails).not.toHaveBeenCalled();
  const metadata = { ...deps.metadata!, notes: 'Synthetic changed details' }; rerender({ ...deps, metadata });
  await act(async () => { await result.current.flushPendingSave(); });
  expect(saveInterviewDetails).toHaveBeenCalledWith(deps.dirHandleRef.current, 'synthetic.wav', metadata); expect(saveActiveEdit).not.toHaveBeenCalled();
});
it('flushes editor drafts before checking unchanged content', async () => {
  const deps = loadedDeps(); const transcript = changed(deps); const { result, rerender } = renderHook(usePersistence, { initialProps: deps });
  let dirty = true; const unregister = registerEditorDraft(() => dirty);
  const flush = () => { dirty = false; rerender({ ...deps, transcript }); }; window.addEventListener('te:flush-drafts', flush);
  try {
    await act(async () => { await result.current.flushPendingSave(); });
    expect(saveActiveEdit).toHaveBeenLastCalledWith(deps.dirHandleRef.current, 'synthetic.wav', 'm1', 'e1', expect.objectContaining({ transcript }));
  } finally { unregister(); window.removeEventListener('te:flush-drafts', flush); }
});
it('waits for changes made during a write before allowing navigation', async () => {
  const deps = loadedDeps(); let finish!: () => void;
  vi.mocked(saveActiveEdit).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const { result, rerender } = renderHook(usePersistence, { initialProps: deps }); rerender({ ...deps, transcript: changed(deps) });
  let flush!: Promise<void>; await act(async () => { flush = result.current.flushPendingSave(); await Promise.resolve(); });
  const metadata = { ...deps.metadata!, notes: 'Synthetic change during save' }; rerender({ ...deps, transcript: changed(deps), metadata });
  await act(async () => { finish(); await flush; }); expect(saveActiveEdit).toHaveBeenCalledTimes(2);
  expect(saveActiveEdit).toHaveBeenLastCalledWith(deps.dirHandleRef.current, 'synthetic.wav', 'm1', 'e1', expect.objectContaining({ metadata }));
});
it('blocks navigation after save failure, keeps dirty content and retries the same data', async () => {
  const deps = loadedDeps(); const transcript = changed(deps); vi.mocked(saveActiveEdit).mockRejectedValueOnce(new Error('Synthetic disk full'));
  const { result, rerender } = renderHook(usePersistence, { initialProps: deps }); rerender({ ...deps, transcript });
  await act(async () => { await expect(result.current.flushPendingSave()).rejects.toThrow('Synthetic disk full'); });
  expect(deps.setSaveStatus).toHaveBeenLastCalledWith('error');
  const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
  await act(async () => { await result.current.flushPendingSave(); }); expect(saveActiveEdit).toHaveBeenCalledTimes(2);
  expect(saveActiveEdit).toHaveBeenLastCalledWith(deps.dirHandleRef.current, 'synthetic.wav', 'm1', 'e1', expect.objectContaining({ transcript }));
  expect(deps.setSaveStatus).toHaveBeenLastCalledWith('saved');
});
