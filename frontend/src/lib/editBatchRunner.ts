/** Run at most two requests, retaining input order and stopping siblings on failure. */
export async function runEditBatches<T, R>(batches: T[], signal: AbortSignal,
  request: (batch: T, signal: AbortSignal) => Promise<R>,
  checkpoint: (results: R[], completed: number, indexed: {index: number; value: R}[]) => Promise<void>,
  initial: Map<number, R> = new Map()): Promise<R[]> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const results = new Map<number, R>(initial);
  let next = 0;
  let failure: unknown;
  let failed = false;
  let saves = Promise.resolve();
  const ordered = () => [...results].sort(([a], [b]) => a - b).map(([, value]) => value);
  async function worker() {
    try {
      while (!controller.signal.aborted) {
        const index = next++;
        if (index >= batches.length) return;
        if (results.has(index)) continue;
        const value = await request(batches[index], controller.signal);
        if (controller.signal.aborted) return;
        results.set(index, value);
        const snapshot = ordered();
        const indexed = [...results].sort(([a],[b])=>a-b).map(([index,value])=>({index,value}));
        saves = saves.then(() => checkpoint(snapshot, snapshot.length, indexed));
        await saves;
      }
    } catch (error) {
      if (!failed && !signal.aborted) { failed = true; failure = error; }
      controller.abort();
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(2, batches.length) }, worker));
    await saves;
    if (failed) throw failure;
    return ordered();
  } finally { signal.removeEventListener("abort", abort); }
}
