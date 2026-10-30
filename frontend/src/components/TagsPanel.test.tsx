// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { TagsPanel } from './TagsPanel';
import type { TagLibrary } from '../lib/tags';
const initial: TagLibrary = { schemaVersion: 1, tags: [{ id: 't1', name: 'Topic', groupIds: ['g1', 'g2'] }], groups: [{ id: 'g1', name: 'Parent', parentId: null }, { id: 'g2', name: 'Child', parentId: 'g1' }] };
beforeEach(() => { HTMLElement.prototype.scrollBy=function(x?:number|ScrollToOptions,y?:number){this.scrollTop+=typeof x==='object'?x.top??0:y??0}; vi.stubGlobal('ResizeObserver', class {
    observe() { }
    disconnect() { }
}); HTMLDialogElement.prototype.showModal = function () { this.open = true; }; HTMLDialogElement.prototype.close = function () { this.open = false; }; HTMLElement.prototype.setPointerCapture = () => { }; HTMLElement.prototype.releasePointerCapture = () => { }; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function mount(seed=initial) { const filter = vi.fn(), changed = vi.fn(); function Harness() { const [library, setLibrary] = useState(seed), [selected,setSelected]=useState<string[]>([]), [enabled,setEnabled]=useState(true), [mode,setMode]=useState<'and'|'or'>('and'); return <TagsPanel library={library} onChange={async (next) => { changed(next); setLibrary(next); }} readOnly={false} filter={selected} filterMode={mode} onFilterModeChange={setMode} filterEnabled={enabled} onFilterEnabledChange={value=>{setEnabled(value);if(!value){setSelected([]);filter(null)}}} onFilter={id=>{filter(id);setSelected(old=>id?(old.includes(id)?old.filter(value=>value!==id):[...old,id]):[])}} currentCount={() => 1} projectCounts={new Map([['t1', 2]])} countError={false} retryCounts={() => { }}/>; } const view = render(<Harness />); return { ...view, filter, changed }; }
const pointer = (el: Element, type: string, x: number, y: number, meta = false, shift = false) => { const e = new Event(type, { bubbles: true, cancelable: true }); Object.assign(e, { pointerId: 1, clientX: x, clientY: y, button: 0, metaKey: meta, ctrlKey: meta, shiftKey: shift }); fireEvent(el, e); };
describe('production tags panel', () => {
    it('shows AND/OR for zero selections and preserves mode and stable-ID selection across views',()=>{
        const h=mount();expect(screen.getByRole('button',{name:'与'}).getAttribute('aria-pressed')).toBe('true');fireEvent.click(screen.getByRole('button',{name:'或'}));
        fireEvent.click(screen.getByRole('button',{name:'标签: Topic'}));fireEvent.click(screen.getByRole('button',{name:'分组'}));expect(screen.getByRole('button',{name:'或'}).getAttribute('aria-pressed')).toBe('true');
        const pills=screen.getAllByRole('button',{name:'标签: Topic'});expect(pills).toHaveLength(2);expect(pills.every(pill=>pill.getAttribute('aria-pressed')==='true')).toBe(true);fireEvent.click(pills[1]);expect(pills.every(pill=>pill.getAttribute('aria-pressed')==='false')).toBe(true);
        expect(h.container.querySelector('.tag-view-toolbar .tag-filter-toggle')).toBeNull();expect(h.container.querySelector('.tag-filter-controls .group-cycle + .tag-filter-toggle')).toBeTruthy();
        fireEvent.click(screen.getByRole('button',{name:'标签筛选'}));expect(screen.queryByRole('group',{name:'标签组合方式'})).toBeNull();
    });
    it.each([false,true])('latches tag membership drag copy=%s after modifier release without filtering',async copy=>{
        const seed={...initial,groups:[...initial.groups,{id:'g3',name:'Target',parentId:null}]},h=mount(seed);fireEvent.click(screen.getByRole('button',{name:'分组'}));
        const source=h.container.querySelector('[data-tag-group="g1"]>.tag-group-content>.group-tags .library-filter')!,target=h.container.querySelector('[data-tag-group="g3"]')!;document.elementFromPoint=vi.fn(()=>target.querySelector('.tag-group-header')!);
        pointer(source,'pointerdown',80,200,true,copy);pointer(source,'pointermove',100,400,false,false);expect(h.container.querySelector('[data-tag-group="g3"]')?.classList.contains('tag-drop-target')).toBe(true);
        expect(h.container.querySelector('.tag-library')?.getAttribute('data-tag-drag')).toBe(copy?'copy':'move');pointer(source,'pointerup',100,400,false,false);
        await waitFor(()=>expect(h.changed).toHaveBeenCalledOnce());expect(h.changed.mock.calls[0][0].tags[0].id).toBe('t1');expect(h.changed.mock.calls[0][0].tags[0].groupIds).toEqual(copy?['g1','g2','g3']:['g2','g3']);expect(h.filter).not.toHaveBeenCalled();
    });
    it('renders ungrouped as a final divider without group controls and adds its dragged tag to a collapsed group',async()=>{
        const h=mount({...initial,tags:[...initial.tags,{id:'loose',name:'Loose',groupIds:[]}]});fireEvent.click(screen.getByRole('button',{name:'分组'}));const ungrouped=h.container.querySelector('.tag-ungrouped')!;
        expect(ungrouped.querySelector('.ungrouped-divider')?.textContent).toBe('未分组');expect(ungrouped.querySelector('.group-toggle,.group-manage,.group-collapse,.group-delete,[data-tag-group]')).toBeNull();
        const target=h.container.querySelector('[data-tag-group="g1"]')!;fireEvent.click(target.querySelector('.group-collapse')!);const source=ungrouped.querySelector('.library-filter')!;document.elementFromPoint=vi.fn(()=>target.querySelector('.tag-group-header')!);
        pointer(source,'pointerdown',60,500,true,true);pointer(source,'pointermove',100,200,false,false);expect(h.container.querySelector('.tag-library')?.getAttribute('data-tag-drag')).toBe('move');pointer(source,'pointerup',100,200);
        await waitFor(()=>expect(h.changed).toHaveBeenCalledOnce());expect(h.changed.mock.calls[0][0].tags.find((tag:{id:string})=>tag.id==='loose').groupIds).toEqual(['g1']);expect(h.container.querySelector('.tag-ungrouped')).toBeNull();
    });
    it('cancels tag drag on Escape or invalid drop',()=>{
        const h=mount();fireEvent.click(screen.getByRole('button',{name:'分组'}));const source=h.container.querySelector('[data-tag-group="g1"] .library-filter')!;
        document.elementFromPoint=vi.fn(()=>h.container.querySelector('[data-tag-group="g2"]')!);pointer(source,'pointerdown',60,200,true);pointer(source,'pointermove',80,300);fireEvent.keyDown(window,{key:'Escape'});pointer(source,'pointerup',80,300);expect(h.changed).not.toHaveBeenCalled();
        document.elementFromPoint=vi.fn(()=>document.body);pointer(source,'pointerdown',60,200,true);pointer(source,'pointermove',80,300);pointer(source,'pointerup',80,300);expect(h.changed).not.toHaveBeenCalled();
    });
    it('keeps original memberships and reports a failed drag save without filtering',async()=>{
        const change=vi.fn(async()=>{throw new Error('Synthetic persistence failure')});
        const h=render(<TagsPanel library={initial} onChange={change} readOnly={false} filter={[]} filterMode="and" onFilterModeChange={()=>{}} filterEnabled onFilterEnabledChange={()=>{}} onFilter={()=>{throw new Error('Unexpected filter')}} currentCount={()=>1} projectCounts={new Map()} countError={false} retryCounts={()=>{}}/>);
        fireEvent.click(screen.getByRole('button',{name:'分组'}));const source=h.container.querySelector('[data-tag-group="g1"] .library-filter')!,target=h.container.querySelector('[data-tag-group="g2"]')!;document.elementFromPoint=vi.fn(()=>target.querySelector('.tag-group-header')!);
        pointer(source,'pointerdown',60,200,true);pointer(source,'pointermove',80,300);pointer(source,'pointerup',80,300);await screen.findByRole('alert');expect(change).toHaveBeenCalledOnce();expect(h.container.querySelectorAll('.library-filter')).toHaveLength(2);expect(initial.tags[0].groupIds).toEqual(['g1','g2']);
    });
    it('scrolls at the list edge during a held drag, then stops and preserves data on window blur',()=>{
        const frames:FrameRequestCallback[]=[],cancel=vi.fn();vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames.push(callback);return frames.length});vi.stubGlobal('cancelAnimationFrame',cancel);
        const h=mount();fireEvent.click(screen.getByRole('button',{name:'分组'}));const list=h.container.querySelector<HTMLElement>('.library-list')!,source=h.container.querySelector('[data-tag-group="g1"] .library-filter')!;
        list.getBoundingClientRect=()=>({top:100,bottom:300,left:0,right:400,width:400,height:200} as DOMRect);document.elementFromPoint=vi.fn(()=>h.container.querySelector('[data-tag-group="g2"]')!);
        pointer(source,'pointerdown',80,150,true);pointer(source,'pointermove',90,290);expect(frames).toHaveLength(1);frames[0](0);expect(list.scrollTop).toBe(12);fireEvent.blur(window);expect(cancel).toHaveBeenCalled();pointer(source,'pointerup',90,290);expect(h.changed).not.toHaveBeenCalled();expect(h.container.querySelector('.tag-drop-target')).toBeNull();
    });
    it('creates a root inline on explicit Enter, permits spaces, protects IME, and cancels blur/duplicates safely',async()=>{
        const h=mount();fireEvent.click(screen.getByRole('button',{name:'分组'}));fireEvent.click(screen.getByRole('button',{name:'＋ 新建组'}));let field=screen.getByRole('textbox',{name:'分组名称'});
        expect(document.activeElement).toBe(field);expect(screen.queryByRole('dialog')).toBeNull();fireEvent.change(field,{target:{value:'Parent'}});fireEvent.keyDown(field,{key:'Enter'});
        await screen.findByRole('alert');expect(h.changed).not.toHaveBeenCalled();expect(document.activeElement).toBe(field);
        fireEvent.change(field,{target:{value:' Synthetic new group '}});fireEvent.keyDown(field,{key:' '});fireEvent.compositionStart(field);fireEvent.keyDown(field,{key:'Enter'});expect(h.changed).not.toHaveBeenCalled();fireEvent.compositionEnd(field);fireEvent.keyDown(field,{key:'Enter',keyCode:229});expect(h.changed).not.toHaveBeenCalled();
        fireEvent.keyDown(field,{key:'Enter'});await waitFor(()=>expect(h.changed).toHaveBeenCalledOnce());expect(h.changed.mock.calls[0][0].groups.at(-1)).toMatchObject({name:'Synthetic new group',parentId:null});expect(screen.queryByRole('textbox',{name:'分组名称'})).toBeNull();expect(screen.queryByRole('dialog')).toBeNull();
        fireEvent.click(screen.getByRole('button',{name:'＋ 新建组'}));field=screen.getByRole('textbox',{name:'分组名称'});fireEvent.change(field,{target:{value:'   '}});fireEvent.keyDown(field,{key:'Enter'});expect(h.changed).toHaveBeenCalledOnce();fireEvent.blur(field);expect(screen.queryByRole('textbox',{name:'分组名称'})).toBeNull();
    });
    it('focuses the name field for new/manage forms, dismisses without writing, and restores the opener',async()=>{
        const h=mount();fireEvent.click(screen.getByRole('button',{name:'分组'}));const trigger=screen.getByRole('button',{name:'＋ 新建组'});trigger.focus();fireEvent.click(trigger);
        const field=screen.getByRole('textbox',{name:'分组名称'});expect(document.activeElement).toBe(field);
        fireEvent.change(field,{target:{value:'Unsubmitted'}});fireEvent.keyDown(field,{key:'Escape'});
        await waitFor(()=>expect(document.activeElement).toBe(trigger));expect(h.changed).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button',{name:'管理分组: Parent'}));expect(document.activeElement).toBe(screen.getByRole('textbox',{name:'分组名称'}));
        expect(screen.queryByRole('button',{name:'删除分组'})).toBeNull();
        const dialog=screen.getByRole('dialog');dialog.getBoundingClientRect=()=>({left:10,right:400,top:10,bottom:400} as DOMRect);
        fireEvent(dialog,new MouseEvent('pointerdown',{bubbles:true,clientX:0,clientY:0}));fireEvent.click(dialog,{clientX:0,clientY:0});
        expect(screen.queryByRole('dialog')).toBeNull();expect(h.changed).not.toHaveBeenCalled();
    });
    it('opens two group-delete choices; cancel and Escape never write; level and tree have distinct effects',async()=>{
        const h=mount();fireEvent.click(screen.getByRole('button',{name:'分组'}));const trigger=screen.getByRole('button',{name:'删除分组: Parent'});trigger.focus();fireEvent.click(trigger);
        expect(screen.getByRole('menuitem',{name:'删除整组'})).toBeTruthy();fireEvent.keyDown(screen.getByRole('menuitem',{name:'删除整组'}),{key:'Escape'});
        expect(screen.queryByRole('menu')).toBeNull();expect(document.activeElement).toBe(trigger);
        fireEvent.click(trigger);fireEvent.click(screen.getByRole('menuitem',{name:'删除整组'}));expect(screen.getByRole('dialog',{name:'删除整组'})).toBeTruthy();expect(document.activeElement).toBe(screen.getByRole('button',{name:'取消'}));
        fireEvent.click(screen.getByRole('button',{name:'取消'}));await waitFor(()=>expect(document.activeElement).toBe(trigger));expect(h.changed).not.toHaveBeenCalled();
        fireEvent.click(trigger);fireEvent.click(screen.getByRole('menuitem',{name:'仅删除此层级'}));fireEvent.click(screen.getByRole('button',{name:'删除'}));
        await waitFor(()=>expect(h.changed).toHaveBeenCalledOnce());expect(h.changed.mock.calls[0][0].groups).toEqual([{id:'g2',name:'Child',parentId:null}]);expect(h.changed.mock.calls[0][0].tags[0].groupIds).toEqual(['g2']);expect(h.filter).not.toHaveBeenCalled();
        cleanup();const second=mount();fireEvent.click(screen.getByRole('button',{name:'分组'}));fireEvent.click(screen.getByRole('button',{name:'删除分组: Parent'}));fireEvent.click(screen.getByRole('menuitem',{name:'删除整组'}));fireEvent.click(screen.getByRole('button',{name:'删除'}));
        await waitFor(()=>expect(second.changed).toHaveBeenCalledOnce());expect(second.changed.mock.calls[0][0].groups).toEqual([]);expect(second.changed.mock.calls[0][0].tags).toEqual([{...initial.tags[0],groupIds:[]}]);
    });
    it('keeps the funnel mounted, disables only tag clicks, and does not replay a selection when enabled again',()=>{
        const h=mount(),toggle=screen.getByRole('button',{name:'标签筛选'}),pill=screen.getByRole('button',{name:'标签: Topic'});
        expect(toggle.getAttribute('aria-pressed')).toBe('true');fireEvent.click(pill);expect(h.filter).toHaveBeenLastCalledWith('t1');
        fireEvent.click(toggle);expect(toggle.getAttribute('aria-pressed')).toBe('false');expect(h.filter).toHaveBeenLastCalledWith(null);h.filter.mockClear();
        fireEvent.click(pill);fireEvent.click(pill.closest('.library-tag-row')!);expect(h.filter).not.toHaveBeenCalled();
        fireEvent.click(toggle);expect(h.filter).not.toHaveBeenCalled();expect(pill.getAttribute('aria-pressed')).toBe('false');fireEvent.click(pill);expect(h.filter).toHaveBeenLastCalledWith('t1');
        const globalShortcut=vi.fn();document.addEventListener('keydown',globalShortcut);const space=new KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true});fireEvent(toggle,space);expect(globalShortcut).not.toHaveBeenCalled();expect(space.defaultPrevented).toBe(false);document.removeEventListener('keydown',globalShortcut);
    });
    it('renders the project-delete object as a safe pill and keeps the whole-project scope',()=>{
        const name='<img src=x onerror=alert(1)> & Test';mount({...initial,tags:[{...initial.tags[0],name}]});
        fireEvent.click(screen.getByRole('button',{name:'删除项目标签: '+name}));const dialog=screen.getByRole('dialog');
        expect(dialog.querySelector('.trash-material-name .tag-pill')?.textContent).toBe(name);expect(dialog.querySelector('img')).toBeNull();expect(dialog.textContent).toContain('整个项目');expect(document.activeElement).toBe(screen.getByRole('button',{name:'取消'}));
    });
    it('filters only from the pill, never row/count/delete; cancel preserves data', async () => { const h = mount(), pill = screen.getByRole('button', { name: '标签: Topic' }), row = pill.closest('.library-tag-row')!; fireEvent.click(row); fireEvent.click(row.querySelector('.tag-count')!); expect(h.filter).not.toHaveBeenCalled(); fireEvent.click(pill); expect(h.filter).toHaveBeenCalledWith('t1'); fireEvent.click(screen.getByRole('button', { name: '删除项目标签: Topic' })); fireEvent.click(screen.getByRole('button', { name: '取消' })); expect(h.changed).not.toHaveBeenCalled(); });
    it('cycles groups/tags independently and resumes full expansion after local change', async () => { const h = mount(); fireEvent.click(screen.getByRole('button', { name: '分组' })); const cycle = h.container.querySelector('.group-cycle')!; expect(cycle.getAttribute('title')).toBeNull(); expect(cycle.getAttribute('data-tip')).toBeNull(); fireEvent.click(cycle); expect(h.container.querySelectorAll('.library-pill')).toHaveLength(2); fireEvent.click(cycle); expect(h.container.querySelectorAll('.library-pill')).toHaveLength(0); expect(h.container.querySelectorAll('[data-tag-group]')).toHaveLength(2); fireEvent.click(cycle); expect(h.container.querySelectorAll('[data-tag-group]')).toHaveLength(1); fireEvent.click(h.container.querySelector('[data-tag-group="g1"] .group-collapse')!); fireEvent.click(cycle); expect(h.container.querySelectorAll('.library-pill')).toHaveLength(2); expect(h.filter).not.toHaveBeenCalled(); expect(h.changed).not.toHaveBeenCalled(); });
    it('removes group membership only and preserves the tag in its other group', async () => { const h = mount(); fireEvent.click(screen.getByRole('button', { name: '分组' })); fireEvent.click(h.container.querySelector('[data-tag-group="g2"] .group-tag-remove')!); await waitFor(() => expect(h.changed).toHaveBeenCalled()); expect(h.changed.mock.calls[0][0].tags).toEqual([{ ...initial.tags[0], groupIds: ['g1'] }]); expect(h.filter).not.toHaveBeenCalled(); });
    it('outdents a child to its parent sibling using a line, including modifier release, and rejects cycles', async () => {
        const h = mount();
        fireEvent.click(screen.getByRole('button', { name: '分组' }));
        const parent = h.container.querySelector('[data-tag-group="g1"]>.tag-group-header')!, child = h.container.querySelector('[data-tag-group="g2"]>.tag-group-header')!, name = child.querySelector('.group-toggle')!;
        parent.getBoundingClientRect = () => ({ left: 10, top: 100, height: 28 } as DOMRect);
        child.getBoundingClientRect = () => ({ left: 34, top: 160, height: 28 } as DOMRect);
        document.elementFromPoint = vi.fn(() => child);
        pointer(name, 'pointerdown', 65, 172, true);
        pointer(name, 'pointermove', 36, 172, false);
        expect(h.container.querySelector('[data-tag-group="g1"].drop-after')).not.toBeNull();
        pointer(name, 'pointerup', 36, 172, false);
        await waitFor(() => expect(h.changed).toHaveBeenCalled());
        expect(h.changed.mock.calls[0][0].groups.find((g: {
            id: string;
        }) => g.id === 'g2').parentId).toBeNull();
        h.changed.mockClear();
        pointer(name, 'pointerdown', 65, 172, true);
        pointer(name, 'pointermove', 36, 172, false);
        fireEvent.keyDown(window, { key: 'Escape' });
        pointer(name, 'pointerup', 36, 172, false);
        expect(h.changed).not.toHaveBeenCalled();
    });
});
it('a double-click second click cannot toggle a filter a second time',()=>{const h=mount(),pill=screen.getByRole('button',{name:'标签: Topic'});fireEvent.click(pill,{detail:1});fireEvent.click(pill,{detail:2});fireEvent.doubleClick(pill);expect(h.filter).toHaveBeenCalledExactlyOnceWith('t1');expect(pill.getAttribute('aria-pressed')).toBe('true');expect(screen.queryByRole('dialog')).toBeNull()});
