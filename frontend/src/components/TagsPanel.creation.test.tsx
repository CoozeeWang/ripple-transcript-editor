// @vitest-environment jsdom
import {useState} from 'react';
import {flushSync} from 'react-dom';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {TagsPanel} from './TagsPanel';
import {setTagPath,type TagLibrary} from '../lib/tags';
const seed:TagLibrary={schemaVersion:4,treeOrder:['root','branch','used'],tags:[{id:'root',name:'Root',parentId:null,groupIds:[]},{id:'branch',name:'Branch',parentId:'root',groupIds:[]},{id:'used',name:'Used',parentId:null,groupIds:[]}],groups:[]};
beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}})});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals()});
function fixture({fail=false,pending=false,lateCatalog=false,filter=false}={}){
 let finish!:()=>void, publish!:()=>void;const create=vi.fn(),filtered=vi.fn(),count=vi.fn(()=>1);
 function Harness({version}:{version:string}){const[library,setLibrary]=useState(seed);return <TagsPanel library={library} collection={{schemaVersion:1,tagIds:['used'],groups:[]}} versionKey={version} currentTagIds={['used']} currentCount={count} filter={filter?['used']:[]} filterEnabled={filter} filterMode="and" onFilter={filtered} onFilterModeChange={()=>{}} onFilterEnabledChange={()=>{}} readOnly={false} onChange={async()=>{}} onCreateTag={async(name,id)=>{
 create(name,id);if(pending)await new Promise<void>(r=>{finish=r});if(fail)throw Error('Synthetic save failure');const result=id?{library,tag:library.tags.find(t=>t.id===id)!}:setTagPath(library,name);publish=()=>setLibrary(result.library);if(!lateCatalog)publish();return result.tag.id;
 }}/>}
 const view=render(<Harness version="v1"/>);return{...view,create,filtered,finish:async()=>act(async()=>finish()),publish:()=>act(()=>publish()),switchVersion:(version="v2")=>view.rerender(<Harness version={version}/>)};
}
function enter(name:string){const button=screen.getByRole('button',{name:'新建标签'});if(button.getAttribute('aria-pressed')!=='true')flushSync(()=>fireEvent.click(button));const input=screen.getByRole('combobox',{name:'新建标签'});fireEvent.change(input,{target:{value:name}});fireEvent.keyDown(input,{key:'Enter'});return input}
const project=()=>screen.getByRole('button',{name:'项目'}).getAttribute('aria-pressed');
it('reveals saved IDs in project scope, keeps zero-use tags out of current scope and preserves creation focus for successive creates',async()=>{
 const h=fixture();let input!:HTMLElement;await act(async()=>{input=enter('Root/Branch/New one')});expect(project()).toBe('true');expect(document.activeElement).toBe(input);const one=h.container.querySelector('[data-created-location="true"]')!;expect(one.textContent).toContain('New one');expect(one.querySelector('button[aria-pressed="true"]')).toBeNull();expect(h.filtered).not.toHaveBeenCalled();
 await act(async()=>{enter('Root/Branch/New two')});const two=h.container.querySelector('[data-created-location="true"]')!;expect(two).not.toBe(one);expect(one.hasAttribute('data-created-location')).toBe(false);expect(two.textContent).toContain('New two');expect(document.activeElement).toBe(input);act(()=>vi.advanceTimersByTime(2400));expect(h.container.querySelector('[data-created-location]')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'当前稿'}));expect(screen.queryByRole('button',{name:'标签: New one'})).toBeNull();expect(screen.queryByRole('button',{name:'标签: New two'})).toBeNull();
});
it('unfolds saved ancestors, clears obstructing search, and reuses a suggested identity',async()=>{
 const h=fixture();fireEvent.click(screen.getByRole('button',{name:'项目'}));fireEvent.click(screen.getByRole('button',{name:'标签: Root'}));act(()=>vi.advanceTimersByTime(500));expect(screen.queryByRole('button',{name:'标签: Branch'})).toBeNull();const search=screen.getByRole('textbox',{name:'搜索标签'});fireEvent.change(search,{target:{value:'not a tag'}});fireEvent.click(screen.getByRole('button',{name:'当前稿'}));
 await act(async()=>enter('Root/Branch/Found'));expect(screen.getByRole('button',{name:'标签: Branch'})).toBeTruthy();expect(screen.getByRole('button',{name:'标签: Found'})).toBeTruthy();
 const input=screen.getByRole('combobox');fireEvent.change(input,{target:{value:'Used'}});fireEvent.keyDown(input,{key:'ArrowDown'});await act(async()=>fireEvent.keyDown(input,{key:'Enter'}));expect(h.create).toHaveBeenLastCalledWith('Used','used');expect(h.container.querySelector('[data-created-location="true"]')?.getAttribute('data-tag-id')).toBe('used');
});
it('waits for late catalog publication and scrolls only the tag list using local geometry',async()=>{
 const h=fixture({lateCatalog:true});const list=h.container.querySelector<HTMLElement>('.library-list')!;list.scrollTop=20;list.scrollLeft=0;const rect=(top:number,bottom:number)=>({x:0,y:top,top,bottom,left:0,right:200,width:200,height:bottom-top,toJSON(){}});
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){if(this.matches('.library-filter'))return {...rect(100,140),left:300,right:350,width:50};if(this.matches('.tag-count'))return {...rect(100,140),left:140,right:160,width:20};return this===list?rect(100,300):this.matches('[data-tag-id]')?rect(1000,1040):rect(100,140)});const globalScroll=vi.spyOn(window,'scrollTo').mockImplementation(()=>{}),intoView=vi.fn();vi.stubGlobal('scrollIntoView',intoView);
 await act(async()=>enter('Root/Branch/Far down'));expect(list.scrollTop).toBe(20);h.publish();expect(list.scrollTop).toBe(760);expect(list.scrollLeft).toBe(218);expect(globalScroll).not.toHaveBeenCalled();expect(intoView).not.toHaveBeenCalled();expect(document.activeElement).toBe(screen.getByRole('combobox'));
});
it('does not switch scope or locate for failed or cancelled drafts',async()=>{
 const h=fixture({fail:true});await act(async()=>enter('Failed'));expect(project()).toBe('false');expect(screen.getByRole('alert').textContent).toBe('标签保存失败，请重试。');expect(h.container.querySelector('[data-created-location]')).toBeNull();const input=screen.getByRole('combobox');fireEvent.change(input,{target:{value:'Cancelled'}});fireEvent.keyDown(input,{key:'Escape'});expect(h.create).toHaveBeenCalledTimes(1);expect(project()).toBe('false');
});
it.each(['version','scope','escape','wheel','unmount'])('cancels late navigation after %s without undoing the successful save',async kind=>{
 const h=fixture({pending:true});await act(async()=>enter('Late saved'));if(kind==='version')h.switchVersion();else if(kind==='scope')fireEvent.click(screen.getByRole('button',{name:'当前稿'}));else if(kind==='escape')fireEvent.keyDown(screen.getByRole('combobox'),{key:'Escape'});else if(kind==='wheel')fireEvent.wheel(document);else h.unmount();await h.finish();if(kind!=='unmount'){expect(project()).toBe('false');expect(h.container.querySelector('[data-created-location]')).toBeNull()}expect(h.create).toHaveBeenCalledTimes(1);
});
it('does not alter filter membership or inherited row semantics when locating during filtering',async()=>{
 const h=fixture({filter:true});await act(async()=>enter('Root/New filtered'));expect(project()).toBe('true');expect(h.filtered).not.toHaveBeenCalled();expect(h.container.querySelector('[data-tag-id="used"]')?.closest('.tag-tree-entry')?.classList.contains('is-inherited-region')).toBe(true);expect(screen.getByRole('button',{name:'标签: Used'}).getAttribute('aria-pressed')).toBe('true');
});

it('does not steal creation focus after the user leaves the pending input',async()=>{
 const h=fixture({pending:true});await act(async()=>enter('Saved without focus steal'));const other=document.createElement('button');document.body.append(other);fireEvent.pointerDown(other);act(()=>other.focus());await h.finish();expect(document.activeElement).toBe(other);expect(project()).toBe('false');other.remove();
});

it('does not restore an old location after switching to another manuscript and back',async()=>{
 const h=fixture();await act(async()=>enter('Created'));expect(h.container.querySelector('[data-created-location]')).toBeTruthy();h.switchVersion();h.switchVersion('v1');expect(h.container.querySelector('[data-created-location]')).toBeNull();
});
