// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useReadingPosition } from './useReadingPosition';
import { readingKey, readReadingAnchor, saveReadingAnchor, type ReadingAnchor, type ReadingScope } from '../lib/readingPosition';
import { RESTORE_EDIT_POSITION_KEY } from '../lib/editPosition';
import type { Segment } from '../types';
const segments: Segment[] = ['a','b'].map((id,index)=>({id,text:'合成阅读段落',speaker_id:'s',start:index,end:index+1}));
afterEach(()=>{cleanup();localStorage.clear();document.body.replaceChildren();vi.restoreAllMocks();vi.unstubAllGlobals()});
async function fixture(saved?: ReadingAnchor){
 localStorage.setItem(RESTORE_EDIT_POSITION_KEY,'1');
 const frames=new Map<number,FrameRequestCallback>();let n=0;vi.stubGlobal('requestAnimationFrame',(f:FrameRequestCallback)=>{frames.set(++n,f);return n});vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));
 const panel=document.createElement('div');panel.innerHTML='<article class="segment" id="segment-a"><p class="rt-para">合成甲</p></article><article class="segment" id="segment-b"><p class="rt-para">合成乙</p></article>';document.body.append(panel);
 let height=1000;panel.getBoundingClientRect=()=>({top:100,bottom:500,height:400,width:800}as DOMRect);
 for(const [i,row]of [...panel.children].entries()){
  const rect=()=>({top:100+i*height-panel.scrollTop,bottom:100+(i+1)*height-panel.scrollTop,height}as DOMRect);
  row.getBoundingClientRect=rect;row.firstElementChild!.getBoundingClientRect=rect;
 }
 panel.scrollTo=vi.fn((o?:ScrollToOptions|number)=>{panel.scrollTop=typeof o==='number'?o:o?.top??0});
 const scope:ReadingScope={directory:{storeIdentity:'synthetic-folder'}as unknown as FileSystemDirectoryHandle,audio:'synthetic.wav',model:'model',version:'v1',project:'project',recording:'recording'};
 if(saved)saveReadingAnchor(await readingKey(scope),saved);
 const ref={current:panel};const hook=renderHook(({target,items,ready,explicit}:{target:ReadingScope;items:Segment[];ready:boolean;explicit:boolean})=>useReadingPosition(target,ref,ready,items,explicit),{initialProps:{target:scope,items:segments,ready:true,explicit:false}});
 const frame=async()=>{await act(async()=>{await Promise.resolve();for(const cb of [...frames.values()])cb(0);frames.clear()})};
 return{panel,scope,hook,frame,height:(value:number)=>{height=value}};
}
it('remembers pure reading without scroll writes or changing the editing cursor; saves on leave',async()=>{
 const f=await fixture();await f.frame();const key=await readingKey(f.scope),write=vi.spyOn(Storage.prototype,'setItem');
 f.panel.scrollTop=1150;act(()=>f.panel.dispatchEvent(new Event('scroll')));expect(write).not.toHaveBeenCalled();
 f.hook.unmount();expect(readReadingAnchor(key)).toMatchObject({id:'b',index:1,paragraph:0,fraction:.15});
});
it('restores the fraction inside a long paragraph after wrapping changes',async()=>{
 const f=await fixture({id:'b',index:1,paragraph:0,offset:0,fraction:.15});f.height(2000);await f.frame();expect(f.panel.scrollTop).toBe(2300);
});
it('keeps versions separate and does not recapture the replacement document during cleanup',async()=>{
 const f=await fixture();await f.frame();f.panel.scrollTop=1150;act(()=>f.panel.dispatchEvent(new Event('scroll')));
 f.hook.rerender({target:{...f.scope,version:'v2'},items:segments,ready:true,explicit:false});await f.frame();expect(f.panel.scrollTop).toBe(0);
 expect(readReadingAnchor(await readingKey(f.scope))?.id).toBe('b');f.panel.scrollTop=50;act(()=>f.panel.dispatchEvent(new Event('scroll')));f.hook.unmount();
 expect(readReadingAnchor(await readingKey({...f.scope,version:'v2'}))?.id).toBe('a');
});
it('falls back safely after a segment was merged/deleted, and respects disabled restore',async()=>{
 const f=await fixture({id:'removed',index:1,paragraph:20,offset:16,fraction:0});await f.frame();expect(f.panel.scrollTop).toBe(984);
 localStorage.setItem(RESTORE_EDIT_POSITION_KEY,'0');f.hook.rerender({target:{...f.scope,version:'v2'},items:segments,ready:true,explicit:false});await f.frame();expect(f.panel.scrollTop).toBe(0);
});
it('does not replace an explicit deep-link target or destroy the anchor when filters hide all rows',async()=>{
 const f=await fixture(),key=await readingKey(f.scope);f.hook.rerender({target:f.scope,items:segments,ready:true,explicit:true});f.panel.scrollTop=1150;await f.frame();expect(f.panel.scrollTop).toBe(1150);
 act(()=>f.panel.dispatchEvent(new Event('scroll')));f.panel.replaceChildren();act(()=>f.panel.dispatchEvent(new Event('scroll')));act(()=>window.dispatchEvent(new Event('pagehide')));expect(readReadingAnchor(key)?.id).toBe('b');
});
it('normal-close preparation writes the view preference but a cancelled beforeunload keeps the live anchor',async()=>{
 const f=await fixture();await f.frame();f.panel.scrollTop=1150;act(()=>f.panel.dispatchEvent(new Event('scroll')));
 act(()=>f.hook.result.current());expect(readReadingAnchor(await readingKey(f.scope))?.id).toBe('b');
 const cancel=(e:Event)=>e.preventDefault();window.addEventListener('beforeunload',cancel);act(()=>window.dispatchEvent(new Event('beforeunload',{cancelable:true})));window.removeEventListener('beforeunload',cancel);
 f.panel.scrollTop=40;act(()=>f.panel.dispatchEvent(new Event('scroll')));act(()=>f.hook.result.current());expect(readReadingAnchor(await readingKey(f.scope))?.id).toBe('a');
});
