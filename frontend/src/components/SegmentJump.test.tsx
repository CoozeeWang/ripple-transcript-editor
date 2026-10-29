// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SegmentJump } from './SegmentJump';
import { msg, setInterfaceLanguage } from '../i18n';
afterEach(async()=>{cleanup();vi.restoreAllMocks();await setInterfaceLanguage('zh-CN');});
it.each(['zh-CN','zh-TW','en'] as const)('offers only a localized text field and jumps on Enter in %s',async language=>{
  await act(()=>setInterfaceLanguage(language));const jump=vi.fn();render(<SegmentJump count={1062} onJump={jump}/>);
  const input=screen.getByRole('textbox',{name:msg('segmentJump.inputLabel',{count:1062})});
  expect(screen.queryByRole('button')).toBeNull();expect(screen.getByText(msg('segmentJump.label'))).toBeTruthy();
  fireEvent.change(input,{target:{value:'200'}});expect(jump).not.toHaveBeenCalled();
  fireEvent.keyDown(input,{key:'Enter'});expect(jump).toHaveBeenCalledExactlyOnceWith(200);expect((input as HTMLInputElement).value).toBe('');
});
it.each(['','0','1063','-1','2.5','1e2','200x'])('rejects invalid number %s and retains the field value',value=>{
  const jump=vi.fn();render(<SegmentJump count={1062} onJump={jump}/>);const input=screen.getByRole('textbox') as HTMLInputElement;
  const report=vi.spyOn(input,'reportValidity');fireEvent.change(input,{target:{value}});fireEvent.keyDown(input,{key:'Enter'});
  expect(jump).not.toHaveBeenCalled();expect(report).toHaveBeenCalledOnce();expect(input.validationMessage).toBe(msg('segmentJump.invalid',{count:1062}));expect(input.value).toBe(value);
  fireEvent.change(input,{target:{value:'201'}});expect(input.validationMessage).toBe('');
});
it('ignores IME confirmation and clears Escape without jumping',()=>{
  const jump=vi.fn();render(<SegmentJump count={1062} onJump={jump}/>);const input=screen.getByRole('textbox');
  fireEvent.change(input,{target:{value:'200'}});fireEvent.keyDown(input,{key:'Enter',isComposing:true});fireEvent.keyDown(input,{key:'Enter',keyCode:229});expect(jump).not.toHaveBeenCalled();
  fireEvent.keyDown(input,{key:'Escape'});expect((input as HTMLInputElement).value).toBe('');expect(jump).not.toHaveBeenCalled();
});
it('uses the latest version count and disables an empty manuscript',()=>{
  const jump=vi.fn();const ui=render(<SegmentJump count={1062} onJump={jump}/>);const input=screen.getByRole('textbox');fireEvent.change(input,{target:{value:'200'}});
  ui.rerender(<SegmentJump count={100} onJump={jump}/>);fireEvent.keyDown(input,{key:'Enter'});expect(jump).not.toHaveBeenCalled();
  ui.rerender(<SegmentJump count={0} onJump={jump}/>);expect((input as HTMLInputElement).disabled).toBe(true);
});
