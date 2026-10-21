import type { ContinuationTask } from './incrementalContinuation';

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
const version = (value: unknown) => object(value) &&
  ['id', 'model_id', 'edit_id', 'name'].every(key => typeof value[key] === 'string') &&
  ['original', 'edit'].includes(String(value.kind));
const receipt = (value: unknown) => object(value) &&
  ['task_id', 'batch_id', 'source_version_id', 'version_id'].every(key => typeof value[key] === 'string') &&
  strings(value.processed_ids) && ['changed_segments', 'deleted_segments', 'merged_segments'].every(key =>
    typeof value[key] === 'number' && Number.isSafeInteger(value[key]) && value[key] >= 0);
const segment = (value: unknown) => object(value) &&
  typeof value.id === 'string' && typeof value.text === 'string';
const batch = (value: unknown) => object(value) && typeof value.id === 'string' &&
  Array.isArray(value.segments) && value.segments.every(segment) && strings(value.checked) &&
  object(value.guard) && Array.isArray(value.guard.segments) && value.guard.segments.every(segment) &&
  Array.isArray(value.guard.speakers) && value.guard.speakers.every(item => object(item) && typeof item.id === 'string') &&
  Array.isArray(value.changes) && value.changes.every(item => object(item) &&
    ['segment_id', 'before', 'after'].every(key => typeof item[key] === 'string') &&
    ['edit', 'delete', 'merge_previous'].includes(String(item.action)));

/** Validate journals before any progress display, recovery or task execution. */
export function isContinuationTask(value: unknown): value is ContinuationTask {
  if (!object(value) || !strings(value.ids)) return false;
  const ids = value.ids;
  return value.schema === 1 && typeof value.id === 'string' && /^[a-f0-9-]{36}$/.test(value.id) &&
    version(value.source) && version(value.target) && ['new_version', 'current_version'].includes(String(value.saveMode)) &&
    typeof value.name === 'string' && typeof value.summary === 'string' && typeof value.updated === 'string' &&
    strings(value.rules) && strings(value.actions) && value.actions.every(action => ['edit', 'delete', 'merge_previous'].includes(action)) &&
    new Set(ids).size === ids.length && strings(value.done) && value.done.every(id => ids.includes(id)) &&
    ['draft', 'paused', 'completed', 'cancelled'].includes(String(value.state)) &&
    (value.previous_task_id === undefined || typeof value.previous_task_id === 'string' && /^[a-f0-9-]{36}$/.test(value.previous_task_id)) &&
    (value.owner_client === undefined || typeof value.owner_client === 'string') &&
    (value.reason === undefined || typeof value.reason === 'string') &&
    Array.isArray(value.held) && value.held.every(batch) && (value.batch === undefined || batch(value.batch)) &&
    (value.pending === undefined || receipt(value.pending)) && (value.lastReceipt === undefined || receipt(value.lastReceipt)) &&
    (value.receipts === undefined || Array.isArray(value.receipts) && value.receipts.every(receipt));
}
