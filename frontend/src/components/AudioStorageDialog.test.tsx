// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AudioStorageDialog } from './AudioStorageDialog';
Object.assign(HTMLDialogElement.prototype, { showModal(this: HTMLDialogElement) { this.setAttribute('open', ''); } });
afterEach(() => { cleanup(); delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker; });
it('opens the picker through the reference choice, then waits for Add audio', async () => {
  Object.assign(window, { showOpenFilePicker: vi.fn() });
  const finish=vi.fn(), selectReference=vi.fn(async()=>true);
  render(<AudioStorageDialog names={['A.wav']} referenceable={false} selectReference={selectReference} finish={finish}/>);
  const radio=screen.getByRole('radio', {name:/引用原文件/}) as HTMLInputElement;
  expect(radio.disabled).toBe(false);
  expect(screen.getByText(/重新选择刚才拖入的音频/).closest('label')).toBe(radio.closest('label'));
  expect(screen.queryByRole('button', {name:'选择原文件并引用'})).toBeNull();
  fireEvent.click(radio);
  await waitFor(()=>expect(radio.checked).toBe(true));
  expect(selectReference).toHaveBeenCalledOnce();
  expect(finish).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('radio',{name:/复制到项目/}));
  fireEvent.click(radio);
  expect(selectReference).toHaveBeenCalledOnce();
  expect(radio.checked).toBe(true);
  fireEvent.click(screen.getByRole('button', {name:'加入音频'}));
  expect(finish).toHaveBeenCalledWith('reference');
});
it('keeps the choice open after cancellation or a mismatched file', async () => {
  Object.assign(window, { showOpenFilePicker: vi.fn() });
  const finish=vi.fn(), selectReference=vi.fn().mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('文件内容不一致'));
  render(<AudioStorageDialog names={['A.wav']} referenceable={false} selectReference={selectReference} finish={finish}/>);
  const radio=screen.getByRole('radio',{name:/引用原文件/}) as HTMLInputElement;
  fireEvent.click(radio);
  await waitFor(()=>expect(selectReference).toHaveBeenCalledOnce());
  await waitFor(()=>expect(radio.disabled).toBe(false));
  expect(radio.checked).toBe(false);
  expect(finish).not.toHaveBeenCalled();
  fireEvent.click(radio);
  expect((await screen.findByRole('alert')).textContent).toBe('文件内容不一致');
  expect(screen.getByRole('alert').classList.contains('audio-storage-feedback')).toBe(true);
  expect(screen.getByRole('alert').classList.contains('form-error')).toBe(true);
  expect(radio.checked).toBe(false);
  expect(finish).not.toHaveBeenCalled();
});
it('retains a clear fallback when file selection is unavailable',()=>{
  render(<AudioStorageDialog names={['A.wav']} referenceable={false} finish={vi.fn()}/>);
  expect(screen.getByText(/请取消后点击虚线框选择原音频/)).toBeTruthy();
  expect((screen.getByRole('radio',{name:/引用原文件/}) as HTMLInputElement).disabled).toBe(true);
});
