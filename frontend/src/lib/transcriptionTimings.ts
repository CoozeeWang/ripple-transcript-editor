export const TRANSCRIPTION_TIMINGS_EVENT = 'ripple:transcription-timings';
const KEY = 'ripple-transcription-timings-v1';
const MAX_RUNS = 20;
export type TranscriptionTimingPhase = 'preparing' | 'uploading' | 'sending' | 'processing' | 'saving';
export interface TranscriptionTiming {
  run: string; time: string; ms: number; status: 'ok' | 'failed' | 'cancelled';
  stages: Partial<Record<TranscriptionTimingPhase, number>>;
}
let memory: TranscriptionTiming[] = [];
const phases: TranscriptionTimingPhase[] = ['preparing','uploading','sending','processing','saving'];
export function readTranscriptionTimings(): TranscriptionTiming[] {
  try {
    const raw = localStorage.getItem(KEY);
    const rows: unknown = raw && raw.length < 100000 ? JSON.parse(raw) : [];
    if (Array.isArray(rows)) memory = rows.filter(r => r && /^[a-f0-9-]{36}$/i.test(r.run) &&
      Number.isFinite(Date.parse(r.time)) && Date.parse(r.time) > Date.now() - 7 * 86400000 && Date.parse(r.time) <= Date.now() + 60000 &&
      Number.isFinite(r.ms) && r.ms >= 0 && ['ok','failed','cancelled'].includes(r.status) && r.stages && typeof r.stages === 'object')
      .slice(-MAX_RUNS).map(r => ({run:r.run,time:r.time,ms:r.ms,status:r.status,
        stages:Object.fromEntries(phases.filter(p => Number.isFinite(r.stages[p]) && r.stages[p] >= 0).map(p => [p,r.stages[p]]))}));
  } catch { /* storage unavailable: retain metadata in memory */ }
  return memory.filter(r => Date.parse(r.time) > Date.now() - 7 * 86400000);
}
export function startTranscriptionTiming() {
  const run = crypto.randomUUID();
  const start = performance.now();
  let since = start;
  let phase: TranscriptionTimingPhase = 'preparing';
  const stages: TranscriptionTiming['stages'] = {};
  const flush = () => { const now = performance.now(); stages[phase] = (stages[phase] ?? 0) + Math.round(now - since); since = now; };
  return {
    stage(next: TranscriptionTimingPhase) { if (next !== phase) { flush(); phase = next; } },
    finish(status: TranscriptionTiming['status']) {
      flush();
      memory = [...readTranscriptionTimings(), {run,time:new Date().toISOString(),ms:Math.round(performance.now()-start),status,stages}].slice(-MAX_RUNS);
      try { localStorage.setItem(KEY, JSON.stringify(memory)); } catch { /* best effort */ }
      window.dispatchEvent(new Event(TRANSCRIPTION_TIMINGS_EVENT));
    },
  };
}
