// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TagsPanel } from './TagsPanel';
import type { TagLibrary } from '../lib/tags';

const pointDescriptor=Object.getOwnPropertyDescriptor(document,'elementFromPoint');
beforeEach(()=>{
 vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
 vi.stubGlobal('PointerEvent',class extends MouseEvent{pointerId:number;constructor(type:string,init:PointerEventInit){super(type,init);this.pointerId=init.pointerId??1}});
 HTMLElement.prototype.setPointerCapture=vi.fn();HTMLElement.prototype.releasePointerCapture=vi.fn();
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();if(pointDescriptor)Object.defineProperty(document,'elementFromPoint',pointDescriptor);else delete (document as Partial<Document>).elementFromPoint});
function setup(left=200,width=280,grouped=false){
 const library:TagLibrary={schemaVersion:3,groups:[],tags:[{id:'root',name:'Root',parentId:null,groupIds:[]},{id:'branch',name:'Branch',parentId:'root',groupIds:[]},{id:'leaf',name:'Leaf',parentId:'branch',groupIds:[]},{id:'other',name:'Other',parentId:null,groupIds:[]}]};
 if(grouped){library.groups=[{id:'g1',name:'Target group',parentId:null},{id:'g2',name:'Source group',parentId:null}];library.tags=library.tags.map(tag=>({...tag,groupIds:[tag.id==='other'?'g2':'g1']}))}
 const reparent=vi.fn(async()=>{}),reorder=vi.fn(async()=>{}),place=vi.fn(async()=>{}),targetChanged=vi.fn(),frames=new Map<number,FrameRequestCallback>();let id=0;
 vi.stubGlobal('requestAnimationFrame',(fn:FrameRequestCallback)=>{frames.set(++id,fn);return id});vi.stubGlobal('cancelAnimationFrame',(n:number)=>frames.delete(n));
 const ui=render(<TagsPanel library={library} currentTagIds={library.tags.map(t=>t.id)} onChange={async()=>{}} onReparentTag={reparent} onReorder={reorder} onTagDropTarget={targetChanged} readOnly={false} filter={[]} filterEnabled={false} filterMode="and" onFilterModeChange={()=>{}} onFilterEnabledChange={()=>{}} onFilter={()=>{}} currentCount={()=>0}/>);

 const list=ui.container.querySelector<HTMLElement>('.library-list')!,rows=Object.fromEntries(Array.from(ui.container.querySelectorAll<HTMLElement>('[data-tag-id]')).map(row=>[row.dataset.tagId!,row]));
 list.getBoundingClientRect=()=>({left,right:left+width,top:200,bottom:550,width,height:350}as DOMRect);
 ['root','branch','leaf','other'].forEach((name,i)=>{rows[name].getBoundingClientRect=()=>({left,right:left+width,top:300+i*32-list.scrollTop,bottom:328+i*32-list.scrollTop,width,height:28}as DOMRect)});
 let hit=rows.root;Object.defineProperty(document,'elementFromPoint',{configurable:true,value:vi.fn(()=>hit)});
 const source=rows.other.querySelector('button.library-filter')!;
 const pointer=(type:string,x:number,y:number)=>{const event=new PointerEvent(type,{bubbles:true,cancelable:true,button:0,pointerId:1,metaKey:true,ctrlKey:true,clientX:x,clientY:y});Object.defineProperties(event,{pageX:{value:x+900},pageY:{value:y+1200}});return fireEvent(source,event)};
 const frame=()=>{const[n,fn]=frames.entries().next().value!;frames.delete(n);act(()=>fn(0))};
 const lineRow=()=>ui.container.querySelector('.tag-drop-line')?.parentElement?.querySelector<HTMLElement>('[data-tag-id]')?.dataset.tagId;
 return{...ui,list,rows,library,reparent,reorder,place,targetChanged,pointer,frame,lineRow,hit:(name:string)=>{hit=rows[name]}};
}
const layouts=[{left:200,width:280,grouped:false},{left:480,width:500,grouped:false},];
it.each(layouts)('uses final client coordinates at width $width, grouped=$grouped',async({left,width,grouped})=>{
 const h=setup(left,width,grouped);h.pointer('pointerdown',left+30,408);h.pointer('pointermove',left+4,304);expect(h.lineRow()).toBe('root');
 expect(document.elementFromPoint).toHaveBeenLastCalledWith(left+4,304);
 await act(async()=>{h.pointer('pointerup',left+4,326)});
 if(grouped)expect(h.place).toHaveBeenCalledExactlyOnceWith({tagId:'other',sourceGroupId:'g2',groupId:'g1',parentId:null,anchorId:'root',after:true,copy:false});
 else expect(h.reorder).toHaveBeenCalledExactlyOnceWith('level','other','root',true);
});
it('does not rescan the tree or republish the target over 120 unchanged animation frames',()=>{
 const h=setup();h.pointer('pointerdown',230,408);h.pointer('pointermove',230,304);h.frame();
 const scans=vi.spyOn(Element.prototype,'querySelectorAll'),walk=vi.spyOn(h.library.tags,'filter'),map=vi.spyOn(h.library.tags,'map'),lookups=vi.spyOn(h.library.tags,'find');
 const rowBounds=vi.spyOn(h.rows.root,'getBoundingClientRect'),viewportBounds=vi.spyOn(h.list,'getBoundingClientRect');
 const published=h.targetChanged.mock.calls.length,hitCalls=vi.mocked(document.elementFromPoint).mock.calls.length;
 for(let i=0;i<120;i++)h.frame();
 expect(scans).not.toHaveBeenCalled();expect(walk).not.toHaveBeenCalled();expect(map).not.toHaveBeenCalled();expect(lookups).not.toHaveBeenCalled();
 expect(h.targetChanged).toHaveBeenCalledTimes(published);expect(vi.mocked(document.elementFromPoint).mock.calls.length-hitCalls).toBe(120);
 expect(rowBounds).toHaveBeenCalledTimes(120);expect(viewportBounds).toHaveBeenCalledTimes(120);
});
it.each(layouts)('refreshes scroll hit geometry at width $width, grouped=$grouped',({left,width,grouped})=>{
 const h=setup(left,width,grouped);h.pointer('pointerdown',left+30,408);h.pointer('pointermove',left+30,304);
 // Appending inside Root legitimately previews below the whole visible subtree.
 expect(h.lineRow()).toBe('leaf');expect((h.container.querySelector('.tag-drop-line')as HTMLElement).style.left).toBe('24px');
 h.list.scrollTop=64;h.hit('leaf');h.frame();
 expect(h.lineRow()).toBe('branch');
});
