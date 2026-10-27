// @vitest-environment jsdom
import {useContext, useLayoutEffect} from 'react';
import {ConnectorContext} from '../hooks/connectorContext';
import {cleanup, render, screen} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {AIConnectorProvider} from './AIConnectorProvider';
import type {AIEditActivity} from '../lib/aiEditOwnership';
const runtime = vi.hoisted(() => ({ activities: [] as AIEditActivity[], tasks: [], taskError: '', taskActionError: '', dismissTaskError: vi.fn(), recoveryWarning: '', recoveryProjectIds: ['synthetic-A'], taskAction: vi.fn() }));
vi.mock('../hooks/useAIConnector', () => ({useAIConnectorRuntime: () => runtime}));
afterEach(() => { cleanup(); runtime.activities=[]; runtime.taskError=''; runtime.taskActionError=''; runtime.recoveryWarning=''; vi.clearAllMocks(); });
const task: AIEditActivity={task_id:'synthetic',client:'chatgpt',key:'synthetic',version:'Synthetic version',version_id:'v1',kind:'incremental',processed:3,touched:0,state:'completed',saved:3,total:3,inFlight:0};
it.each(['Project page','Welcome page'])('hides completed results outside the editor on %s without dismissing tasks', (page) => {
 runtime.activities=[task];
 const ui=render(<AIConnectorProvider><main>{page}</main></AIConnectorProvider>);
 expect(screen.getByText(page)).toBeTruthy();
 expect(ui.container.querySelector('.ai-editing-region')).toBeNull();
 expect(runtime.activities).toEqual([task]);
 expect(runtime.taskAction).not.toHaveBeenCalled();
});
it('keeps live background tasks visible and hides them upon completion', () => {
 runtime.activities=[{...task,state:'waiting'}];
 const ui=render(<AIConnectorProvider><main>Project</main></AIConnectorProvider>);
 expect(ui.container.querySelector('.ai-editing-region')).not.toBeNull();
 runtime.activities=[task];
 ui.rerender(<AIConnectorProvider><main>Project</main></AIConnectorProvider>);
 expect(ui.container.querySelector('.ai-editing-region')).toBeNull();
 expect(runtime.taskAction).not.toHaveBeenCalled();
});
it('keeps recovery errors visible even with only completed history', () => {
 runtime.activities=[task]; runtime.recoveryWarning='continuation_journal_unreadable';
 const ui=render(<AIConnectorProvider><main>Welcome</main></AIConnectorProvider>);
 expect(ui.container.querySelector('.continuation-progress-error')).not.toBeNull();
});

it.each(['Project','Welcome'])('does not leak a generic editor progress failure onto %s', page => {
 runtime.taskError='synthetic_progress_failure';
 const ui=render(<AIConnectorProvider><main>{page}</main></AIConnectorProvider>);
 expect(ui.container.querySelector('.continuation-progress-error')).toBeNull();
 expect(runtime.taskError).toBe('synthetic_progress_failure');
 expect(runtime.taskAction).not.toHaveBeenCalled();
});

it('scopes recovery warnings to their project without deleting recovery state', () => {
  runtime.recoveryWarning='continuation_journal_unreadable';
  function Page({id}:{id:string}) {
    const report=useContext(ConnectorContext)?.reportProject;
    useLayoutEffect(() => { report?.(id); }, [report,id]);
    return <main>{id || 'Welcome'}</main>;
  }
  const ui=render(<AIConnectorProvider><Page id="synthetic-A"/></AIConnectorProvider>);
  expect(ui.container.querySelector('.continuation-progress-error')).not.toBeNull();
  ui.rerender(<AIConnectorProvider><Page id="synthetic-B"/></AIConnectorProvider>);
  expect(ui.container.querySelector('.continuation-progress-error')).toBeNull();
  ui.rerender(<AIConnectorProvider><Page id=""/></AIConnectorProvider>);
  expect(ui.container.querySelector('.continuation-progress-error')).toBeNull();
  ui.rerender(<AIConnectorProvider><Page id="synthetic-A"/></AIConnectorProvider>);
  expect(ui.container.querySelector('.continuation-progress-error')).not.toBeNull();
  expect(runtime.recoveryWarning).toBe('continuation_journal_unreadable');
  expect(runtime.taskAction).not.toHaveBeenCalled();
});

it('keeps a failed background task action actionable outside the editor', () => {
  runtime.activities=[{...task,state:'paused'}];
  runtime.taskActionError='synthetic_end_failure';
  const ui=render(<AIConnectorProvider><main>Project</main></AIConnectorProvider>);
  expect(ui.container.querySelector('.continuation-progress-error')).not.toBeNull();
  expect(screen.getByRole('button',{name:'刷新进度'})).toBeTruthy();
});
