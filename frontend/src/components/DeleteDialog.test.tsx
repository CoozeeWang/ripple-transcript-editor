// @vitest-environment jsdom
import { createRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DeleteDialog } from './Dialogs';
afterEach(cleanup);
it('names the confirmation, focuses Cancel and returns to its opener without deleting',()=>{
 const opener=document.createElement('button');document.body.append(opener);opener.focus();
 const confirm=vi.fn(),setPrompt=vi.fn();
 const {unmount}=render(<DeleteDialog prompt={{kind:'edit',modelId:'m1',editId:'e1',label:'校订稿',isLast:false}} dialogRef={createRef()} setPrompt={setPrompt} confirmDelete={confirm}/>);
 expect(screen.getByRole('dialog',{name:'永久删除「校订稿」？'})).toBeTruthy();
 const cancel=screen.getByRole('button',{name:'取消'});expect(document.activeElement).toBe(cancel);
 fireEvent.click(cancel);expect(setPrompt).toHaveBeenCalledWith(null);expect(confirm).not.toHaveBeenCalled();
 unmount();expect(document.activeElement).toBe(opener);opener.remove();
});
