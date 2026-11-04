// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {TagCountTotals} from '../lib/tagCountCache';
import { TagsPanel } from './TagsPanel';
import { setTagPath, type TagLibrary } from '../lib/tags';
const seed=():TagLibrary=>{let library=setTagPath({schemaVersion:3,tags:[],groups:[]},'Root/Branch/Leaf').library;library=setTagPath(library,'Other').library;return {...library,groups:[{id:'g1',name:'Group one',parentId:null},{id:'g2',name:'Group two',parentId:null}],tags:library.tags.map(tag=>({...tag,groupIds:tag.name==='Root'||tag.name==='Leaf'?['g1']:tag.name==='Other'?['g2']:[]}))}};
beforeEach(()=>{vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});HTMLDialogElement.prototype.showModal=function(){this.open=true};HTMLDialogElement.prototype.close=function(){this.open=false};HTMLElement.prototype.setPointerCapture=()=>{};HTMLElement.prototype.releasePointerCapture=()=>{}});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks()});
function mount(fail=false,onlyRoot=false){const initial=seed(),changed=vi.fn(async()=>{if(fail)throw Error('Synthetic disk failure')}),filtered=vi.fn();function Harness(){const[library,setLibrary]=useState(initial),[selected,setSelected]=useState<string[]>([]),[enabled,setEnabled]=useState(true),[mode,setMode]=useState<'and'|'or'>('and');return <TagsPanel library={library} currentTagIds={onlyRoot?[initial.tags[0].id]:initial.tags.map(t=>t.id)} onChange={async next=>{await changed();setLibrary(next)}} onCreateTag={async()=>initial.tags[0].id} onRemoveCurrent={async()=>{}} readOnly={false} filter={selected} filterMode={mode} onFilterModeChange={setMode} filterEnabled={enabled} onFilterEnabledChange={next=>{setEnabled(next);if(!next)setSelected([])}} onFilter={id=>{filtered(id);setSelected(old=>id?(old.includes(id)?old.filter(v=>v!==id):[...old,id]):[])}} currentCount={id=>id===initial.tags[0].id?3:0}/>};return {...render(<Harness/>),initial,changed,filtered}}
const label=(name:string)=>screen.getByRole('button',{name:'标签: '+name});
it('defaults to the admitted current tree and browsing project tags never admits them',()=>{
 const h=mount(false,true);expect(label('Root')).toBeTruthy();expect(screen.queryByRole('button',{name:'标签: Leaf'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'项目'}));expect(label('Leaf')).toBeTruthy();expect(h.changed).not.toHaveBeenCalled();expect(h.container.querySelector('.tag-count-heading')?.textContent).toBe('片段数');expect(screen.queryByRole('button',{name:'按片段数排序'})).toBeNull();
});
it('filters only the pill, keeps AND/OR across views, and leaves row/count blank clicks inert',()=>{
 const h=mount();const row=label('Root').closest('.library-tag-row')!;fireEvent.click(row);fireEvent.click(row.querySelector('.tag-count')!);expect(h.filtered).not.toHaveBeenCalled();fireEvent.click(label('Root'));fireEvent.click(screen.getByRole('button',{name:'或'}));fireEvent.click(screen.getByRole('button',{name:'项目'}));expect(screen.getByRole('button',{name:'或'}).getAttribute('aria-pressed')).toBe('true');expect(label('Root').getAttribute('aria-pressed')).toBe('true');expect(h.container.querySelector('.tag-count')?.textContent).toBe('—');expect(h.container.querySelector('.tag-filter-controls')?.firstElementChild?.classList.contains('tag-filter-toggle')).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'标签筛选'}));expect(screen.queryByRole('group',{name:'标签组合方式'})).toBeNull();fireEvent.click(label('Root'));expect(h.filtered).toHaveBeenCalledTimes(1);
});
it('uses two-state global folding, auto-expands during filtering and restores the old folds afterward',()=>{
 vi.useFakeTimers();const h=mount();fireEvent.click(screen.getByRole('button',{name:'标签筛选'}));fireEvent.click(label('Root'),{detail:1});act(()=>vi.advanceTimersByTime(500));expect(screen.queryByRole('button',{name:'标签: Leaf'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'标签筛选'}));expect(label('Leaf')).toBeTruthy();expect((screen.getByRole('button',{name:'全部收起'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'标签筛选'}));expect(screen.queryByRole('button',{name:'标签: Leaf'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'全部展开'}));expect(label('Leaf')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'全部收起'}));expect(screen.queryByRole('button',{name:'标签: Leaf'})).toBeNull();expect(h.container.querySelector('.group-cycle')?.getAttribute('data-tip')).toBeNull();
});
it('search temporarily reveals folded descendants without overwriting fold state or searching group names',()=>{
 vi.useFakeTimers();mount();fireEvent.click(screen.getByRole('button',{name:'标签筛选'}));fireEvent.click(label('Root'),{detail:1});act(()=>vi.advanceTimersByTime(500));fireEvent.change(screen.getByRole('textbox',{name:'搜索标签'}),{target:{value:'Leaf'}});expect(label('Leaf')).toBeTruthy();fireEvent.change(screen.getByRole('textbox',{name:'搜索标签'}),{target:{value:''}});expect(screen.queryByRole('button',{name:'标签: Leaf'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'项目'}));fireEvent.change(screen.getByRole('textbox',{name:'搜索标签'}),{target:{value:'Group one'}});expect(screen.queryByRole('button',{name:'Group one'})).toBeNull();
});
it('project trash directly confirms branch deletion, cancel is inert and descendants are never promoted',async()=>{
 const h=mount();fireEvent.click(screen.getByRole('button',{name:'标签筛选'}));fireEvent.click(screen.getByRole('button',{name:'项目'}));fireEvent.click(screen.getByRole('button',{name:'删除项目标签: Root'}));expect(screen.getByRole('dialog')).toBeTruthy();expect(screen.getByText(/所有稿件对这些标签的关联/)).toBeTruthy();expect(screen.queryByRole('button',{name:'删除标签'})).toBeNull();expect(h.changed).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'取消'}));expect(label('Root')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'删除项目标签: Root'}));await act(async()=>fireEvent.click(screen.getByRole('button',{name:'删除'})));expect(h.changed).toHaveBeenCalledOnce();expect(screen.queryByRole('button',{name:'标签: Root'})).toBeNull();expect(screen.queryByRole('button',{name:'标签: Branch'})).toBeNull();expect(screen.queryByRole('button',{name:'标签: Leaf'})).toBeNull();expect(label('Other')).toBeTruthy();
});
it('confirms current branch removal directly without running project deletion',async()=>{
 const library=seed(),remove=vi.fn(async()=>{}),change=vi.fn(async()=>{});render(<TagsPanel library={library} currentTagIds={library.tags.map(t=>t.id)} onChange={change} onRemoveCurrent={remove} readOnly={false} filter={[]} filterMode="and" onFilterModeChange={()=>{}} filterEnabled={false} onFilterEnabledChange={()=>{}} onFilter={()=>{}} currentCount={()=>0}/>);
 fireEvent.click(screen.getByRole('button',{name:'从当前稿移除: Root'}));expect(screen.getByText(/项目标签和其他稿件不变/)).toBeTruthy();expect(screen.queryByRole('button',{name:'删除标签'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'取消'}));expect(remove).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'从当前稿移除: Root'}));await act(async()=>fireEvent.click(screen.getByRole('button',{name:'从当前稿移除'})));expect(remove).toHaveBeenCalledExactlyOnceWith(library.tags[0].id);expect(change).not.toHaveBeenCalled();
});
it('keeps a failed project branch confirmation open without altering its descendants',async()=>{
 const h=mount(true);fireEvent.click(screen.getByRole('button',{name:'标签筛选'}));fireEvent.click(screen.getByRole('button',{name:'项目'}));fireEvent.click(screen.getByRole('button',{name:'删除项目标签: Root'}));await act(async()=>fireEvent.click(screen.getByRole('button',{name:'删除'})));expect(screen.getByRole('alert')).toBeTruthy();expect(screen.getByRole('dialog')).toBeTruthy();expect(label('Leaf')).toBeTruthy();expect(h.changed).toHaveBeenCalledOnce();fireEvent.click(screen.getByRole('button',{name:'取消'}));expect(h.changed).toHaveBeenCalledOnce();
});

