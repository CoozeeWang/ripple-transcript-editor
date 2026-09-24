import { useLayoutEffect, useState } from "react";

/** Keep event identities stable while invoking the latest committed handlers.
 * Callers must keep the callback keys constant for the lifetime of the hook. */
export function useStableCallbacks<T extends Record<string, (...args: never[]) => unknown>>(callbacks: T): T {
  const [stable] = useState(() => {
    let current = callbacks;
    return {
      handlers: Object.fromEntries(Object.keys(callbacks).map(key =>
        [key, (...args: never[]) => current[key](...args)])) as T,
      update: (next: T) => { current = next; },
    };
  });
  useLayoutEffect(() => { stable.update(callbacks); }, [callbacks, stable]);
  return stable.handlers;
}
