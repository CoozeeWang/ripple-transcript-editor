// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {setInterfaceLanguage} from '../i18n';
import {ContinuationProgress} from './ContinuationProgress';
import type {ContinuationProgress as Progress} from '../lib/incrementalContinuation';
const task:Progress={task_id:'synthetic-task',state:'paused',reason:'batch_conflict_manual_changes_preserved',version:'Synthetic draft',version_id:'m:e1',saved_segments:24,total_segments:60,staged:24,held_batches:0,is_current:true};
afterEach(()=>{cleanup();setInterfaceLanguage('zh-CN');});
it('embeds only actionable recovery without a second progress summary or End control', () => {
  const action = vi.fn(async () => ({}));
  const { rerender, container } = render(<ContinuationProgress embedded tasks={[task]} error="" onAction={action}/>);
  expect(screen.getByRole('button', { name: '重读本批继续' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '查看待提交修改' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '结束编辑' })).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
  rerender(<ContinuationProgress embedded tasks={[{ ...task, state: 'draft', staged: 0 }]} error="" onAction={action}/>);
  expect(container.textContent).toBe('');
});
it.each(['zh-CN','en'] as const)('shows saved progress, recoverable proposals and scoped actions in %s',async language=>{
  await act(()=>setInterfaceLanguage(language));
  const action=vi.fn(async()=>({proposals:[{index:25,action:'edit',current_text:'Synthetic manual correction',after:'Synthetic AI proposal'}]}));
  render(<ContinuationProgress tasks={[task]} error="" onAction={action}/>);
  expect(screen.getByRole('status').textContent).toContain('24');
  fireEvent.click(screen.getByRole('button',{name:language==='en'?'View pending changes':'查看待提交修改'}));
  await screen.findByText('Synthetic manual correction');expect(screen.getByText('Synthetic AI proposal')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:language==='en'?'Re-read batch and continue':'重读本批继续'}));
  await waitFor(()=>expect(action).toHaveBeenCalledWith('resume','synthetic-task'));
});
it('does not call a target-version mismatch a manual conflict or allow writes there',()=>{
  const action=vi.fn();render(<ContinuationProgress tasks={[{...task,is_current:false}]} error="" onAction={action}/>);
  expect(screen.getByText('请打开此任务的目标版本后继续。')).toBeTruthy();
  const resume=screen.getByRole('button',{name:'重读本批继续'}) as HTMLButtonElement;
  expect(resume.disabled).toBe(true);fireEvent.click(resume);expect(action).not.toHaveBeenCalled();
});
it.each(['zh-CN','en'] as const)('labels an exact background target and permits its scoped recovery in %s',async language=>{
  await act(()=>setInterfaceLanguage(language));
  const action=vi.fn(async()=>({}));
  const project_target={project_id:'synthetic-project',project:'Synthetic project',interview_id:'session-b',interview:'Synthetic B',
    recording_id:'recording-b',recording:'Synthetic B manuscript',version_id:'m:e1',version:'Synthetic draft'};
  render(<ContinuationProgress tasks={[{...task,is_current:false,project_target}]} error="" onAction={action}/>);
  expect(screen.getByText('Synthetic B manuscript · Synthetic draft')).toBeTruthy();
  const resume=screen.getByRole('button',{name:language==='en'?'Re-read batch and continue':'重读本批继续'}) as HTMLButtonElement;
  expect(resume.disabled).toBe(false);fireEvent.click(resume);
  await waitFor(()=>expect(action).toHaveBeenCalledWith('resume','synthetic-task'));
});
it('reports an uncertain write as awaiting recovery rather than a content conflict',()=>{
  render(<ContinuationProgress tasks={[{...task,reason:'synthetic_disk_failure',saved_segments:0}]} error="" onAction={vi.fn()}/>);
  expect(screen.getByText(/本批尚未确认保存/)).toBeTruthy();expect(screen.queryByText(/本批内容已变化/)).toBeNull();
});
it('shows nothing when there are no tasks and no recovery error',()=>{
  const {container}=render(<ContinuationProgress tasks={[]} error="" onAction={vi.fn()}/>);expect(container.textContent).toBe('');
});

