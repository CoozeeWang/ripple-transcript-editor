import { validateAIMark, type AIMark } from './aiMarks';
import type { ConnectorDocument, ConnectorHost } from './aiConnector';

type Snapshot = ConnectorDocument & { id: string };
interface MarkTask {
  id: string; snapshot: Snapshot; ids: string[]; summary: string; staged: Map<string, AIMark>;
  state: 'draft' | 'applying' | 'completed' | 'cancelled' | 'failed';
  result?: Record<string, unknown>; promise?: Promise<Record<string, unknown>>;
}
export class AIMarkTasks {
  private tasks = new Map<string, MarkTask>();
  constructor(private host: ConnectorHost, private valid: (id: unknown) => Promise<Snapshot>) {}
  async handle(operation: string, a: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (operation === 'prepare_marks') {
      const snapshot = await this.valid(a.snapshot);
      if (snapshot.editable === false) throw new Error('select_editable_version_in_ripple');
      if (!this.host.applyMarks) throw new Error('marks_unavailable');
      if (typeof a.instructions !== 'string' || !a.instructions.trim() || a.instructions.length > 4000) return { needs_clarification: ['mark_instructions'], writable: false };
      if (a.whole_interview !== true && !Array.isArray(a.segment_ids)) return { needs_clarification: ['mark_scope'], writable: false };
      if (a.whole_interview === true && a.segment_ids !== undefined) throw new Error('ambiguous_mark_scope');
      const ids = a.whole_interview === true ? snapshot.transcript.segments.map(s => s.id) : a.segment_ids as string[];
      if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !snapshot.transcript.segments.some(s => s.id === id))) throw new Error('invalid_range');
      if (this.tasks.size >= 32) throw new Error('too_many_tasks_cancel_or_restart_connection');
      const id = crypto.randomUUID();
      const summary = JSON.stringify({ ...(snapshot.target ? { target: snapshot.target } : {}), source: snapshot.label, segment_ids: ids, instructions: a.instructions.trim(), save_in_current_version: true });
      this.tasks.set(id, { id, snapshot, ids: [...ids], summary, staged: new Map(), state: 'draft' });
      return { task_id: id, summary, segment_count: ids.length, version: snapshot.label, instruction: 'Add marks to this current version; no new version or text changes. Agree on consequential scope/interpretation, then stage every scoped segment including those needing no marks.' };
    }
    const task = this.tasks.get(String(a.task_id));
    if (!task) throw new Error('task_expired');
    if (operation === 'marks_status') return { task_id: task.id, state: task.state, summary: task.summary, remaining_ids: task.ids.filter(id => !task.staged.has(id)), result: task.result ?? null };
    if (operation === 'cancel_marks') {
      if (task.state !== 'draft') throw new Error('task_not_editable');
      task.state = 'cancelled'; task.staged.clear();
      return { cancelled: true };
    }
    if (operation === 'stage_marks') {
      if (task.state !== 'draft') throw new Error('task_not_editable');
      await this.valid(task.snapshot.id);
      if (task.state !== 'draft') throw new Error('task_not_editable');
      if (!Array.isArray(a.marks) || !a.marks.length || a.marks.length > 32) throw new Error('invalid_batch');
      const marks = a.marks.map(mark => validateAIMark(task.snapshot.transcript, mark));
      if (new Set(marks.map(mark => mark.segment_id)).size !== marks.length) throw new Error('duplicate_segment');
      if (marks.some(mark => !task.ids.includes(mark.segment_id))) throw new Error('outside_confirmed_scope');
      marks.forEach(mark => task.staged.set(mark.segment_id, mark));
      return { staged: task.staged.size, remaining: task.ids.length - task.staged.size };
    }
    if (operation === 'apply_marks') {
      if (task.state === 'completed' || task.state === 'failed') return task.result!;
      if (task.promise) return task.promise;
      if (task.state !== 'draft') throw new Error('task_not_editable');
      if (a.confirmed_summary !== task.summary) throw new Error('confirm_task_summary_first');
      if (task.staged.size !== task.ids.length) throw new Error('incomplete_scope_stage_remaining_segments');
      // Reserve before awaiting source validation, so concurrent applications share one write.
      task.state = 'applying';
      task.promise = (async () => {
        try {
          await this.valid(task.snapshot.id);
          const result = await this.host.applyMarks!(task.snapshot.transcript, task.ids.map(id => task.staged.get(id)!), task.id);
          task.result = { ...result, task_id: task.id, new_version_created: false }; task.state = 'completed';
          return task.result;
        } catch (error) {
          const reason = error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : 'mark_apply_failed_check_ripple';
          task.result = { saved: false, task_id: task.id, error: reason, instruction: 'Check Ripple and task status. If changes remain unsaved in Ripple, save them there; do not start another task to repeat an uncertain write.' };
          task.state = 'failed'; return task.result;
        }
      })();
      return task.promise;
    }
    throw new Error('unknown_operation');
  }
}
