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
