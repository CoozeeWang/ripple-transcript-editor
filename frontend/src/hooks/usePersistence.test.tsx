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
