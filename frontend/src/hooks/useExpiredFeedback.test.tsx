// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useExpiredFeedback } from './useExpiredFeedback';
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
it('gives concurrent completions independent lifetimes without dropping their records', () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(useExpiredFeedback, { initialProps: ['first'] });
  act(() => vi.advanceTimersByTime(3000));
  rerender(['first', 'second']);
  act(() => vi.advanceTimersByTime(1000));
  expect(result.current.has('first')).toBe(true);
  expect(result.current.has('second')).toBe(false);
  act(() => vi.advanceTimersByTime(3000));
  expect(result.current.has('second')).toBe(true);
});
it('cancels replaced receipts, rejects a queued stale callback and cleans up on unmount', () => {
  vi.useFakeTimers(); const timer = vi.spyOn(window, 'setTimeout');
  const { result, rerender, unmount } = renderHook(useExpiredFeedback, { initialProps: ['old'] });
  const stale = timer.mock.calls[0][0] as () => void;
  rerender(['new']);
  act(() => stale());
  expect(result.current.has('old')).toBe(false);
  expect(result.current.has('new')).toBe(false);
  unmount(); expect(vi.getTimerCount()).toBe(0);
});
