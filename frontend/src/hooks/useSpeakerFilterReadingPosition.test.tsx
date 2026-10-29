// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Segment } from '../types';
import { useSpeakerFilterReadingPosition } from './useSpeakerFilterReadingPosition';

afterEach(()=>{cleanup();document.body.replaceChildren();});
function fixture() {
  const segments: Segment[] = Array.from({length:300},(_,i)=>({id:String(i+1),speaker_id:i%2?'b':'a',start:i,end:i+1,text:'Synthetic'}));
  const panel=document.createElement('div');document.body.append(panel);
  let shown=segments;panel.scrollTop=19700;
  panel.getBoundingClientRect=()=>({top:0,bottom:500,height:500} as DOMRect);
  panel.scrollTo=vi.fn((options?:ScrollToOptions|number,y?:number)=>{panel.scrollTop=typeof options==='number'?y??0:options?.top??0;});
  const paint=()=>{panel.replaceChildren(...shown.map(s=>{
    const row=document.createElement('article');row.className='segment';row.id=`segment-${s.id}`;
    row.innerHTML='<p class="rt-para">Synthetic</p>';
    const rect=()=>{const top=shown.indexOf(s)*100-panel.scrollTop;return {top,bottom:top+100,height:100} as DOMRect;};
    row.getBoundingClientRect=rect;(row.firstChild as HTMLElement).getBoundingClientRect=rect;return row;
  }));};paint();
  const ref={current:panel}, initial={hidden:new Set<string>(),context:'one'};
  const hook=renderHook(p=>useSpeakerFilterReadingPosition(ref,p.hidden,p.context),{initialProps:initial});
  const toggle=(nextHidden:Set<string>,context='one')=>{
    act(()=>hook.result.current(segments,nextHidden));shown=segments.filter(s=>!nextHidden.has(s.speaker_id));paint();
    hook.rerender({hidden:nextHidden,context});
  };
  const top=(id:string)=>panel.querySelector<HTMLElement>(`#segment-${id}`)?.getBoundingClientRect().top;
  return {panel,hook,toggle,top};
}
it('keeps segment 200 at the same pixel through hiding and restoring another speaker',()=>{
  const {toggle,top,panel}=fixture();const before=top('200');expect(before).toBe(200);
  toggle(new Set(['a']));expect(top('200')).toBe(before);expect(panel.scrollTop).toBe(9700);
  toggle(new Set());expect(top('200')).toBe(before);expect(panel.scrollTop).toBe(19700);
});
it('uses the nearest surviving neighbour if the reading segment itself is hidden',()=>{
  const {toggle,top}=fixture();toggle(new Set(['b']));expect(top('199')).toBe(100);
});
it('recovers the last reading position after all speakers were hidden',()=>{
  const {toggle,top}=fixture();const before=top('200');toggle(new Set(['a','b']));toggle(new Set());expect(top('200')).toBe(before);
});
it('does not restore an anchor into a different manuscript',()=>{
  const {toggle,panel}=fixture();toggle(new Set(['a']),'two');expect(panel.scrollTo).not.toHaveBeenCalled();
});
it('restores near the old reading position when speakers are shown one at a time after hiding all',()=>{
  const {toggle,top}=fixture();toggle(new Set(['a','b']));toggle(new Set(['b']));
  expect(top('199')).toBe(200);toggle(new Set());expect(top('199')).toBe(200);
});
