const statuses=['confirmed_saved','save_uncertain','no_saved_receipt','unknown_batch'] as const;
export interface SaveDiagnostics {
  task_id:string; batch_id:string|null; receipt_status:typeof statuses[number]; checked_at:string;
  journal_updated_at:string; saved_segments:number; saved_version_id:string|null;
  external_call_status:'not_observable'; arrival_history_scope:'current_window_session';
  window_save_attempt:{batch_id:string;received_at:string}|null;
}
const id=(value:unknown)=>typeof value==='string'&&/^[a-zA-Z0-9:_-]{1,160}$/.test(value)?value:null;
const date=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
export function safeSaveDiagnostics(response:unknown):SaveDiagnostics {
 const raw=(response as {save_diagnostics?:Partial<SaveDiagnostics>}|null)?.save_diagnostics;
 if(!raw||!id(raw.task_id)||!statuses.includes(raw.receipt_status!)||!date(raw.checked_at)||!date(raw.journal_updated_at)||!Number.isSafeInteger(raw.saved_segments)||raw.saved_segments!<0)throw Error('save_diagnostics_unavailable');
 const attempt=raw.window_save_attempt;
 return {task_id:id(raw.task_id)!,batch_id:id(raw.batch_id),receipt_status:raw.receipt_status!,checked_at:date(raw.checked_at)!,journal_updated_at:date(raw.journal_updated_at)!,saved_segments:raw.saved_segments!,saved_version_id:id(raw.saved_version_id),external_call_status:'not_observable',arrival_history_scope:'current_window_session',window_save_attempt:attempt&&id(attempt.batch_id)&&date(attempt.received_at)?{batch_id:id(attempt.batch_id)!,received_at:date(attempt.received_at)!}:null};
}