it('uses direct/coverage for real parents and scope-specific project totals with a lightweight explanation',async()=>{
 const library=seed(),root=library.tags.find(t=>t.name==='Root')!,leaf=library.tags.find(t=>t.name==='Leaf')!,loader=vi.fn(async()=>new TagCountTotals([[root.id,1],[leaf.id,9]],[[root.id,12],[leaf.id,9]]));
 const h=render(<TagsPanel library={library} projectRevision={1} versionKey="synthetic" loadProjectCounts={loader} currentTagIds={library.tags.map(t=>t.id)} onChange={async()=>{}} readOnly={false} filter={[]} filterMode="and" onFilterModeChange={()=>{}} filterEnabled={false} onFilterEnabledChange={()=>{}} onFilter={()=>{}} currentCount={id=>id===root.id?0:2} currentCoverage={()=>3}/>);
 const count=(name:string)=>label(name).closest('.library-tag-row')!.querySelector('.tag-count')!;
 expect(count('Root').textContent).toBe('0/3');expect(count('Leaf').textContent).toBe('2');expect(count('Root').getAttribute('data-action-tip')).toContain('直接标注 0');
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'项目'})));expect(count('Root').textContent).toBe('1/12');expect(count('Leaf').textContent).toBe('9');
 fireEvent.click(screen.getByRole('button',{name:'当前稿'}));expect(count('Root').textContent).toBe('0/3');expect(h.container.querySelector('.tag-count-heading')?.textContent).toBe('片段数');
});

