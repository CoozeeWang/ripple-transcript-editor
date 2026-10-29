// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SegmentMergeDialog } from './SegmentMergeDialog';
beforeEach(()=>{HTMLDialogElement.prototype.showModal=vi.fn();});
afterEach(cleanup);
it('defaults to cancellation, supports Escape, and restores the opener',()=>{
  const opener=document.createElement('button');document.body.append(opener);opener.focus();
  const cancel=vi.fn(),confirm=vi.fn();const ui=render(<SegmentMergeDialog changed={false} readOnly={false} onCancel={cancel} onConfirm={confirm}/>);
  const dialog=screen.getByRole('dialog',{hidden:true});expect(document.activeElement).toBe(screen.getByText('不合并'));
  fireEvent(dialog,new Event('cancel',{cancelable:true}));expect(cancel).toHaveBeenCalledOnce();expect(confirm).not.toHaveBeenCalled();
  ui.unmount();expect(document.activeElement).toBe(opener);opener.remove();
});
it.each([{changed:true,readOnly:false},{changed:false,readOnly:true}])('disables confirmation if unavailable: %o',props=>{
  const confirm=vi.fn();render(<SegmentMergeDialog {...props} onCancel={vi.fn()} onConfirm={confirm}/>);
  fireEvent.click(screen.getByText('合并'));expect(confirm).not.toHaveBeenCalled();expect(screen.getByRole('alert',{hidden:true})).toBeTruthy();
});
