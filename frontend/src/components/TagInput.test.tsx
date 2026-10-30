// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {TagInput} from './TagInput';
beforeEach(()=>vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}}));
afterEach(()=>{cleanup();vi.unstubAllGlobals()});
it('leaves IME candidates alone, then commits plain names on Enter/Space',()=>{const commit=vi.fn(),cancel=vi.fn();render(<TagInput onCommit={commit} onCancel={cancel}/>);const input=screen.getByRole('combobox');expect(input.getAttribute('placeholder')).toBeNull();expect(screen.queryByRole('button')).toBeNull();fireEvent.change(input,{target:{value:'待整理'}});fireEvent.compositionStart(input);fireEvent.keyDown(input,{key:'Enter'});fireEvent.keyDown(input,{key:' '});expect(commit).not.toHaveBeenCalled();fireEvent.compositionEnd(input);fireEvent.keyDown(input,{key:'Enter',keyCode:229});expect(commit).not.toHaveBeenCalled();fireEvent.keyDown(input,{key:'Enter'});expect(commit).toHaveBeenCalledWith('待整理');fireEvent.keyDown(input,{key:' '});expect(commit).toHaveBeenLastCalledWith('待整理')});
it('cancels unsubmitted names on blur or Escape, including composition blur',()=>{const commit=vi.fn(),cancel=vi.fn();render(<TagInput onCommit={commit} onCancel={cancel}/>);const input=screen.getByRole('combobox');fireEvent.change(input,{target:{value:'未提交'}});fireEvent.keyDown(input,{key:'Escape'});expect(cancel).toHaveBeenCalledTimes(1);fireEvent.compositionStart(input);fireEvent.blur(input);expect(cancel).toHaveBeenCalledTimes(2);expect(commit).not.toHaveBeenCalled()});
const available=[{id:'a',name:'Topic existing',groupIds:[]},{id:'b',name:'Other topic',groupIds:[]},{id:'c',name:'Already topic',groupIds:[]}];
it('uses highlighted suggestions on Enter, plain input on Space, and protects IME candidates',()=>{
 const commit=vi.fn();render(<TagInput availableTags={available} assignedIds={['c']} onCommit={commit} onCancel={()=>{}}/>);const input=screen.getByRole('combobox');
 fireEvent.change(input,{target:{value:'topic'}});expect(screen.getAllByRole('option').map(option=>option.textContent)).toEqual(['Topic existing','Other topic']);
 fireEvent.keyDown(input,{key:'ArrowDown'});expect(input.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[0].id);
 fireEvent.compositionStart(input);fireEvent.keyDown(input,{key:'Enter'});fireEvent.keyDown(input,{key:' '});expect(commit).not.toHaveBeenCalled();fireEvent.compositionEnd(input);
 fireEvent.keyDown(input,{key:'Enter'});expect(commit).toHaveBeenLastCalledWith('Topic existing');fireEvent.keyDown(input,{key:' '});expect(commit).toHaveBeenLastCalledWith('topic');
});
it('keeps focus on pointer selection so blur does not discard a valid existing tag',()=>{
 const commit=vi.fn(),cancel=vi.fn();render(<TagInput availableTags={available} onCommit={commit} onCancel={cancel}/>);const input=screen.getByRole('combobox');fireEvent.change(input,{target:{value:'existing'}});
 const option=screen.getByRole('option');const press=new MouseEvent('pointerdown',{bubbles:true,cancelable:true});fireEvent(option,press);expect(press.defaultPrevented).toBe(true);expect(document.activeElement).toBe(input);fireEvent.click(option);expect(commit).toHaveBeenCalledWith('Topic existing');expect(cancel).not.toHaveBeenCalled();
});
it('does not leak candidates between project libraries, and empty/no-match input creates only on explicit commit',()=>{
 const commit=vi.fn(),cancel=vi.fn();const view=render(<TagInput availableTags={available} onCommit={commit} onCancel={cancel}/>);const input=screen.getByRole('combobox');expect(screen.queryByRole('listbox')).toBeNull();fireEvent.change(input,{target:{value:'topic'}});
 view.rerender(<TagInput availableTags={[{id:'new-project',name:'Topic from second project',groupIds:[]}]} onCommit={commit} onCancel={cancel}/>);expect(screen.getAllByRole('option').map(option=>option.textContent)).toEqual(['Topic from second project']);
 fireEvent.change(input,{target:{value:'new label'}});expect(screen.queryByRole('listbox')).toBeNull();fireEvent.blur(input);expect(commit).not.toHaveBeenCalled();fireEvent.keyDown(input,{key:'Enter'});expect(commit).toHaveBeenCalledWith('new label');
});