it('updates project preview counts after a current structural change without reloading other versions',async()=>{
 const library=seed(),root=library.tags.find(t=>t.name==='Root')!.id,leaf=library.tags.find(t=>t.name==='Leaf')!.id;
 const loader=vi.fn(async()=>new TagCountTotals([[root,0],[leaf,3]],[[root,3],[leaf,3]],new TagCountTotals([[root,0],[leaf,1]],[[root,1],[leaf,1]])));
 const props={library,currentTagIds:library.tags.map(t=>t.id),loadProjectCounts:loader,versionKey:'synthetic',countVersionId:'synthetic:m:e',projectRevision:1,onChange:async()=>{},readOnly:false,filter:[],filterMode:'and' as const,onFilterModeChange:()=>{},filterEnabled:false,onFilterEnabledChange:()=>{},onFilter:()=>{}};
 const h=render(<TagsPanel {...props} currentCount={id=>id===leaf?1:0} currentCoverage={()=>1}/>);await act(async()=>fireEvent.click(screen.getByRole('button',{name:'项目'})));
 const count=()=>label('Root').closest('.library-tag-row')!.querySelector('.tag-count')!.textContent;expect(count()).toBe('0/3');
 h.rerender(<TagsPanel {...props} currentCount={id=>id===leaf?2:0} currentCoverage={()=>2}/>);expect(count()).toBe('0/4');expect(loader).toHaveBeenCalledOnce();
});

it('shows persistent right/down fold chevrons only for expandable view branches, with aligned leaf slots and no filter side effects',()=>{
 const h=mount();fireEvent.click(screen.getByRole('button',{name:'标签筛选'}));const fold=screen.getByRole('button',{name:'收起标签：Root'});expect(fold.getAttribute('aria-expanded')).toBe('true');expect(fold.querySelector('path')?.getAttribute('d')).toBe('m2 4 4 4 4-4');
 const leaf=label('Other').closest('.tag-row-main')!;expect(leaf.querySelector('.tag-fold-slot')).toBeTruthy();expect(leaf.querySelector('.tag-fold-toggle')).toBeNull();fireEvent.click(fold);expect(screen.queryByRole('button',{name:'标签: Leaf'})).toBeNull();expect(screen.getByRole('button',{name:'展开标签：Root'}).getAttribute('aria-expanded')).toBe('false');fireEvent.click(screen.getByRole('button',{name:'展开标签：Root'}));expect(label('Leaf')).toBeTruthy();expect(h.filtered).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'项目'}));fireEvent.click(screen.getByRole('button',{name:'收起标签：Root'}));expect(screen.queryByRole('button',{name:'标签: Leaf'})).toBeNull();expect(label('Other')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'标签筛选'}));expect((screen.getByRole('button',{name:'收起标签：Root'})as HTMLButtonElement).disabled).toBe(true);expect(label('Leaf')).toBeTruthy();
});
it('name sorting is one persisted action per click and retains the same label without a manual/automatic mode',async()=>{
 const library=seed(),sort=vi.fn(async()=>{});render(<TagsPanel library={library} currentTagIds={library.tags.map(t=>t.id)} onChange={async()=>{}} onSortName={sort} readOnly={false} filter={[]} filterMode="and" onFilterModeChange={()=>{}} filterEnabled={false} onFilterEnabledChange={()=>{}} onFilter={()=>{}} currentCount={()=>0}/>);
 const button=screen.getByRole('button',{name:'按名称排序'});await act(async()=>fireEvent.click(button));expect(sort).toHaveBeenLastCalledWith('level');expect(button.textContent).toBe('标签');expect(button.hasAttribute('aria-sort')).toBe(false);fireEvent.click(screen.getByRole('button',{name:'项目'}));await act(async()=>fireEvent.click(screen.getByRole('button',{name:'按名称排序'})));expect(sort).toHaveBeenLastCalledWith('level');await act(async()=>fireEvent.click(screen.getByRole('button',{name:'按名称排序'})));expect(sort).toHaveBeenCalledTimes(3);expect(screen.queryByText('手动顺序')).toBeNull();
});

it('keeps the filter row above the title and places equal-size global folding after name sorting',()=>{
 const h=mount();const tools=h.container.querySelector('.group-tools')!,head=h.container.querySelector('.tag-list-head')!,nameTools=head.querySelector('.tag-name-tools')!;expect(tools.contains(screen.getByRole('button',{name:'标签筛选'}))).toBe(true);expect(tools.querySelector('.group-cycle')).toBeNull();expect([...h.container.querySelector('.tag-library')!.children].indexOf(tools)).toBeLessThan([...h.container.querySelector('.tag-library')!.children].indexOf(head));expect(nameTools.querySelector('button')?.getAttribute('aria-label')).toBe('按名称排序');expect(nameTools.querySelector('.group-cycle')).toBeTruthy();expect(nameTools.querySelector('.group-cycle path')?.getAttribute('d')).toBe('m3 4 9 5 9-5m-18 16 9-5 9 5');
});
