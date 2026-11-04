// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {useState} from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {TagsPanel} from './TagsPanel';
import {dragProjectTree,sortProjectTree} from '../lib/projectTreeOrder';
import type {TagLibrary} from '../lib/tags';
const initial:TagLibrary={schemaVersion:4,groups:[],treeOrder:['root','Zeta','Alpha'],tags:[{id:'root',name:'Root',parentId:null,groupIds:[]},...['Zeta','Alpha'].map(name=>({id:name,name,parentId:'root',groupIds:[]}))]};
beforeEach(()=>{vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});vi.stubGlobal('requestAnimationFrame',vi.fn(()=>1));vi.stubGlobal('cancelAnimationFrame',vi.fn());vi.stubGlobal('PointerEvent',class extends MouseEvent{pointerId=1;});HTMLElement.prototype.setPointerCapture=()=>{};HTMLElement.prototype.releasePointerCapture=()=>{};});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks()});
function mount(fail=false){const sorted=vi.fn(),reordered=vi.fn();function Harness(){const[library,setLibrary]=useState(initial);return <TagsPanel library={library} currentTagIds={['Alpha','Zeta']} readOnly={false} filter={[]} filterEnabled={false} filterMode="and" onFilterModeChange={()=>{}} onFilterEnabledChange={()=>{}} onFilter={()=>{}} currentCount={()=>1} onChange={async()=>{}} onSortName={async()=>{sorted();if(fail)throw Error('Synthetic failure');setLibrary(sortProjectTree(library))}} onReorder={async(_view,id,anchor,after)=>{reordered(id,anchor,after);if(fail)throw Error('Synthetic failure');setLibrary(dragProjectTree(library,id,anchor,after))}}/>};return{...render(<Harness/>),sorted,reordered}}
const names=()=>[...document.querySelectorAll<HTMLElement>('[data-tag-id]')].map(row=>row.dataset.tagId);
it('uses one project order in both current and project scopes; name sort replaces it',async()=>{
 const h=mount();expect(names()).toEqual(['root','Zeta','Alpha']);await act(async()=>fireEvent.click(screen.getByRole('button',{name:'按名称排序'})));expect(names()).toEqual(['root','Alpha','Zeta']);fireEvent.click(screen.getByRole('button',{name:'项目'}));expect(names()).toEqual(['root','Alpha','Zeta']);await act(async()=>fireEvent.keyDown(screen.getByRole('button',{name:'标签: Zeta'}),{key:'ArrowUp',altKey:true}));expect(h.reordered).toHaveBeenCalledExactlyOnceWith('Zeta','Alpha',false);expect(names()).toEqual(['root','Zeta','Alpha']);fireEvent.click(screen.getByRole('button',{name:'当前稿'}));expect(names()).toEqual(['root','Zeta','Alpha']);
});
it('keeps one ghost, commits the final pointer position once, and removes it at completion',async()=>{
 const h=mount(),source=screen.getByRole('button',{name:'标签: Alpha'}),target=source.closest('.library-tag-row')!.parentElement!.previousElementSibling!.querySelector('.library-tag-row')!;
 vi.spyOn(target,'getBoundingClientRect').mockReturnValue({left:0,top:100,bottom:128,height:28}as DOMRect);document.elementFromPoint=()=>target;
 const pointer=(type:string,y:number)=>fireEvent(source,new PointerEvent(type,{bubbles:true,cancelable:true,metaKey:true,ctrlKey:true,button:0,clientX:24,clientY:y}));
 pointer('pointerdown',160);pointer('pointermove',102);const ghost=document.querySelector('.tag-drag-ghost');expect(ghost).toBeTruthy();pointer('pointermove',103);expect(document.querySelectorAll('.tag-drag-ghost')).toHaveLength(1);expect(document.querySelector('.tag-drag-ghost')).toBe(ghost);await act(async()=>pointer('pointerup',103));expect(h.reordered).toHaveBeenCalledOnce();expect(names()).toEqual(['root','Alpha','Zeta']);expect(document.querySelector('.tag-drag-ghost')).toBeNull();
});
it('retains persisted order on failure instead of publishing speculative geometry',async()=>{
 const h=mount(true);await act(async()=>fireEvent.click(screen.getByRole('button',{name:'按名称排序'})));expect(h.sorted).toHaveBeenCalledOnce();expect(screen.getByRole('alert')).toBeTruthy();expect(names()).toEqual(['root','Zeta','Alpha']);
});
