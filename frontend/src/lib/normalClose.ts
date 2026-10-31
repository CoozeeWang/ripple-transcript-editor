let guard: (() => Promise<void>) | undefined;
/** Exactly one active editor; keep the latest save guard without changing native close behavior elsewhere. */
export function registerNormalClose(callback: () => Promise<void>) {
    guard = callback;
    return () => { if (guard === callback) guard = undefined; };
}
export async function prepareNormalClose() { await guard?.(); }
