// @vitest-environment jsdom
import {cleanup, render, screen} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {AIConnectorProvider} from './AIConnectorProvider';
import type {AIEditActivity} from '../lib/aiEditOwnership';
const runtime = vi.hoisted(() => ({ activities: [] as AIEditActivity[], tasks: [], taskError: '', taskAction: vi.fn() }));
vi.mock('../hooks/useAIConnector', () => ({useAIConnectorRuntime: () => runtime}));
afterEach(() => { cleanup(); runtime.activities=[]; runtime.taskError=''; vi.clearAllMocks(); });
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
 runtime.activities=[task]; runtime.taskError='continuation_journal_unreadable';
 const ui=render(<AIConnectorProvider><main>Welcome</main></AIConnectorProvider>);
 expect(ui.container.querySelector('.continuation-progress-error')).not.toBeNull();
});
