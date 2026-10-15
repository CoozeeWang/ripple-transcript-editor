// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useTransientState } from './useTransientState';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
it('gives repeated identical feedback a full four seconds and cannot erase a newer error', () => {
  vi.useFakeTimers();
  const timer = vi.spyOn(window, 'setTimeout');
  const { result } = renderHook(() => useTransientState('', '', value => value.startsWith('error') ? null : 4000));
  act(() => result.current[1]('saved'));
  const expired = timer.mock.calls.at(-1)![0] as () => void;
  act(() => vi.advanceTimersByTime(3000));
  act(() => result.current[1]('saved'));
  act(() => expired());
  expect(result.current[0]).toBe('saved');
  act(() => vi.advanceTimersByTime(3999));
  expect(result.current[0]).toBe('saved');
  act(() => result.current[1]('error: retry'));
  act(() => { expired(); vi.advanceTimersByTime(10000); });
  expect(result.current[0]).toBe('error: retry');
});
it('expires only the receipt and clears its timer on unmount', () => {
  vi.useFakeTimers();
  const { result, unmount } = renderHook(() => useTransientState(false, false));
  act(() => result.current[1](true));
  act(() => vi.advanceTimersByTime(4000));
  expect(result.current[0]).toBe(false);
  act(() => result.current[1](true));
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
