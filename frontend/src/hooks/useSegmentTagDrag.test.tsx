// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSegmentTagDrag, SegmentTagDragContext } from './useSegmentTagDrag';
import { TagPill } from '../components/TagPill';
import {installEditorCompositionTracking} from '../lib/editorDrafts';

beforeEach(()=>{HTMLElement.prototype.setPointerCapture=vi.fn();HTMLElement.prototype.releasePointerCapture=vi.fn();vi.stubGlobal('requestAnimationFrame',vi.fn(()=>1));vi.stubGlobal('cancelAnimationFrame',vi.fn())});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals()});
function fixture() {
    const save=vi.fn(async()=>{}),rename=vi.fn(async()=>{}),remove=vi.fn(),errors=vi.fn();
    function Harness({enabled=true,context='v1',readOnlyTarget=false}:{enabled?:boolean;context?:string;readOnlyTarget?:boolean}) {
        const [tags,setTags]=useState<Record<string,string[]>>({source:['tag'],target:[]}),[target,setTarget]=useState<string|null>(null);
        const drag=useSegmentTagDrag({context,enabled,canStart:(source,id)=>tags[source]?.includes(id),canDrop:(source,to,id)=>tags[source]?.includes(id)&&!!tags[to]&&!tags[to].includes(id),onTarget:setTarget,
            onDrop:async(id,to)=>{await save();setTags(old=>({...old,[to]:[...new Set([...old[to],id])]}))},onError:errors});
        return <SegmentTagDragContext.Provider value={drag}>{['source','target'].map(id=><article key={id} id={'segment-'+id} className="segment" data-tag-drop-enabled={id!=='target'||!readOnlyTarget} data-tag-drop-target={target===id||undefined}>
            {tags[id].map(tag=><TagPill key={tag} name={'Synthetic '+tag} dragSource={{segmentId:id,tagId:tag}} renameEnabled onRename={rename} onRemove={remove} removeLabel={'Remove '+id}/>)}
        </article>)}</SegmentTagDragContext.Provider>;
    }
    const view=render(<Harness/>),pill=()=>view.container.querySelector<HTMLElement>('#segment-source .tag-pill')!,destination=()=>view.container.querySelector<HTMLElement>('#segment-target')!;
    const point=(type:string,x=10,y=10,extra:Record<string,unknown>={})=>{const event=new Event(type,{bubbles:true,cancelable:true});Object.assign(event,{pointerId:1,button:0,clientX:x,clientY:y,ctrlKey:type==='pointerdown',metaKey:false,altKey:false,...extra});fireEvent(pill(),event)};
    const begin=()=>{document.elementFromPoint=vi.fn(()=>destination());point('pointerdown');point('pointermove',80,80)};
    return {...view,Harness,pill,destination,point,begin,save,rename,remove,errors};
}
it('copies one ID after modifier release, keeps source, creates one ghost and does not rename/remove on release',async()=>{
    const h=fixture();h.begin();expect(document.querySelectorAll('.tag-drag-ghost')).toHaveLength(1);expect(h.destination().dataset.tagDropTarget).toBe('true');
    await act(async()=>h.point('pointerup',80,80));expect(h.save).toHaveBeenCalledOnce();expect(h.container.querySelectorAll('#segment-source .tag-pill')).toHaveLength(1);expect(h.container.querySelectorAll('#segment-target .tag-pill')).toHaveLength(1);expect(document.querySelector('.tag-drag-ghost')).toBeNull();
    fireEvent.doubleClick(screen.getAllByText('Synthetic tag')[0]);expect(screen.queryByRole('textbox')).toBeNull();expect(h.rename).not.toHaveBeenCalled();expect(h.remove).not.toHaveBeenCalled();
    h.begin();await act(async()=>h.point('pointerup',80,80));expect(h.save).toHaveBeenCalledTimes(1);
});
it.each(['self','outside','cancel','escape','blur','no-modifier','readonly-target','disabled','version-change'])('makes %s a no-op and cleans up transient feedback',async mode=>{
    const h=fixture();if(mode==='disabled')h.rerender(<h.Harness enabled={false}/>);if(mode==='readonly-target')h.rerender(<h.Harness readOnlyTarget/>);
    if(mode==='no-modifier'){document.elementFromPoint=vi.fn(()=>h.destination());h.point('pointerdown',10,10,{ctrlKey:false});h.point('pointermove',80,80)}else h.begin();
    if(mode==='self')document.elementFromPoint=vi.fn(()=>h.pill());if(mode==='outside')document.elementFromPoint=vi.fn(()=>null);
    if(mode==='escape')fireEvent.keyDown(window,{key:'Escape'});if(mode==='blur')fireEvent.blur(window);if(mode==='version-change')h.rerender(<h.Harness context="v2"/>);
    await act(async()=>h.point(mode==='cancel'?'pointercancel':'pointerup',80,80));expect(h.save).not.toHaveBeenCalled();expect(h.container.querySelectorAll('#segment-source .tag-pill')).toHaveLength(1);expect(h.container.querySelectorAll('#segment-target .tag-pill')).toHaveLength(0);expect(document.querySelector('.tag-drag-ghost')).toBeNull();
});
it('cancels if a write/filter lock starts mid-drag, and leaves both sides unchanged on a failed transaction',async()=>{
    const h=fixture();h.begin();h.rerender(<h.Harness enabled={false}/>);await act(async()=>h.point('pointerup',80,80));expect(h.save).not.toHaveBeenCalled();
    h.rerender(<h.Harness/>);h.save.mockRejectedValueOnce(Error('synthetic write conflict'));h.begin();await act(async()=>h.point('pointerup',80,80));expect(h.errors).toHaveBeenCalledOnce();expect(h.container.querySelectorAll('#segment-target .tag-pill')).toHaveLength(0);expect(h.container.querySelectorAll('#segment-source .tag-pill')).toHaveLength(1);
});
it('does not start a drag from the remove control or an inline rename field',()=>{
    const h=fixture();fireEvent.pointerDown(screen.getByRole('button',{name:'Remove source'}),{button:0,ctrlKey:true});h.point('pointermove',80,80);expect(document.querySelector('.tag-drag-ghost')).toBeNull();
    fireEvent.doubleClick(screen.getByText('Synthetic tag'));fireEvent.pointerDown(screen.getByRole('textbox'),{button:0,ctrlKey:true});h.point('pointermove',80,80);expect(document.querySelector('.tag-drag-ghost')).toBeNull();expect(h.save).not.toHaveBeenCalled();
});

it('does not steal an IME composition or start while a modal owns interaction',()=>{
    const h=fixture(),stop=installEditorCompositionTracking();fireEvent.compositionStart(h.pill());h.begin();expect(document.querySelector('.tag-drag-ghost')).toBeNull();fireEvent.compositionEnd(h.pill());stop();
    const modal=document.createElement('div');modal.setAttribute('role','dialog');document.body.appendChild(modal);h.begin();expect(document.querySelector('.tag-drag-ghost')).toBeNull();modal.remove();expect(h.save).not.toHaveBeenCalled();
});
