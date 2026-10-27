// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CopyProblem } from './CopyProblem';
import { ProcessNotice } from './ProcessNotice';
import { recordProblem } from '../lib/diagnostics';

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.useRealTimers(); });
function clipboard() {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText}});
  vi.useFakeTimers();
  return writeText;
}
const copy = async (name = '复制错误详情') => {
  await act(async () => fireEvent.click(screen.getByRole('button', {name})));
};

it('confirms success in the same enabled button, announces it, and restarts the timer on repeat', async () => {
  const writeText = clipboard();
  render(<CopyProblem problem={recordProblem('save')} />);
  const button = screen.getByRole('button', {name: '复制错误详情'});
  await copy();
  expect(screen.getByRole('button', {name: '已复制'})).toBe(button);
  expect(button.textContent).toContain('✓ 已复制');
  expect(screen.getByRole('status').textContent).toBe('已复制');
  expect(screen.getByRole('status').className).toBe('diagnostic-copy-announcement');
  expect(screen.getAllByRole('button')).toHaveLength(1);
  act(() => vi.advanceTimersByTime(3000));
  await copy('已复制');
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByRole('button', {name: '已复制'})).toBe(button);
  act(() => vi.advanceTimersByTime(3000));
  expect(screen.getByRole('button', {name: '复制错误详情'})).toBe(button);
  expect(screen.getByRole('status').textContent).toBe('');
  expect(writeText).toHaveBeenCalledTimes(2);
});

it('does not let an earlier success timer erase a new clipboard failure', async () => {
  const writeText = clipboard();
  render(<CopyProblem problem={recordProblem('save')} />);
  await copy();
  act(() => vi.advanceTimersByTime(3000));
  writeText.mockRejectedValueOnce(new Error('synthetic clipboard denied'));
  await copy('已复制');
  act(() => vi.advanceTimersByTime(10000));
  expect(screen.getByRole('alert').textContent).toContain('复制失败');
  expect(screen.getByRole('button', {name: '复制错误详情'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button', {name: '关闭提示'}));
  expect(screen.queryByRole('alert')).toBeNull();
});

it('retains missing-record feedback until it is dismissed without writing to the clipboard', async () => {
  const writeText = clipboard();
  render(<CopyProblem />);
  await copy();
  act(() => vi.advanceTimersByTime(10000));
  expect(screen.getByRole('status').className).toBe('diagnostic-copy-feedback');
  expect(screen.getByRole('status').textContent).not.toBe('');
  expect(writeText).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', {name: '关闭提示'}));
  expect(screen.getByRole('status').textContent).toBe('');
});

it('keeps icon mode compact with an accessible name and an in-place check', async () => {
  clipboard();
  render(<CopyProblem problem={recordProblem('save')} iconOnly />);
  const button = screen.getByRole('button', {name: '复制错误详情'});
  expect(button.querySelector('svg')).not.toBeNull();
  await copy();
  expect(button.querySelector('svg')).toBeNull();
  expect(button.querySelector('.diagnostic-copy-check')?.textContent).toBe('✓');
  expect(button.querySelector('.diagnostic-copy-labels')).toBeNull();
  expect(screen.getByRole('status').textContent).toBe('已复制');
  expect(screen.getAllByRole('button')).toHaveLength(1);
  act(() => vi.advanceTimersByTime(4000));
  expect(button.querySelector('svg')).not.toBeNull();
});

it('preserves the error-card dismiss action after copying', async () => {
  clipboard();
  recordProblem('transcription');
  const dismiss = vi.fn();
  render(<ProcessNotice card status="error" text="Synthetic failure" phase="processing" ratio={0} hint="" raw="" onDismiss={dismiss} cancelTranscription={vi.fn()} setTranscriptionDialogOpen={vi.fn()} setSaveToast={vi.fn()} />);
  await copy();
  expect(screen.getAllByRole('button')).toHaveLength(3);
  fireEvent.click(screen.getByRole('button', {name: '关闭提示'}));
  expect(dismiss).toHaveBeenCalledOnce();
});
