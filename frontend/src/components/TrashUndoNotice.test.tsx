// @vitest-environment jsdom
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { act,cleanup,fireEvent,render,screen } from '@testing-library/react';
import { TrashUndoNotice } from './TrashUndoNotice';
beforeEach(()=>vi.useFakeTimers());
afterEach(()=>{cleanup();vi.useRealTimers();});
it('dismisses automatically after six seconds',()=>{
 const dismiss=vi.fn();render(<TrashUndoNotice busy={false} onUndo={()=>{}} onDismiss={dismiss}/>);
 act(()=>vi.advanceTimersByTime(5999));expect(dismiss).not.toHaveBeenCalled();
 act(()=>vi.advanceTimersByTime(1));expect(dismiss).toHaveBeenCalledOnce();
});
it('pauses while hovered or keyboard focused and resumes after leaving',()=>{
 const dismiss=vi.fn();render(<TrashUndoNotice busy={false} onUndo={()=>{}} onDismiss={dismiss}/>);
 fireEvent.mouseEnter(screen.getByRole('status'));act(()=>vi.advanceTimersByTime(10000));expect(dismiss).not.toHaveBeenCalled();
 fireEvent.mouseLeave(screen.getByRole('status'));fireEvent.focus(screen.getByText('撤销'));act(()=>vi.advanceTimersByTime(10000));expect(dismiss).not.toHaveBeenCalled();
 fireEvent.blur(screen.getByText('撤销'));act(()=>vi.advanceTimersByTime(6000));expect(dismiss).toHaveBeenCalledOnce();
});
it('dismisses on outside interactions without interfering with Undo',()=>{
 const dismiss=vi.fn(),undo=vi.fn();render(<><TrashUndoNotice busy={false} onUndo={undo} onDismiss={dismiss}/><button>其他功能</button></>);
 fireEvent.pointerDown(screen.getByText('撤销'));fireEvent.click(screen.getByText('撤销'));expect(undo).toHaveBeenCalledOnce();expect(dismiss).not.toHaveBeenCalled();
 fireEvent.pointerDown(screen.getByText('其他功能'));expect(dismiss).toHaveBeenCalledOnce();
});
