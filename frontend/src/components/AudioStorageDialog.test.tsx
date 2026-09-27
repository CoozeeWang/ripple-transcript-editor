// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AudioStorageDialog } from './AudioStorageDialog';
Object.assign(HTMLDialogElement.prototype, { showModal(this: HTMLDialogElement) { this.setAttribute('open', ''); } });
afterEach(() => { cleanup(); delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker; });
it('explains copy-only drops and gives a direct route to selecting referenceable originals', async () => {
  Object.assign(window, { showOpenFilePicker: vi.fn() });
  const finish=vi.fn(), selectReference=vi.fn(async()=>true);
  render(<AudioStorageDialog names={['A.wav']} referenceable={false} selectReference={selectReference} finish={finish}/>);
  expect((screen.getByRole('radio', {name:/引用原文件/}) as HTMLInputElement).disabled).toBe(true);
  expect(screen.getByText(/直接拖入音频只能复制到项目/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', {name:'选择原文件并引用'}));
  await waitFor(()=>expect(finish).toHaveBeenCalledWith('reference'));
  expect(selectReference).toHaveBeenCalledOnce();
});
it('keeps the choice open after cancellation or a mismatched file', async () => {
  Object.assign(window, { showOpenFilePicker: vi.fn() });
  const finish=vi.fn(), selectReference=vi.fn().mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('文件内容不一致'));
  render(<AudioStorageDialog names={['A.wav']} referenceable={false} selectReference={selectReference} finish={finish}/>);
  fireEvent.click(screen.getByRole('button',{name:'选择原文件并引用'}));
  await waitFor(()=>expect(selectReference).toHaveBeenCalledOnce());
  await waitFor(()=>expect(screen.getByRole('button',{name:'选择原文件并引用'}).hasAttribute('disabled')).toBe(false));
  expect(finish).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'选择原文件并引用'}));
  expect((await screen.findByRole('alert')).textContent).toBe('文件内容不一致');
  expect(finish).not.toHaveBeenCalled();
});
it('retains a clear fallback when file selection is unavailable',()=>{
  render(<AudioStorageDialog names={['A.wav']} referenceable={false} finish={vi.fn()}/>);
  expect(screen.getByText(/若要引用原文件/)).toBeTruthy();
  expect(screen.queryByRole('button',{name:'选择原文件并引用'})).toBeNull();
});
