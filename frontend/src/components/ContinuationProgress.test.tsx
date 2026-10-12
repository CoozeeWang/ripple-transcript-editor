// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {setInterfaceLanguage} from '../i18n';
import {ContinuationProgress} from './ContinuationProgress';
import type {ContinuationProgress as Progress} from '../lib/incrementalContinuation';
const task:Progress={task_id:'synthetic-task',state:'paused',reason:'batch_conflict_manual_changes_preserved',version:'Synthetic draft',version_id:'m:e1',saved_segments:24,total_segments:60,staged:24,held_batches:0,is_current:true};
afterEach(()=>{cleanup();setInterfaceLanguage('zh-CN');});
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
it('reports an uncertain write as awaiting recovery rather than a content conflict',()=>{
  render(<ContinuationProgress tasks={[{...task,reason:'synthetic_disk_failure',saved_segments:0}]} error="" onAction={vi.fn()}/>);
  expect(screen.getByText(/本批尚未确认保存/)).toBeTruthy();expect(screen.queryByText(/本批内容已变化/)).toBeNull();
});
it('shows nothing when there are no tasks and no recovery error',()=>{
  const {container}=render(<ContinuationProgress tasks={[]} error="" onAction={vi.fn()}/>);expect(container.textContent).toBe('');
});