it('replaces historical completed tasks with one live progress row and updates it in place',()=>{
  const history=[1,2,3].map(n=>({...task,task_id:`done-${n}`,state:'completed' as const,staged:0,saved_segments:n,total_segments:n,updated:`2026-01-0${n}`}));
  const live={...task,task_id:'live',state:'draft' as const,saved_batches:1,batch_number:2,updated:'2026-01-01'};
  const {rerender}=render(<ContinuationProgress tasks={[live,...history]} error="" onAction={vi.fn()}/>);
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.getByRole('status').textContent).toContain('第 2 批');
  expect(screen.getByRole('button',{name:'结束编辑'})).toBeTruthy();
  expect(screen.queryByText('编辑已完成，全部批次已保存。')).toBeNull();
  rerender(<ContinuationProgress tasks={[...history,{...live,saved_segments:48,saved_batches:2,batch_number:3}]} error="" onAction={vi.fn()}/>);
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.getByRole('status').textContent).toContain('第 3 批');
  expect(screen.getByRole('status').textContent).toContain('48／60');
});
it('uses the newest current completed task and keeps cancelled history hidden',()=>{
  const completed={...task,state:'completed' as const,staged:0,saved_batches:3,saved_segments:60};
  render(<ContinuationProgress tasks={[{...completed,task_id:'old',version:'Old completed',updated:'2026-01-01'},
    {...completed,task_id:'latest',version:'Latest completed',updated:'2026-01-02'},
    {...completed,task_id:'cancelled',state:'cancelled',version:'Cancelled',updated:'2026-01-03'}]} error="" onAction={vi.fn()}/>);
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.getByText('Latest completed')).toBeTruthy();
  expect(screen.queryByText('Old completed')).toBeNull();expect(screen.queryByText('Cancelled')).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('已保存 3 批');
  expect(screen.queryByRole('button',{name:'结束编辑'})).toBeNull();
});
it('prioritizes current recoverable work and never guesses an old journal batch count',()=>{
  render(<ContinuationProgress tasks={[{...task,task_id:'other',is_current:false,version:'Other version',updated:'2026-01-03'},
    {...task,version:'Current paused',updated:'2026-01-01'}]} error="" onAction={vi.fn()}/>);
  expect(screen.getByText('Current paused')).toBeTruthy();expect(screen.queryByText('Other version')).toBeNull();
  expect(screen.getByRole('status').textContent).toBe('已保存 24／60 个片段');
});
it('retains actionable refresh errors even without a visible task',()=>{
  render(<ContinuationProgress tasks={[{...task,state:'cancelled'}]} error="synthetic_failure" onAction={vi.fn()}/>);
  expect(screen.getByRole('alert').textContent).toContain('无法更新编辑进度');
  expect(screen.getByRole('button',{name:'刷新进度'})).toBeTruthy();
});
it('prevents pending proposals from another task or version remaining visible',async()=>{
  const action=vi.fn(async()=>({proposals:[{index:25,action:'edit',current_text:'Synthetic current',after:'Synthetic proposal'}]}));
  const {rerender}=render(<ContinuationProgress tasks={[task]} error="" onAction={action}/>);
  fireEvent.click(screen.getByRole('button',{name:'查看待提交修改'}));await screen.findByText('Synthetic proposal');
  rerender(<ContinuationProgress tasks={[{...task,is_current:false}]} error="" onAction={action}/>);
  expect(screen.queryByText('Synthetic proposal')).toBeNull();
});
it('disables task actions until an in-flight operation settles',async()=>{
  let done!:()=>void;const action=vi.fn(()=>new Promise<void>(resolve=>{done=resolve;}));
  render(<ContinuationProgress tasks={[{...task,state:'draft'}]} error="" onAction={action}/>);
  fireEvent.click(screen.getByRole('button',{name:'暂停'}));
  expect((screen.getByRole('button',{name:'结束编辑'}) as HTMLButtonElement).disabled).toBe(true);
  await act(async()=>done());
  expect((screen.getByRole('button',{name:'结束编辑'}) as HTMLButtonElement).disabled).toBe(false);
});
it('does not carry a completed task into another manuscript version',()=>{
  const {container}=render(<ContinuationProgress tasks={[{...task,state:'completed',is_current:false,staged:0}]} error="" onAction={vi.fn()}/>);
  expect(container.textContent).toBe('');
});
it('hides completed history locally without cancelling or deleting saved journals; new recovery remains visible', () => {
  const action = vi.fn();
  const completed = { ...task, state: 'completed' as const, staged: 0 };
  const { rerender, container } = render(<ContinuationProgress tasks={[completed]} error="" onAction={action}/>);
  fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
  expect(container.textContent).toBe('');
  expect(action).not.toHaveBeenCalled();
  expect(completed.saved_segments).toBe(24);
  rerender(<ContinuationProgress tasks={[completed, { ...task, task_id: 'new-recovery' }]} error="" onAction={action}/>);
  expect(screen.getByRole('button', { name: '重读本批继续' })).toBeTruthy();
});

