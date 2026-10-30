// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {TagPill} from './TagPill';
afterEach(()=>{cleanup();vi.useRealTimers()});
it('keeps one remove control for every editable label regardless of its source, length or focus',()=>{
 const remove=vi.fn(),parent=vi.fn(),names=['中文标签','A long synthetic label repeated repeated repeated','<img src=x> & Test'];
 const view=render(<div onClick={parent}>{names.map(name=><TagPill key={name} name={name} stopPropagation onRemove={()=>remove(name)} removeLabel={'Remove '+name}/>)}</div>);
 expect(view.container.querySelectorAll('.tag-pill-remove')).toHaveLength(3);expect(view.container.querySelector('img')).toBeNull();
 fireEvent.click(screen.getByText(names[1]));expect(parent).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Remove '+names[1]}));expect(remove).toHaveBeenCalledWith(names[1]);expect(parent).not.toHaveBeenCalled();
});
it('omits the control only for a display/read-only context and keeps a disabled control visible in markup',()=>{
 const view=render(<><TagPill name="Read only"/><TagPill name="Locked" onRemove={()=>{}} disabled removeLabel="Remove locked"/></>);
 expect(view.container.querySelectorAll('.tag-pill-remove')).toHaveLength(1);expect((screen.getByRole('button',{name:'Remove locked'}) as HTMLButtonElement).disabled).toBe(true);
});
it('lets a display pill activate its suggestion or checkbox parent',()=>{
 const choose=vi.fn();render(<div onClick={choose}><TagPill name="Suggested"/></div>);fireEvent.click(screen.getByText('Suggested'));expect(choose).toHaveBeenCalledOnce();
});
it('leaves single clicks inert and edits full paths only on double click',async()=>{
 vi.useFakeTimers();const rename=vi.fn(async()=>{}),remove=vi.fn();render(<TagPill name="Leaf" fullPath="Root/Branch/Leaf" renameEnabled onRename={rename} onRemove={remove} removeLabel="Remove"/>);
 fireEvent.click(screen.getByText('Leaf'),{detail:1});act(()=>vi.advanceTimersByTime(600));expect(screen.queryByText('Root/Branch/Leaf')).toBeNull();expect(screen.queryByRole('textbox')).toBeNull();
 fireEvent.doubleClick(screen.getByText('Leaf'));const input=screen.getByRole('textbox');expect((input as HTMLInputElement).value).toBe('Root/Branch/Leaf');fireEvent.change(input,{target:{value:'New root/Leaf'}});fireEvent.compositionStart(input);fireEvent.keyDown(input,{key:'Enter'});expect(rename).not.toHaveBeenCalled();fireEvent.compositionEnd(input);await act(async()=>fireEvent.keyDown(input,{key:'Enter'}));expect(rename).toHaveBeenCalledExactlyOnceWith('New root/Leaf');expect(remove).not.toHaveBeenCalled();
});
it('allows F2 into the same path editor only when filtering permits rename',async()=>{
 const rename=vi.fn(async()=>{});const view=render(<TagPill name="Leaf" fullPath="Root/Leaf" renameEnabled onRename={rename}/>);fireEvent.keyDown(screen.getByRole('button',{name:'Leaf'}),{key:'F2'});expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Root/Leaf');fireEvent.keyDown(screen.getByRole('textbox'),{key:'Escape'});view.rerender(<TagPill name="Leaf" fullPath="Root/Leaf" renameEnabled={false} onRename={rename}/>);fireEvent.doubleClick(screen.getByText('Leaf'));await waitFor(()=>expect(screen.queryByRole('textbox')).toBeNull());expect(rename).not.toHaveBeenCalled();
});
it('explains the filter gate on label double click without confusing the remove control',async()=>{
 const {TooltipHost}=await import('./TooltipHost');const rename=vi.fn(async()=>{}),remove=vi.fn();render(<><TooltipHost/><TagPill name="Synthetic" editingBlockedByFilter onRename={rename} onRemove={remove} removeLabel="Remove"/></>);fireEvent.doubleClick(screen.getByText('Synthetic'));expect(screen.queryByRole('textbox')).toBeNull();expect(screen.getByRole('tooltip').textContent).toBe('关闭筛选后可编辑或移动标签');fireEvent.keyDown(window,{key:'Escape'});fireEvent.doubleClick(screen.getByRole('button',{name:'Remove'}));expect(screen.queryByRole('tooltip')).toBeNull();expect(rename).not.toHaveBeenCalled();
});
