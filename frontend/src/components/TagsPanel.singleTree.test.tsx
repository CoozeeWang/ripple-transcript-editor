// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi}from'vitest';
import {act,cleanup,fireEvent,render,screen}from'@testing-library/react';
import{TagsPanel}from'./TagsPanel';
import type{TagLibrary}from'../lib/tags';
import{TagCountTotals}from'../lib/tagCountCache';
const library:TagLibrary={schemaVersion:4,treeOrder:['root','branch','leaf','unused'],groups:[],tags:[{id:'root',name:'Root',parentId:null,groupIds:[]},{id:'branch',name:'Branch',parentId:'root',groupIds:[]},{id:'leaf',name:'Leaf',parentId:'branch',groupIds:[]},{id:'unused',name:'Unused',parentId:null,groupIds:[]}],legacyGroups:{groups:[{id:'old',name:'Recoverable legacy group',parentId:null}],memberships:[{tagId:'leaf',groupIds:['old']}]}};
beforeEach(()=>vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}}));afterEach(()=>{cleanup();vi.unstubAllGlobals()});
function fixture(options:{used?:string[];filter?:boolean;readOnly?:boolean}={}){
 const rename=vi.fn(async()=>{}),save=vi.fn(async()=>{}),remove=vi.fn(async()=>{});
 const props={library,currentTagIds:options.used??['leaf'],onChange:save,onRenameTag:rename,onRemoveCurrent:remove,readOnly:options.readOnly??false,filter:[],filterMode:'and' as const,onFilterModeChange:()=>{},filterEnabled:options.filter??false,onFilterEnabledChange:()=>{},onFilter:()=>{},currentCount:(id:string)=>id==='leaf'?2:0,currentCoverage:(id:string)=>['root','branch','leaf'].includes(id)?2:0,loadProjectCounts:async()=>new TagCountTotals([['root',0],['branch',0],['leaf',5],['unused',0]],[['root',5],['branch',5],['leaf',5],['unused',0]])};
 return{...render(<TagsPanel {...props}/>),rename,save,remove,props};
}
it('projects actual used IDs with complete structural ancestors and preserves their zero direct counts',()=>{
 const before=JSON.stringify(library),h=fixture();expect([...h.container.querySelectorAll<HTMLElement>('[data-tag-id]')].map(row=>row.dataset.tagId)).toEqual(['root','branch','leaf']);
 expect(h.container.querySelector('[data-tag-id="root"] .tag-count')?.textContent).toBe('0/2');expect(h.container.querySelector('[data-tag-id="branch"] .tag-count')?.textContent).toBe('0/2');expect(h.container.querySelector('[data-tag-id="leaf"] .tag-count')?.textContent).toBe('2');
 expect(screen.queryByText('Recoverable legacy group')).toBeNull();expect(screen.queryByRole('button',{name:'分组'})).toBeNull();expect(screen.queryByRole('button',{name:'新建分组'})).toBeNull();expect(JSON.stringify(library)).toBe(before);
});
it('keeps a new manuscript empty until it uses a tag and exposes the full project tree without assignments',async()=>{
 const h=fixture({used:[]});expect(screen.queryByRole('button',{name:'标签: Root'})).toBeNull();expect(screen.getByText('当前稿尚未使用标签，可切换到“项目”选用已有标签。')).toBeTruthy();
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'项目'})));expect(screen.getByRole('button',{name:'标签: Unused'})).toBeTruthy();expect(h.save).not.toHaveBeenCalled();expect(h.remove).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'当前稿'}));expect(screen.queryByRole('button',{name:'标签: Root'})).toBeNull();
});
it('opens the same full-path editor, selects the complete path and cancels without writing',async()=>{
 const h=fixture();fireEvent.doubleClick(screen.getByRole('button',{name:'标签: Leaf'}));let input=screen.getByRole('textbox',{name:'项目标签完整路径'})as HTMLInputElement;expect(input.value).toBe('Root/Branch/Leaf');expect(document.activeElement).toBe(input);expect([input.selectionStart,input.selectionEnd]).toEqual([0,input.value.length]);fireEvent.change(input,{target:{value:'Other/Leaf'}});fireEvent.keyDown(input,{key:'Escape'});expect(h.rename).not.toHaveBeenCalled();
 fireEvent.doubleClick(screen.getByRole('button',{name:'标签: Leaf'}));input=screen.getByRole('textbox',{name:'项目标签完整路径'})as HTMLInputElement;fireEvent.change(input,{target:{value:'Other/Leaf'}});await act(async()=>fireEvent.keyDown(input,{key:'Enter'}));expect(h.rename).toHaveBeenCalledExactlyOnceWith('leaf','Other/Leaf');
});
it.each([{filter:true},{readOnly:true}])('keeps sidebar structural editing blocked for %j',options=>{
 const h=fixture(options);fireEvent.doubleClick(screen.getByRole('button',{name:'标签: Leaf'}));expect(screen.queryByRole('textbox',{name:'项目标签完整路径'})).toBeNull();expect(h.rename).not.toHaveBeenCalled();
});
