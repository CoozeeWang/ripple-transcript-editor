// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AIEditingNotice } from './AIEditingNotice';
import type { AIEditActivity } from '../lib/aiEditOwnership';
import { setInterfaceLanguage } from '../i18n';
afterEach(cleanup);
const task: AIEditActivity = { task_id: 'synthetic', client: 'chatgpt', key: 'synthetic', version: 'Synthetic v1', version_id: 'm:e', kind: 'marks', state: 'waiting', processed: 0, saved: 0, total: 3, touched: 0, inFlight: 0 };
it('shows a real stage and revokes the exact task from a keyboard-accessible action', () => {
  const end = vi.fn(async () => {});
  render(<AIEditingNotice activities={[task]} onEnd={end}/>);
  expect(screen.getByText(/ChatGPT 正在辅助编辑/)).toBeTruthy();
  expect(screen.getByText(/已保存 0 \/ 3/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '结束编辑' }));
  expect(end).toHaveBeenCalledWith('synthetic');
  expect(screen.queryByRole('progressbar')).toBeNull();
});
it('retains protection and End editing on failure; confirmed completion has a separate close action', () => {
  const dismiss = vi.fn(async () => {});
  const { rerender, container } = render(<AIEditingNotice activities={[{ ...task, state: 'failed' }]} onEnd={vi.fn()} onDismiss={dismiss}/>);
  expect(screen.getByText(/仍暂时只读/)).toBeTruthy();
  expect(screen.getByRole('button', { name: '结束编辑' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '关闭提示' })).toBeNull();
  rerender(<AIEditingNotice activities={[{ ...task, state: 'completed', saved: 3 }]} onEnd={vi.fn()} onDismiss={dismiss}/>);
  expect(screen.getByText(/3 \/ 3 个片段已保存/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
  expect(dismiss).toHaveBeenCalledWith('synthetic');
  rerender(<AIEditingNotice activities={[{ ...task, state: 'completed', saved: 3, dismissed: true }]} onEnd={vi.fn()}/>);
  expect(container.textContent).toBe('');
});
it('keeps a pending save protected after End and hides only after it settles', () => {
  const { rerender, container } = render(<AIEditingNotice activities={[{ ...task, state: 'ended', inFlight: 1, dismissed: true }]} onEnd={vi.fn()}/>);
  expect(screen.getByRole('button', { name: '正在结束…' })).toHaveProperty('disabled', true);
  rerender(<AIEditingNotice activities={[{ ...task, state: 'ended', inFlight: 0, dismissed: true }]} onEnd={vi.fn()}/>);
  expect(container.textContent).toBe('');
});
it('shows the latest saved WorkBuddy result instead of an earlier failed zero-count attempt', () => {
  const { rerender, container } = render(<AIEditingNotice activities={[
    { ...task, task_id: 'earlier', client: 'workbuddy', state: 'failed', total: 10 },
    { ...task, task_id: 'latest', client: 'workbuddy', state: 'completed', saved: 10, total: 10 },
  ]} onEnd={vi.fn()}/>);
  expect(screen.getByText('AI 编辑已完成，10 / 10 个片段已保存。')).toBeTruthy();
  expect(screen.queryByText(/遇到问题/)).toBeNull();
  expect(screen.queryByText(/保存 0 \/ 10/)).toBeNull();
  rerender(<AIEditingNotice activities={[
    { ...task, task_id: 'earlier', state: 'failed' },
    { ...task, task_id: 'latest', state: 'completed', saved: 10, total: 10, dismissed: true },
  ]} onEnd={vi.fn()}/>);
  expect(container.textContent).toBe('');
});
it('uses English task copy and preserves real saved counts', async () => {
  await setInterfaceLanguage('en');
  render(<AIEditingNotice activities={[{ ...task, state: 'saving', saved: 1 }]} onEnd={vi.fn()}/>);
  expect(screen.getByText(/temporarily read-only/)).toBeTruthy();
  expect(screen.getByText(/1 \/ 3 segments confirmed saved/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'End editing' })).toBeTruthy();
  await setInterfaceLanguage('zh-CN');
});
