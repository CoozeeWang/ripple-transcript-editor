// @vitest-environment jsdom
import { act, renderHook, waitFor, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { useProjectTags } from './useProjectTags';
import { emptyTagLibrary, type TagLibrary } from '../lib/tags';
import type { Transcript } from '../types';
vi.mock('../lib/projectTags', () => ({ projectTagCounts: vi.fn(async () => new Map()) }));
afterEach(cleanup);
const source = (): Transcript => ({ audio: { filename: 'synthetic.wav', duration: 2 }, speakers: [], segments: [{ id: 's1', speaker_id: 'a', text: 'Synthetic', start: 0, end: 2 }] });
function setup(fail = false) { const writes = vi.fn(async (library: TagLibrary) => {
        expect(library.schemaVersion).toBe(1); if (fail)
    throw new Error('synthetic failure'); }), error = vi.fn(); const hook = renderHook(({ readOnly = false, context = 'v1' }: {
    readOnly?: boolean;
    context?: string;
}) => { const [library, setLibrary] = useState(emptyTagLibrary), [transcript, setTranscript] = useState(source); return { ...useProjectTags({ library, save: async (next) => { await writes(next); setLibrary(next); }, project: () => null, recordingId: 'r1', modelId: 'm1', context, transcript, mutate: update => setTranscript(update), readOnly, onError: error, errorMessage: 'Synthetic save failed' }), transcript, rewrap:()=>setTranscript(current=>({...current,lastEditedSegmentId:'s1',segments:current.segments.map(segment=>({...segment,words:[]}))})) }; }, { initialProps: { readOnly: false, context: 'v1' } }); return { ...hook, writes, error }; }
describe('project tag integration', () => {
    it('persists definitions before assignment, reuses names and protects version state', async () => { const h = setup(); await act(() => h.result.current.add('s1', 'Topic')); expect(h.writes).toHaveBeenCalledTimes(1); expect(h.result.current.transcript.segments[0].tagIds).toEqual([h.result.current.library.tags[0].id]); await act(() => h.result.current.add('s1', 'topic')); expect(h.writes).toHaveBeenCalledTimes(1); expect(h.result.current.transcript.segments[0].tagIds).toHaveLength(1); h.rerender({ readOnly: true, context: 'v1' }); await act(() => h.result.current.add('s1', 'Locked')); expect(h.result.current.library.tags).toHaveLength(1); act(() => h.result.current.remove('s1', h.result.current.library.tags[0].id)); expect(h.result.current.transcript.segments[0].tagIds).toHaveLength(1); });
    it('does not create a dangling assignment on project write failure', async () => { const h = setup(true); await act(() => h.result.current.add('s1', 'Failed')); expect(h.result.current.library.tags).toEqual([]); expect(h.result.current.transcript.segments[0].tagIds).toBeUndefined(); expect(h.error).toHaveBeenCalled(); expect(h.result.current.busy).toBe(false); });
    it('atomically deletes and undoes a project definition without rewriting manuscript content', async () => { const h = setup(); const next = { ...emptyTagLibrary(), tags: [{ id: 'tag-a', name: 'Topic', groupIds: [] }] }; await act(() => h.result.current.change(next)); const before = h.result.current.transcript; await act(() => h.result.current.change(emptyTagLibrary())); expect(h.result.current.library.tags).toEqual([]); expect(h.result.current.canUndo).toBe(true); await act(() => h.result.current.undo()); expect(h.result.current.library).toEqual(next); expect(h.result.current.transcript).toBe(before); await act(() => h.result.current.redo()); expect(h.result.current.library.tags).toEqual([]); });
    it('rejects read-only library mutations and leaves canonical definitions unchanged', async () => { const h = setup(); h.rerender({ readOnly: true, context: 'original' }); await act(async () => { await expect(h.result.current.change({ ...emptyTagLibrary(), groups: [{ id: 'g1', name: 'Group', parentId: null }] })).rejects.toThrow('tag_write_unavailable'); }); expect(h.writes).not.toHaveBeenCalled(); await waitFor(() => expect(h.result.current.library.groups).toEqual([])); });
});

it('does not rescan a project for text-only edits, but refreshes changed associations',async()=>{
 const {projectTagCounts}=await import('../lib/projectTags');vi.mocked(projectTagCounts).mockClear();
 const project={} as import('../lib/projectStore').OpenProject,value=source(),library=emptyTagLibrary();
 const hook=renderHook(({transcript}:{transcript:Transcript})=>useProjectTags({library,project:()=>project,recordingId:'synthetic-r',modelId:'m1',context:'synthetic-v1',transcript,mutate:()=>{},readOnly:false,onError:()=>{},errorMessage:'Synthetic error'}),{initialProps:{transcript:value}});
 await waitFor(()=>expect(hook.result.current.counts).toBeInstanceOf(Map));expect(projectTagCounts).toHaveBeenCalledTimes(1);
 hook.rerender({transcript:{...value,segments:value.segments.map(segment=>({...segment,text:'Synthetic text edit'}))}});
 expect(hook.result.current.counts).toBeInstanceOf(Map);await new Promise(resolve=>setTimeout(resolve,160));expect(projectTagCounts).toHaveBeenCalledTimes(1);
 hook.rerender({transcript:{...value,segments:value.segments.map(segment=>({...segment,tagIds:['tag-a']}))}});
 await waitFor(()=>expect(projectTagCounts).toHaveBeenCalledTimes(2));
});

it('retains library undo/redo when non-edit metadata and playback words are repackaged',async()=>{const h=setup();await act(()=>h.result.current.change({...emptyTagLibrary(),tags:[{id:'synthetic-tag',name:'Topic',groupIds:[]}]}));expect(h.result.current.canUndo).toBe(true);act(()=>h.result.current.rewrap());expect(h.result.current.canUndo).toBe(true);await act(()=>h.result.current.undo());expect(h.result.current.canRedo).toBe(true);act(()=>h.result.current.rewrap());expect(h.result.current.canRedo).toBe(true);await act(()=>h.result.current.redo());expect(h.result.current.library.tags[0].name).toBe('Topic')});
