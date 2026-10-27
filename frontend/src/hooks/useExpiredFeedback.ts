import { useEffect, useRef, useState } from 'react';
import { SUCCESS_FEEDBACK_MS } from './useTransientState';

/** Expire presentation receipts only; never change the tasks/results behind them. */
export function useExpiredFeedback(receipts: string[]) {
  const [expired, setExpired] = useState<Set<string>>(() => new Set());
  const timers = useRef(new Map<string, number>());
  const keys = JSON.stringify(receipts);
  useEffect(() => {
    const pending = timers.current;
    const current = new Set<string>(JSON.parse(keys));
    for (const [key, timer] of pending) {
      if (!current.has(key)) { window.clearTimeout(timer); pending.delete(key); }
    }
    for (const key of current) {
      if (pending.has(key) || expired.has(key)) continue;
      const timer = window.setTimeout(() => {
        if (pending.get(key) !== timer) return;
        pending.delete(key);
        setExpired(previous => new Set([...previous, key]));
      }, SUCCESS_FEEDBACK_MS);
      pending.set(key, timer);
    }
  }, [keys, expired]);
  useEffect(() => {
    const pending = timers.current;
    return () => { pending.forEach(timer => window.clearTimeout(timer)); pending.clear(); };
  }, []);
  return expired;
}
