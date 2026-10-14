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
it('keeps uncertain failures actionable and hides completed tasks without deleting their records', () => {
  const { rerender, container } = render(<AIEditingNotice activities={[{ ...task, state: 'failed' }]} onEnd={vi.fn()}/>);
  expect(screen.getByText(/避免重复提交/)).toBeTruthy();
  rerender(<AIEditingNotice activities={[{ ...task, state: 'completed' }]} onEnd={vi.fn()}/>);
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
