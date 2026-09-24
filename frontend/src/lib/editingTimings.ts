/** Local timing metadata only: never persist text, filenames, engine labels or errors. */
export const EDITING_TIMINGS_EVENT = 'ripple:editing-timings';
const KEY = 'ripple-editing-timings-v1';
const WEEK = 7 * 24 * 60 * 60 * 1000;
const MAX_RUNS = 20;
const phases = ['prepare', 'request', 'checkpoint', 'final_checkpoint', 'publish', 'total'] as const;
export type EditingPhase = typeof phases[number];
export interface EditingTiming {
  run: string; time: string; phase: EditingPhase; ms: number;
  status: 'ok' | 'failed' | 'cancelled'; batch: number; segments: number; characters: number;
}
let memory: EditingTiming[] = [];
let storageAvailable = true;
function clean(value: unknown): EditingTiming[] {
  if (!Array.isArray(value)) return [];
  const rows = value.filter((v): v is EditingTiming => v && typeof v.run === 'string' && /^[a-f0-9-]{36}$/i.test(v.run)
    && typeof v.time === 'string' && Number.isFinite(Date.parse(v.time)) && Date.parse(v.time) <= Date.now() + 60000
    && phases.includes(v.phase) && ['ok', 'failed', 'cancelled'].includes(v.status)
    && ['ms', 'batch', 'segments', 'characters'].every(k => Number.isFinite(v[k]) && v[k] >= 0))
    .map(({run,time,phase,ms,status,batch,segments,characters}) => ({run,time,phase,ms,status,batch,segments,characters}));
  // Retain or expire an entire run together, never truncate its batch details.
  const lastActivity = new Map<string, number>();
  for (const row of rows) lastActivity.set(row.run, Math.max(lastActivity.get(row.run) ?? 0, Date.parse(row.time)));
  const retained = new Set([...lastActivity].filter(([,time]) => time >= Date.now() - WEEK)
    .sort((a,b) => a[1] - b[1]).slice(-MAX_RUNS).map(([run]) => run));
  return rows.filter(row => retained.has(row.run));
}
export function readEditingTimings(): EditingTiming[] {
  if (storageAvailable) {
    try { const raw = localStorage.getItem(KEY); memory = raw ? clean(JSON.parse(raw)) : []; }
    catch { storageAvailable = false; }
  }
  return clean(memory);
}
export function editingTimingsPersistent() { return storageAvailable; }
function record(row: EditingTiming) {
  memory = clean([...readEditingTimings(), row]);
  try { if (storageAvailable) localStorage.setItem(KEY, JSON.stringify(memory)); }
  catch { storageAvailable = false; }
  window.dispatchEvent(new Event(EDITING_TIMINGS_EVENT));
}
export function startEditingTiming(signal: AbortSignal, segments: number, characters: number) {
  const run = crypto.randomUUID();
  const started = performance.now();
  const save = (phase: EditingPhase, start: number, status: EditingTiming['status'], batch = 0, count = segments, chars = characters) => {
    // Diagnostics must never interrupt editing or saving.
    try { record({run,time:new Date().toISOString(),phase,ms:Math.round(performance.now()-start),status,batch,segments:count,characters:chars}); } catch { /* best effort */ }
  };
  return {
    async measure<T>(phase: EditingPhase, work: () => Promise<T>, batch = 0, count = segments, chars = characters): Promise<T> {
      const start = performance.now();
      // A resolved operation completed, even if closing the dialog aborted its controller.
      try { const value = await work(); save(phase,start,'ok',batch,count,chars); return value; }
      catch (error) { save(phase,start,signal.aborted?'cancelled':'failed',batch,count,chars); throw error; }
    },
    finish(ok: boolean) { save('total',started,ok?'ok':signal.aborted?'cancelled':'failed'); },
  };
}
