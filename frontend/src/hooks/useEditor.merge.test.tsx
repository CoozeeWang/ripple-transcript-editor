// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useEditor, type UseEditorDeps } from './useEditor';
import type { Transcript } from '../types';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function fixture(same = false) {
  const transcript: Transcript = { audio: {filename:'synthetic.wav',duration:10}, speakers: [], segments: [
    {id:'a',speaker_id:'one',start:0,end:5,text:'Synthetic first'},
    {id:'b',speaker_id:same?'one':'two',start:5,end:10,text:'Synthetic second'},
  ] };
  let saved = transcript;
  const mutate = vi.fn((updater: (value: Transcript) => Transcript) => { saved = updater(saved); });
  const noop = vi.fn();
  const deps: UseEditorDeps = { transcript, mutateTranscript:mutate, metadata:null,setMetadata:noop,
    setSelectedSegmentId:noop,setActiveSegmentId:noop,setHiddenSpeakerIds:noop,textareaRefs:{current:new Map()},
    editingRef:{current:false},findOpen:false,showReplace:false,setShowReplace:noop,replaceCurrent:noop,findNext:noop };
  const hook = renderHook((props:UseEditorDeps) => useEditor(props),{initialProps:deps});
  return {hook,deps,mutate,read:()=>saved,setSaved:(value:Transcript)=>{saved=value;}};
}
it('waits for explicit confirmation even when native window.confirm returns a truthy Promise',()=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(Promise.resolve(false) as unknown as boolean);
  const {hook,mutate,read}=fixture();
  act(()=>hook.result.current.mergeWithNext('a'));
  expect(hook.result.current.segmentMergePrompt).not.toBeNull();expect(mutate).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled();expect(read().segments).toHaveLength(2);
  act(()=>hook.result.current.confirmSegmentMerge());
  expect(read().segments).toHaveLength(1);expect(read().segments[0].speaker_id).toBe('one');
});
it('cancels without changing the manuscript; same speakers merge immediately and last segment does nothing',()=>{
  const {hook,mutate}=fixture();act(()=>hook.result.current.mergeWithNext('a'));
  act(()=>hook.result.current.setSegmentMergePrompt(null));expect(mutate).not.toHaveBeenCalled();hook.unmount();
  const same=fixture(true);act(()=>same.hook.result.current.mergeWithNext('b'));expect(same.mutate).not.toHaveBeenCalled();
  act(()=>same.hook.result.current.mergeWithNext('a'));expect(same.read().segments).toHaveLength(1);
  expect(same.hook.result.current.segmentMergePrompt).toBeNull();
});
it.each(['text','speaker','order','document'])('rejects a changed %s after opening confirmation',kind=>{
  const {hook,deps,mutate,setSaved}=fixture();act(()=>hook.result.current.mergeWithNext('a'));
  const current=deps.transcript!;
  const changed={...current, audio:kind==='document'?{...current.audio}:current.audio, segments:kind==='order'?[...current.segments].reverse():current.segments.map((s,i)=>i===1&&kind==='text'?{...s,text:'Changed'}:i===1&&kind==='speaker'?{...s,speaker_id:'three'}:s)};
  setSaved(changed);hook.rerender({...deps,transcript:changed});expect(hook.result.current.segmentMergeChanged).toBe(true);
  act(()=>hook.result.current.confirmSegmentMerge());expect(mutate).not.toHaveBeenCalled();
});
it('rechecks the exact pair inside the mutation and preserves unrelated changes',()=>{
  const {hook,deps,read,setSaved}=fixture();act(()=>hook.result.current.mergeWithNext('a'));
  setSaved({...deps.transcript!,segments:[...deps.transcript!.segments,{id:'c',speaker_id:'one',start:10,end:15,text:'Unrelated'}]});
  act(()=>hook.result.current.confirmSegmentMerge());expect(read().segments.map(s=>s.id)).toEqual(['a','c']);
});
it('keeps newly committed blur text for an immediate same-speaker merge',()=>{
  const {hook,deps,read,setSaved}=fixture(true);
  setSaved({...deps.transcript!,segments:deps.transcript!.segments.map((s,i)=>i===0?{...s,text:'Latest synthetic draft'}:s)});
  act(()=>hook.result.current.mergeWithNext('a'));expect(read().segments).toHaveLength(1);
  expect(read().segments[0].text).toContain('Latest synthetic draft');
});
it('never bypasses confirmation if the latest same-speaker pair changed speakers before mutation',()=>{
  const {hook,deps,read,setSaved}=fixture(true);
  setSaved({...deps.transcript!,segments:deps.transcript!.segments.map((s,i)=>i===1?{...s,speaker_id:'three'}:s)});
  act(()=>hook.result.current.mergeWithNext('a'));expect(read().segments).toHaveLength(2);
});
