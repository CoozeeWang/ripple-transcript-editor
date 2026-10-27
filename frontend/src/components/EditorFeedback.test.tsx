// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LoadErrorNotice, SaveToastNotice } from './EditorFeedback';
import { ProcessingNotice } from './ProcessingNotice';
afterEach(cleanup);
it('keeps load-error text separate from its right-hand copy and close actions', () => {
  const close = vi.fn(); render(<LoadErrorNotice text="Synthetic long error" onDismiss={close}/>);
  const notice = screen.getByRole('alert');
  expect(notice.querySelector('.notice-row__message')?.textContent).toBe('Synthetic long error');
  fireEvent.click(within(notice).getByRole('button', { name: '关闭提示' }));
  expect(close).toHaveBeenCalledOnce();
});
it.each(['ok', 'error'] as const)('allows manual dismissal of %s save feedback', kind => {
  const close = vi.fn(); render(<SaveToastNotice toast={{ kind, text: 'Synthetic save result' }} onDismiss={close}/>);
  const notice = screen.getByRole(kind === 'ok' ? 'status' : 'alert');
  fireEvent.click(within(notice).getByRole('button', { name: '关闭提示' }));
  expect(close).toHaveBeenCalledOnce();
});
it('makes completed project feedback dismissible without adding a cancel action to progress', () => {
  const close = vi.fn(); const { rerender } = render(<ProcessingNotice>Saving…</ProcessingNotice>);
  expect(screen.queryByRole('button')).toBeNull();
  rerender(<ProcessingNotice onDismiss={close}>Saved</ProcessingNotice>);
  fireEvent.click(screen.getByRole('button', { name: '关闭提示' })); expect(close).toHaveBeenCalledOnce();
});
