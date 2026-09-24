import { msg } from '../i18n';
import type { AISuggestion } from './aiEditing';
import type { Segment } from '../types';
export interface EditResume {
  version: 1;
  signature: string;
  batches: string[][];
  completed: { index: number; segments: AISuggestion[] }[];
}
/** The checkpoint keeps unchanged rows too; changed-only suggestions cannot prove completion. */
export function resumeResults(checkpoint: EditResume, selection: Segment[], signature: string): Map<number, AISuggestion[]> {
  if (checkpoint.version !== 1 || checkpoint.signature !== signature || !Array.isArray(checkpoint.batches) || !Array.isArray(checkpoint.completed)) throw new Error(msg('editResume.m1282'));
  const ids=checkpoint.batches.flat();
  if (ids.length !== selection.length || ids.some((id,i)=>id !== selection[i].id) || new Set(ids).size !== ids.length || checkpoint.batches.some(b=>!b.length || b.length>128)) throw new Error(msg('editResume.m1283'));
  const source = new Map(selection.map(s=>[s.id,s]));
  if (checkpoint.batches.some(batch=>batch.reduce((n,id)=>n+source.get(id)!.text.length,0)>6000)) throw new Error(msg('editResume.m1284'));
  const result=new Map<number,AISuggestion[]>();
  for (const entry of checkpoint.completed) {
    const batch=checkpoint.batches[entry.index];
    if (!Number.isInteger(entry.index) || !batch || result.has(entry.index) || !Array.isArray(entry.segments) || entry.segments.length!==batch.length || entry.segments.some((s,i)=>!s || s.id!==batch[i] || typeof s.text!=='string' || typeof s.reason!=='string' || !['edit','delete','merge_previous'].includes(s.action??'edit') || ((s.action==='delete') ? !!s.text.trim() : !s.text.trim()))) throw new Error(msg('editResume.m1285'));
    for (let i=0;i<entry.segments.length;i++) {
      if (entry.segments[i].action === 'merge_previous' && (i===0 || source.get(batch[i])!.speaker_id !== source.get(batch[i-1])!.speaker_id || entry.segments[i-1].action === 'delete')) throw new Error(msg('editResume.m1286'));
    }
    result.set(entry.index,entry.segments);
  }
  return result;
}
