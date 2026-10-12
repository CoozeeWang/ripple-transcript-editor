import type { ContinuationReceipt, Segment, Speaker, Transcript } from '../types';
import { applyAISuggestions, type AISuggestion } from './aiVersionEdits';

export interface ContinuationGuard { segments: Segment[]; speakers: Speaker[] }
export interface ContinuationCheckpoint { guard: ContinuationGuard; receipt: ContinuationReceipt }

/** Compare only the batch and its structural neighbours, preserving unrelated manual edits. */
export function checkContinuationGuard(current: Transcript, guard: ContinuationGuard): boolean {
  const first = current.segments.findIndex(s => s.id === guard.segments[0]?.id);
  if (first < 0 || JSON.stringify(current.segments.slice(first, first + guard.segments.length)) !== JSON.stringify(guard.segments)) return false;
  const speakers = new Set(guard.speakers.map(s => s.id));
  return JSON.stringify(current.speakers.filter(s => speakers.has(s.id))) === JSON.stringify(guard.speakers);
}

export function applyContinuationBatch(current: Transcript, suggestions: AISuggestion[], checkpoint: ContinuationCheckpoint): Transcript {
  if (!checkContinuationGuard(current, checkpoint.guard)) throw new Error('batch_conflict_manual_changes_preserved');
  const result = applyAISuggestions(current, current, suggestions);
  return { ...result, aiContinuationReceipts: { ...current.aiContinuationReceipts, [checkpoint.receipt.task_id]: checkpoint.receipt } };
}

/** The destination ID is assigned before the new manuscript file is written. */
export function stampContinuationReceipt(transcript: Transcript, versionId: string): Transcript {
  if (!Object.values(transcript.aiContinuationReceipts ?? {}).some(receipt => !receipt.version_id)) return transcript;
  return { ...transcript, aiContinuationReceipts: Object.fromEntries(Object.entries(transcript.aiContinuationReceipts ?? {})
    .map(([id, receipt]) => [id, receipt.version_id ? receipt : { ...receipt, version_id: versionId }])) };
}
