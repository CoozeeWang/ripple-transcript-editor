import { useCallback, useEffect, useState, type SetStateAction } from 'react';

export const SUCCESS_FEEDBACK_MS = 4000;

/** Every publication is a new receipt, even when its text is unchanged. */
export function useTransientState<T>(initial: T, reset: T, lifetime: (value: T) => number | null = () => SUCCESS_FEEDBACK_MS) {
  const [receipt, setReceipt] = useState(() => ({ value: initial }));
  const publish = useCallback((value: SetStateAction<T>) => {
    setReceipt(previous => ({ value: typeof value === 'function' ? (value as (previous: T) => T)(previous.value) : value }));
  }, []);
  const delay = Object.is(receipt.value, reset) ? null : lifetime(receipt.value);
  useEffect(() => {
    if (delay === null) return;
    const timer = window.setTimeout(() => {
      // A queued old callback must never erase a newer receipt or error.
      setReceipt(current => current === receipt ? { value: reset } : current);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [receipt, reset, delay]);
  return [receipt.value, publish] as const;
}
