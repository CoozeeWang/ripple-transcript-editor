// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { AIConnectorProvider } from '../components/AIConnectorProvider';
import { useAIConnector } from './useAIConnector';
import type { ConnectorDocument, ConnectorHost } from '../lib/aiConnector';
vi.mock('../lib/desktopFs', () => ({ nativeDesktopAvailable: () => true }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

it('retains an in-flight marks result across editor remount and continues after an expired broker reply', async () => {
  localStorage.setItem('ripple-mcp-enabled', '1');
  Object.assign(window, { __TAURI__: { core: { invoke: async () => 'synthetic-window-key' } } });
  const replies = new Map<string, { ok: boolean; data: Record<string, unknown> }>();
  let waiting: ((response: Response) => void) | undefined;
  const queued: object[] = [];
  const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit = {}) => {
    if (url.includes('/poll?')) return queued.length ? response(queued.shift()) : new Promise<Response>((resolve, reject) => {
      waiting = resolve;
      options.signal?.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError')), { once: true });
    });
    if (url.endsWith('/reply')) {
      const body = JSON.parse(String(options.body)); replies.set(body.request_id, body.result);
      return response({}, body.request_id === 'apply' ? 409 : 200);
    }
    return response({ enabled: true });
  }));
  const dispatch = async (id: string, operation: string, args: object) => {
    await act(async () => {
      const call = { request_id: id, operation, arguments: args, client: 'chatgpt' };
      if (waiting) { const resolve = waiting; waiting = undefined; resolve(response(call)); } else queued.push(call);
    });
  };
  const result = async (id: string) => { await waitFor(() => expect(replies.has(id)).toBe(true)); expect(replies.get(id)?.ok).toBe(true); return replies.get(id)!.data; };
  let finishSave!: (value: Record<string, unknown>) => void;
  const saving = new Promise<Record<string, unknown>>(resolve => { finishSave = resolve; });
  const doc: ConnectorDocument = { identity: 'synthetic-A', title: 'Synthetic A', label: 'v1', names: ['v1'],
    version: { id: 'm:e', model_id: 'm', edit_id: 'e', name: 'v1', kind: 'edit' },
    transcript: { audio: { filename: 'synthetic.wav', duration: 1 }, speakers: [], segments: [{ id: 's1', speaker_id: 'sp', start: 0, end: 1, text: 'Synthetic text' }] }, references: async () => [] };
  const apply = vi.fn(() => saving);
  const host: ConnectorHost = { current: async () => doc, publish: async () => ({}), applyMarks: apply };
  function Editor({ name }: { name: string }) { useAIConnector(name === 'A' ? host : { ...host, current: async () => ({ ...doc, identity: 'synthetic-B', title: 'Synthetic B' }) }, name); return <p>{name}</p>; }
  const ui = render(<AIConnectorProvider><Editor key="A" name="A"/></AIConnectorProvider>);
  await dispatch('read', 'read_current', {}); const read = await result('read');
  await dispatch('prepare', 'prepare_marks', { snapshot: read.snapshot, segment_ids: ['s1'], instructions: 'Synthetic note' }); const task = await result('prepare');
  await dispatch('stage', 'stage_marks', { task_id: task.task_id, marks: [{ segment_id: 's1', before: 'Synthetic text', annotation: 'Synthetic note' }] }); await result('stage');
  await dispatch('apply', 'apply_marks', { task_id: task.task_id, confirmed_summary: task.summary });
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  ui.rerender(<AIConnectorProvider><Editor key="B" name="B"/></AIConnectorProvider>);
  await act(async () => { finishSave({ saved: true, version: 'v1' }); }); await result('apply');
  await dispatch('status', 'marks_status', { task_id: task.task_id });
  expect(await result('status')).toMatchObject({ state: 'completed', result: { saved: true } });
  expect(apply).toHaveBeenCalledTimes(1);
});
