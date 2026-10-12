// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {SpeakerNameInput} from './SpeakerNameInput';
import {flushEditorDrafts,hasEditorDrafts} from '../lib/editorDrafts';
afterEach(()=>{cleanup();vi.useRealTimers();});
it('keeps keystrokes local and flushes the final name at save boundaries',()=>{
 vi.useFakeTimers();const commit=vi.fn();render(<SpeakerNameInput value="Jane" label="Speaker" readOnly={false} onCommit={commit}/>);
 const input=screen.getByRole('textbox');
 fireEvent.change(input,{target:{value:'Janet'}});fireEvent.change(input,{target:{value:'Janette'}});
 expect((input as HTMLInputElement).value).toBe('Janette');expect(commit).not.toHaveBeenCalled();expect(hasEditorDrafts()).toBe(true);
 act(()=>flushEditorDrafts());expect(commit).toHaveBeenCalledTimes(1);expect(commit).toHaveBeenCalledWith('Janette');expect(hasEditorDrafts()).toBe(false);
});
it('does not commit incomplete IME composition and flushes on blur',()=>{
 vi.useFakeTimers();const commit=vi.fn();render(<SpeakerNameInput value="A" label="Speaker" readOnly={false} onCommit={commit}/>);
 const input=screen.getByRole('textbox');fireEvent.compositionStart(input);fireEvent.change(input,{target:{value:'合成'}});act(()=>vi.advanceTimersByTime(1000));expect(commit).not.toHaveBeenCalled();
 fireEvent.compositionEnd(input);fireEvent.blur(input);expect(commit).toHaveBeenCalledWith('合成');
});
