import type { ConnectorDocument } from './aiConnector';
import type { ProjectTarget } from './projectConnectorHost';

export interface AIEditActivity {
  task_id: string; client: string; key: string; version: string; version_id: string; target?: ProjectTarget;
  kind: 'text' | 'marks' | 'incremental';
  state: 'waiting' | 'processing' | 'saving' | 'paused' | 'completed' | 'ended' | 'failed';
  processed: number; saved: number; total: number; reason?: string;
  touched: number; inFlight: number;
}
export const editTargetKey = (doc: Pick<ConnectorDocument, 'target' | 'identity' | 'version'>) => doc.target
  ? JSON.stringify([doc.target.project_id, doc.target.interview_id, doc.target.recording_id, doc.version.id])
  : JSON.stringify([doc.identity, doc.version.id]);
export const ownsEditing = (task: AIEditActivity) => ['waiting', 'processing', 'saving'].includes(task.state);
export const blocksHumanEditing = (task: AIEditActivity) => ownsEditing(task) || task.inFlight > 0;

/** One window-wide authority. A revoked task can never regain access implicitly. */
export class AIEditOwnership {
  private entries = new Map<string, AIEditActivity>();
  constructor(private notify: (tasks: AIEditActivity[]) => void, private now = () => Date.now(), readonly leaseMs = 120000) {}
  values() { return [...this.entries.values()].map(task => ({ ...task })); }
  private changed() { this.notify(this.values()); }
  get(id: string) { return this.entries.get(id); }
  restorePaused(id: string, client: string, doc: ConnectorDocument, total: number, saved: number) {
    if (this.entries.has(id)) return;
    this.entries.set(id, { task_id: id, client, key: editTargetKey(doc), target: doc.target,
      version: doc.label, version_id: doc.version.id, kind: 'incremental', state: 'paused',
      processed: saved, saved, total, touched: this.now(), inFlight: 0, reason: 'connection_recovered' });
    this.changed();
  }
  acquire(id: string, client: string, doc: ConnectorDocument, kind: AIEditActivity['kind'], total: number) {
    this.sweep();
    const key = editTargetKey(doc);
    if ([...this.entries.values()].some(task => task.key === key && blocksHumanEditing(task) && task.task_id !== id))
      throw Error('manuscript_locked_by_other_ai_end_editing_first');
    const previous = this.entries.get(id);
    if (previous && previous.state !== 'paused') throw Error('editing_task_ended_prepare_again');
    this.entries.set(id, { task_id: id, client, key, target: doc.target, version: doc.label, version_id: doc.version.id, kind,
      state: 'waiting', processed: previous?.processed ?? 0, saved: previous?.saved ?? 0,
      total, touched: this.now(), inFlight: 0 });
    this.changed();
  }
  rename(from: string, to: string) {
    const task = this.entries.get(from)!; this.entries.delete(from); task.task_id = to; this.entries.set(to, task); this.changed();
  }
  assert(id: string, client?: string) {
    this.sweep();
    const task = this.entries.get(id);
    if (!task || !ownsEditing(task)) throw Error('editing_task_ended_prepare_again');
    if (client !== undefined && task.client !== client) throw Error('editing_task_belongs_to_another_client');
    task.touched = this.now();
    return task;
  }
  update(id: string, patch: Partial<AIEditActivity>) {
    const task = this.entries.get(id); if (!task) return;
    Object.assign(task, patch, { touched: this.now() }); this.changed();
  }
  end(id: string, reason = 'user_ended') {
    const task = this.entries.get(id); if (!task || task.state === 'completed') return;
    this.update(id, { state: 'ended', reason });
  }
  endAll(reason: string) { for (const task of this.entries.values()) if (ownsEditing(task) || task.state === 'paused') this.end(task.task_id, reason); }
  sweep() {
    let changed = false;
    for (const task of this.entries.values()) if (ownsEditing(task) && !task.inFlight && this.now() - task.touched >= this.leaseMs) {
      task.state = 'ended'; task.reason = 'task_timeout'; changed = true;
    }
    if (changed) this.changed();
  }
}