it.each(['zh-CN', 'en'] as const)('shows reason-specific recovery inside the real embedded notice in %s', async language => {
  const { AIEditingNotice } = await import('./AIEditingNotice');
  await act(() => setInterfaceLanguage(language));
  const activity = { task_id: task.task_id, client: 'chatgpt', key: 'synthetic', version: task.version, version_id: task.version_id,
    kind: 'incremental' as const, state: 'paused' as const, processed: 24, saved: 24, total: 60, touched: 0, inFlight: 0 };
  const action = vi.fn(async () => ({})), end = vi.fn(async () => ({}));
  const content = (reason: string) => <AIEditingNotice activities={[{ ...activity, reason }]} onEnd={end}>
    <ContinuationProgress embedded tasks={[{ ...task, reason }]} error="" onAction={action}/>
  </AIEditingNotice>;
  const { rerender } = render(content('planned_segment_changed'));
  expect(screen.getByText(language === 'en'
    ? 'The remaining segment structure has changed. End this task and agree on a new editing range in your AI conversation. Saved batches are retained.'
    : '未处理的片段结构已变化。请结束此任务，再在 AI 对话中确认新的编辑范围；已保存的批次仍保留。')).toBeTruthy();
  expect(screen.queryByRole('button', { name: language === 'en' ? 'Re-read batch and continue' : '重读本批继续' })).toBeNull();
  expect(screen.queryByText(/Resume the task|可继续任务/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: language === 'en' ? 'End editing' : '结束编辑' }));
  await waitFor(() => expect(end).toHaveBeenCalledWith(task.task_id));
  for (const reason of ['user_paused', 'batch_conflict_manual_changes_preserved', 'synthetic_disk_failure']) {
    rerender(content(reason));
    expect(screen.getByRole('button', { name: language === 'en' ? 'Re-read batch and continue' : '重读本批继续' })).toBeTruthy();
    const selector = reason === 'user_paused' ? /Completed batches remain|完成的批次仍保留/ : reason.startsWith('batch_conflict') ? /pending AI proposals are retained|AI 待提交结果均已保留/ : /not been confirmed saved|本批尚未确认保存/;
    expect(screen.getByText(selector)).toBeTruthy();
  }
});

it('shows the approved Taiwan pause reason without offering resume for changed scope', async () => {
  const { AIEditingNotice } = await import('./AIEditingNotice');
  await act(() => setInterfaceLanguage('zh-TW'));
  render(<AIEditingNotice activities={[{ task_id: task.task_id, client: 'chatgpt', key: 'synthetic', version: task.version, version_id: task.version_id,
    kind: 'incremental', state: 'paused', reason: 'planned_segment_changed', processed: 24, saved: 24, total: 60, touched: 0, inFlight: 0 }]} onEnd={vi.fn()}>
    <ContinuationProgress embedded tasks={[{ ...task, reason: 'planned_segment_changed' }]} error="" onAction={vi.fn()}/>
  </AIEditingNotice>);
  expect(screen.getByText(/暫停原因與後續處理說明/)).toBeTruthy();
  expect(screen.getByText(/尚未處理的片段結構已變更/)).toBeTruthy();
  expect(screen.getByRole('button', { name: '結束編輯' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /繼續/ })).toBeNull();
});
