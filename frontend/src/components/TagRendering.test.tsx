// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useMemo, useState } from 'react';
import { SegmentItem } from './SegmentItem';
import { createTagPresenter } from '../lib/tagPresentation';
import { TagCandidatesContext, TagWritingContext } from '../lib/tagCandidates';
import { setSegmentTag, type TagLibrary } from '../lib/tags';
import { useStableCallbacks } from '../hooks/useStableCallbacks';
import type { Transcript } from '../types';
const renders = vi.hoisted(() => new Map<string, number>());
vi.mock('./SegmentTextArea', () => ({ SegmentTextArea: ({ segmentId, value }: { segmentId: string; value: string }) => {
 renders.set(segmentId, (renders.get(segmentId) ?? 0) + 1); return <div>{value}</div>;
} }));
afterEach(() => { cleanup(); renders.clear(); vi.unstubAllGlobals(); });
it('does not refresh unrelated cards on tag assignment or sidebar-only parent updates; open suggestions remain live', () => {
 vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
 const noop = () => {}, initial: TagLibrary = { schemaVersion: 3, groups: [], tags: [{ id: 'topic', name: '合成标签', parentId: null, groupIds: [] }] };
 const transcript: Transcript = { audio: { filename: 'synthetic.wav', duration: 3 }, speakers: [{id:'speaker',name:'合成'}], segments: Array.from({length:3},(_,i)=>({id:'s'+i,text:'合成'+i,speaker_id:'speaker',start:i,end:i+1})) };
 const shared = { speakers: transcript.speakers, isPlaying: false, currentTime: 0, findQuery: '', audioUrl: '', viewingOriginal: false,
  audioRef: {current:null}, textareaRefs: {current:new Map()}, editingRef:{current:false}, effectiveSelectedSegmentId:'', totalSegments:3 };
 function Harness() {
  const [value,setValue]=useState(transcript), [library,setLibrary]=useState(initial), [noise,setNoise]=useState(0), [busy,setBusy]=useState(false);
  const present=useMemo(()=>createTagPresenter(),[]), view=present(library,value.segments);
  const callbacks=useStableCallbacks({setSelectedSegmentId:noop,seekTo:noop,recordEditorCursor:noop,addSpeaker:noop,updateSegment:noop,removeSegment:noop,splitSegment:noop,mergeWithNext:noop,handleEditorKeydown:noop,
   onAddTag:async()=>{},onAddTagId:async()=>{},onRemoveTag:noop,copySegment:()=>{void noise}});
  return <><button onClick={()=>setNoise(n=>n+1)}>Unrelated</button><button onClick={()=>setValue(t=>setSegmentTag(t,'s0','topic',true))}>Attach</button>
   <button onClick={()=>setLibrary(l=>({...l,tags:[...l.tags,{id:'new',name:'新候选',parentId:null,groupIds:[]}]}))}>Catalog</button><button onClick={()=>setBusy(b=>!b)}>Busy</button>
   <TagWritingContext.Provider value={busy}><TagCandidatesContext.Provider value={view.available}>{value.segments.map((segment,index)=><SegmentItem {...shared} {...callbacks} key={segment.id} index={index} segment={segment} tags={view.segments.get(segment.id)!.tags} tagPaths={view.segments.get(segment.id)!.paths}/>)}</TagCandidatesContext.Provider></TagWritingContext.Provider></>;
 }
 const ui=render(<Harness/>);expect([...renders.values()]).toEqual([1,1,1]);
 fireEvent.click(screen.getByText('Unrelated'));expect([...renders.values()]).toEqual([1,1,1]);
 fireEvent.click(screen.getByText('Attach'));expect([...renders.values()]).toEqual([2,1,1]);
 fireEvent.click(screen.getByText('Busy'));expect([...renders.values()]).toEqual([2,1,1]);
 expect([...ui.container.querySelectorAll<HTMLButtonElement>('[data-add-tag],.tag-pill-remove')].every(button=>button.disabled)).toBe(true);
 fireEvent.click(screen.getByText('Busy'));expect([...renders.values()]).toEqual([2,1,1]);
 fireEvent.click(ui.container.querySelector<HTMLButtonElement>('#segment-s1 [data-add-tag]')!);
 expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(1);
 fireEvent.click(screen.getByText('Catalog'));expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(2);expect(renders.get('s0')).toBe(2);expect(renders.get('s2')).toBe(1);
});
