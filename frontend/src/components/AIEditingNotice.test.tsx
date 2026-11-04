// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AIEditingNotice } from './AIEditingNotice';
import type { AIEditActivity } from '../lib/aiEditOwnership';
import { msg, setInterfaceLanguage } from '../i18n';
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
it('retains protection and End editing on failure; confirmed completion disappears without a close action', () => {
  const dismiss = vi.fn(async () => {});
  const { rerender, container } = render(<AIEditingNotice activities={[{ ...task, state: 'failed' }]} onEnd={vi.fn()} onDismiss={dismiss}/>);
  expect(screen.getByText(/仍暂时只读/)).toBeTruthy();
  expect(screen.getByRole('button', { name: '结束编辑' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '关闭提示' })).toBeNull();
  rerender(<AIEditingNotice activities={[{ ...task, state: 'completed', saved: 3 }]} onEnd={vi.fn()} onDismiss={dismiss}/>);
  expect(container.textContent).toBe('');
  expect(dismiss).not.toHaveBeenCalled();
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
  expect(container.textContent).toBe('');
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

it.each([1, 2])('uses total %i for the English stage and completion plural, not the saved count', async total => {
  await setInterfaceLanguage('en');
  try {
    const { rerender } = render(<AIEditingNotice activities={[{ ...task, total, state: 'waiting', saved: 0 }]} onEnd={vi.fn()}/>);
    const noun = total === 1 ? 'segment' : 'segments';
    expect(screen.getByText(new RegExp(`Waiting for AI · 0 / ${total} ${noun} saved$`))).toBeTruthy();
    for (const state of ['processing', 'saving', 'paused'] as const) {
      rerender(<AIEditingNotice activities={[{ ...task, total, state, saved: 0, processed: 0 }]} onEnd={vi.fn()}/>);
      const prefix = state === 'processing' ? 'Processing · ' : state === 'saving' ? 'Saving · ' : '';
      expect(screen.getByText(new RegExp(`${prefix}0 / ${total} ${noun} ${state === 'processing' ? 'processed' : 'confirmed saved'}$`))).toBeTruthy();
    }
    rerender(<AIEditingNotice activities={[{ ...task, total, state: 'completed', saved: total }]} onEnd={vi.fn()}/>);
    expect(screen.queryByRole('status')).toBeNull();
  } finally { await setInterfaceLanguage('zh-CN'); }
});


it.each(['zh-CN','zh-TW','en'] as const)('explains permanent ending without requiring an extra confirmation in %s', async language => {
  await setInterfaceLanguage(language);
  try {
    render(<AIEditingNotice activities={[task]} onEnd={vi.fn()}/>);
    expect(screen.getByText(language==='en' ? /Ending retains saved changes/ : language==='zh-TW' ? /結束會保留已儲存內容/ : /结束会保留已保存内容/)).toBeTruthy();
  } finally { await setInterfaceLanguage('zh-CN'); }
});

it('immediately hides completed presentation without ending a task or deleting its record', () => {
  vi.useFakeTimers();
  try {
    const completed = { ...task, state: 'completed' as const, saved: 3 };
    const end = vi.fn(), dismiss = vi.fn();
    const { rerender, container } = render(<AIEditingNotice activities={[completed]} onEnd={end} onDismiss={dismiss}/>);
    expect(container.textContent).toBe('');
    act(() => vi.advanceTimersByTime(3999)); expect(container.textContent).toBe('');
    act(() => vi.advanceTimersByTime(1)); expect(container.textContent).toBe('');
    expect(completed).toMatchObject({ state: 'completed', saved: 3 });
    expect(end).not.toHaveBeenCalled(); expect(dismiss).not.toHaveBeenCalled();
    rerender(<AIEditingNotice activities={[{ ...completed, state: 'failed', touched: 1 }]} onEnd={end}/>);
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.getByRole('button', { name: '结束编辑' })).toBeTruthy();
  } finally { vi.useRealTimers(); }
});

it('retains the task and restores its action after a failed end request', async () => {
  await act(() => setInterfaceLanguage('zh-CN'));
  const end=vi.fn(async()=>{throw Error('synthetic_end_failure');});
  render(<AIEditingNotice activities={[task]} onEnd={end}/>);
  await act(async () => fireEvent.click(screen.getByRole('button',{name:'结束编辑'})));
  expect(end).toHaveBeenCalledWith(task.task_id);
  expect((screen.getByRole('button',{name:'结束编辑'}) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByRole('status').textContent).toContain('Synthetic v1');
});

it.each(['zh-CN','zh-TW','en'] as const)('keeps request progress and phase separate without claiming whole completion (%s)',async language=>{
 await setInterfaceLanguage(language);
 const current={...task,kind:'incremental' as const,state:'completed' as const,requestId:'request',requestStatus:'waiting' as const,requestComplete:false,saved:480,total:2312,phase:'proofreading' as const,proofreadSaved:240};
 const {rerender}=render(<AIEditingNotice activities={[current]} onEnd={vi.fn()}/>);
 expect(screen.getByRole('status').textContent).toContain('480 / 2312');
 expect(screen.getByRole('status').textContent).toContain(language==='en'?'waiting for continuation':language==='zh-TW'?'等待接續':'等待接续');
 expect(screen.getByRole('status').textContent).not.toMatch(/全文完成|Whole request completed/);
 rerender(<AIEditingNotice activities={[{...current,state:'failed',requestStatus:'editing'}]} onEnd={vi.fn()}/>);
 expect(screen.getByRole('status').textContent).toContain(language==='en'?'failed':language==='zh-TW'?'失敗':'失败');
 expect(screen.getByRole('status').textContent).not.toMatch(/正在编辑|正在編輯|^Editing/);
 await setInterfaceLanguage('zh-CN');
});

it.each(['zh-CN','zh-TW','en'] as const)('distinguishes a saved round from a completed request in %s',async language=>{
 await setInterfaceLanguage(language);
 try {
  const end=vi.fn(),dismiss=vi.fn();
  const current={...task,kind:'incremental' as const,state:'completed' as const,requestId:'request',requestStatus:'waiting' as const,requestComplete:false,saved:3,total:3};
  const {rerender,container}=render(<AIEditingNotice activities={[current]} onEnd={end} onDismiss={dismiss}/>);
  expect(screen.getByText(msg('aiEditing.roundSaved'))).toBeTruthy();
  expect(screen.getByText(msg('aiEditing.roundSavedHelp'))).toBeTruthy();
  expect(container.querySelector('.is-round-saved')).toBeTruthy();
  expect(container.querySelector('.is-completed')).toBeNull();
  await act(async()=>fireEvent.click(screen.getByRole('button',{name:msg('aiEditing.end')})));
  expect(end).toHaveBeenCalledWith(current.task_id);expect(dismiss).not.toHaveBeenCalled();
  rerender(<AIEditingNotice activities={[{...current,requestComplete:true,requestStatus:'range_completed'}]} onEnd={end} onDismiss={dismiss}/>);
  expect(container.textContent).toBe('');
  expect(screen.queryByRole('button',{name:msg('aiEditing.end')})).toBeNull();
  expect(dismiss).not.toHaveBeenCalled();
 } finally {await setInterfaceLanguage('zh-CN');}
});


it.each(['zh-CN','zh-TW','en'] as const)('keeps explicit cancellation failure, user stop and handoff priorities accurate (%s)',async language=>{
 await setInterfaceLanguage(language);
 const end=vi.fn(),dismiss=vi.fn();
 const current={...task,kind:'incremental' as const,state:'ended' as const,requestId:'request',requestStatus:'editing' as const,saved:480,total:2312,endedBy:'system'};
 const {rerender}=render(<AIEditingNotice activities={[{...current,reason:'failure'}]} onEnd={end} onDismiss={dismiss}/>);
 const headline=()=>screen.getByRole('status').firstElementChild!.textContent;
 expect(headline()).toBe(msg('aiEditing.request_failed'));
 expect(screen.getByRole('status').textContent).toContain('480 / 2312');
 fireEvent.click(screen.getByRole('button',{name:msg('aiEditing.end')}));
 expect(end).toHaveBeenCalledWith(current.task_id);expect(dismiss).not.toHaveBeenCalled();
 rerender(<AIEditingNotice activities={[{...current,reason:'user_cancelled',endedBy:'user',requestStatus:'failed'}]} onEnd={end}/>);
 expect(screen.queryByRole('status')).toBeNull();
 for(const reason of ['phase_transition','round_end','connection_lost']){
  rerender(<AIEditingNotice activities={[{...current,reason,endedBy:'ai'}]} onEnd={end}/>);
  expect(headline()).toBe(msg('aiEditing.request_waiting'));
 }
 await setInterfaceLanguage('zh-CN');
});

it.each(['zh-CN','zh-TW','en'] as const)('automatically removes a user stop only after the pending write settles (%s)',async language=>{
 await setInterfaceLanguage(language);
 try {const end=vi.fn(),dismiss=vi.fn();const stopped={...task,kind:'incremental' as const,state:'ended' as const,requestId:'synthetic-request',requestComplete:false,reason:'user_ended',inFlight:1};const view=render(<AIEditingNotice activities={[stopped]} onEnd={end} onDismiss={dismiss}/>);expect(screen.getByRole('button',{name:msg('aiEditing.endingAction')})).toHaveProperty('disabled',true);view.rerender(<AIEditingNotice activities={[{...stopped,inFlight:0}]} onEnd={end} onDismiss={dismiss}/>);expect(view.container.textContent).toBe('');expect(dismiss).not.toHaveBeenCalled();}finally{await setInterfaceLanguage('zh-CN');}
});
