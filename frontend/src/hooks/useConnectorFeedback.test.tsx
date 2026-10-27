// @vitest-environment jsdom
import {act, cleanup, fireEvent, render, renderHook, screen, waitFor} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {AIConnectorProvider} from '../components/AIConnectorProvider';
import {ContinuationProgress} from '../components/ContinuationProgress';
import {useAIConnector, useAIConnectorRuntime} from './useAIConnector';
import type {ConnectorHost} from '../lib/aiConnector';
const mock = vi.hoisted(() => ({handle: vi.fn(), warn: undefined as undefined | ((scope:string, count:number)=>void)}));
vi.mock('../lib/projectAIConnector', () => ({ProjectAIConnector: class {
  editing = {endAll: vi.fn(), values: () => []};
  handle = mock.handle;
  constructor(host:{continuationWarning:(scope:string,count:number)=>void}) { mock.warn=host.continuationWarning; }
}}));
const host = {} as ConnectorHost;
afterEach(() => { cleanup(); mock.handle.mockReset(); localStorage.clear(); });
const setup = () => {
  mock.handle.mockResolvedValue({});
  return renderHook(({context}) => useAIConnectorRuntime(host, context), {initialProps:{context:'editor-A'}});
};
it('clears a page-local error when leaving its editor without ending tasks', async () => {
  const ui=setup();
  mock.handle.mockRejectedValueOnce(Error('synthetic_failure'));
  await act(async () => { await ui.result.current.taskAction('tasks').catch(()=>{}); });
  expect(ui.result.current.taskError).toBe('synthetic_failure');
  ui.rerender({context:''});
  expect(ui.result.current.taskError).toBe('');
});
it('rejects a late error from a previous page while letting its operation settle', async () => {
  const ui=setup(); let reject!:(error:Error)=>void;
  mock.handle.mockImplementationOnce(() => new Promise((_, fail) => { reject=fail; }));
  let action!:Promise<unknown>;
  act(() => { action=ui.result.current.taskAction('tasks').catch(()=>{}); });
  ui.rerender({context:'editor-B'});
  await act(async () => { reject(Error('synthetic_old_failure')); await action; });
  expect(ui.result.current.taskError).toBe('');
});
it('does not let an old success clear a new page error', async () => {
  const ui=setup(); let finish!:(value:object)=>void;
  mock.handle.mockImplementationOnce(() => new Promise(resolve => {finish=resolve;}));
  let old!:Promise<unknown>;
  act(() => { old=ui.result.current.taskAction('tasks'); });
  ui.rerender({context:'editor-B'});
  await waitFor(() => expect(mock.handle).toHaveBeenCalledTimes(3));
  mock.handle.mockRejectedValueOnce(Error('synthetic_new_failure'));
  await act(async () => { await ui.result.current.taskAction('tasks').catch(()=>{}); });
  await act(async () => { finish({saved:true}); await old; });
  expect(ui.result.current.taskError).toBe('synthetic_new_failure');
});
it('keeps recovery warnings independent of page errors and their dismissal', async () => {
  const ui=setup();
  act(() => mock.warn?.('synthetic-journal', 1));
  mock.handle.mockRejectedValueOnce(Error('synthetic_refresh_failure'));
  await act(async () => {await ui.result.current.taskAction('tasks').catch(()=>{});});
  expect(ui.result.current.taskError).toBe('synthetic_refresh_failure');
  act(() => ui.result.current.dismissTaskError());
  expect(ui.result.current.taskError).toBe('continuation_journal_unreadable');
  ui.rerender({context:''});
  expect(ui.result.current.recoveryWarning).toBe('continuation_journal_unreadable');
  expect(ui.result.current.taskError).toBe('continuation_journal_unreadable');
});

it('removes the actual provider/editor error when navigating to projects, with recovery retained', async () => {
  mock.handle.mockResolvedValue({});
  function Editor() {
    const connector=useAIConnector(host,'synthetic-editor');
    return <><button onClick={()=>void connector.taskAction('tasks').catch(()=>{})}>Synthetic refresh</button>
      <ContinuationProgress embedded tasks={connector.tasks} error={connector.taskError} onAction={connector.taskAction} onDismissError={connector.dismissTaskError}/></>;
  }
  const ui=render(<AIConnectorProvider><Editor/></AIConnectorProvider>);
  mock.handle.mockRejectedValueOnce(Error('synthetic_progress_failure'));
  await act(async () => fireEvent.click(screen.getByText('Synthetic refresh')));
  expect(ui.container.querySelector('.continuation-progress-error')).not.toBeNull();
  ui.rerender(<AIConnectorProvider><main>Synthetic project page</main></AIConnectorProvider>);
  expect(ui.container.querySelector('.continuation-progress-error')).toBeNull();
  act(() => mock.warn?.('synthetic-project-journal',1));
  expect(ui.container.querySelector('.continuation-progress-error')?.textContent).toContain('其他任务仍可使用');
});

it('does not resurrect a dismissed query error when its pending refresh fails', async () => {
  const ui=setup(); let reject!:(error:Error)=>void;
  mock.handle.mockImplementationOnce(() => new Promise((_,fail)=>{reject=fail;}));
  let action!:Promise<unknown>;
  act(() => { action=ui.result.current.taskAction('tasks').catch(()=>{}); });
  act(() => ui.result.current.dismissTaskError());
  await act(async () => {reject(Error('synthetic_late_refresh_failure')); await action;});
  expect(ui.result.current.taskError).toBe('');
});
it('distinguishes background task action failures from page-local query failures', async () => {
  const ui=setup();
  mock.handle.mockRejectedValueOnce(Error('synthetic_end_failure'));
  await act(async () => {await ui.result.current.taskAction('end_editing','synthetic-task').catch(()=>{});});
  expect(ui.result.current.taskActionError).toBe('synthetic_end_failure');
  act(() => ui.result.current.dismissTaskError());
  expect(ui.result.current.taskActionError).toBe('');
});

it('retains a failed refresh initiated from a background-task error notice', async () => {
  const ui=setup();
  mock.handle.mockRejectedValueOnce(Error('synthetic_background_refresh_failure'));
  await act(async () => {await ui.result.current.taskAction('tasks',undefined,true).catch(()=>{});});
  expect(ui.result.current.taskActionError).toBe('synthetic_background_refresh_failure');
});
