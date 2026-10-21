// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { CONNECTOR_ENABLED_KEY, useAIConnectorRuntime as useAIConnector } from './useAIConnector';
vi.mock('../lib/desktopFs', () => ({ nativeDesktopAvailable: () => false }));
const host = { current: vi.fn(), publish: vi.fn() };
afterEach(() => { localStorage.clear(); });
it('remembers explicit enable and disable across hook remounts without implicitly authorizing first use', async () => {
  const first = renderHook(() => useAIConnector(host));
  expect(first.result.current.enabled).toBe(false);
  await act(async () => { first.result.current.setEnabled(true); });
  expect(localStorage.getItem(CONNECTOR_ENABLED_KEY)).toBe('1');
  first.unmount();
  const second = renderHook(() => useAIConnector(host));
  expect(second.result.current.enabled).toBe(true);
  await act(async () => { second.result.current.setEnabled(false); });
  second.unmount();
  const third = renderHook(() => useAIConnector(host));
  expect(third.result.current.enabled).toBe(false);
  third.unmount();
});

it('surfaces a journal warning alongside healthy progress instead of rejecting the entire task list', async () => {
  const { waitFor } = await import('@testing-library/react');
  const version = { id: 'm:e', model_id: 'm', edit_id: 'e', name: 'Synthetic edit', kind: 'edit' as const };
  const task = { schema: 1 as const, id: crypto.randomUUID(), source: version, target: version, saveMode: 'current_version' as const,
    name: version.name, rules: ['Synthetic rule'], actions: ['edit' as const], ids: ['s1'], done: [], held: [],
    state: 'paused' as const, summary: '{}', updated: '' };
  const partialHost = { publish: vi.fn(), current: async () => ({ identity: 'synthetic', title: 'Synthetic', label: version.name,
    names: [version.name], version, transcript: { audio: { filename: 'synthetic.wav', duration: 1 }, speakers: [], segments: [] },
    references: async () => [], continuations: { scope: 'synthetic', read: async (report?: (count: number) => void) => { report?.(1); return [task]; }, write: async () => {} } }) };
  const hook = renderHook(() => useAIConnector(partialHost, 'synthetic'));
  await waitFor(() => expect(hook.result.current.tasks).toHaveLength(1));
  expect(hook.result.current.taskError).toBe('continuation_journal_unreadable');
  hook.unmount();
});
