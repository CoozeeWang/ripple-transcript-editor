import type { ConnectorDocument } from './aiConnector';
import type { ProjectTarget } from './projectConnectorHost';

export interface AIEditActivity {
  saveAttempt?: { batch_id: string; received_at: string };
  requestStatus?: import('./incrementalContinuation').ContinuationProgress['request_status'];
  requestId?: string; requestComplete?: boolean; phase?: import('./incrementalContinuation').EditingPhase;
  proofreadSaved?: number; endedBy?: string; nextPhase?: string;
  task_id: string; client: string; key: string; version: string; version_id: string; target?: ProjectTarget;
  kind: 'text' | 'marks' | 'incremental' | 'tags';
  projectScope?: boolean;
  state: 'waiting' | 'processing' | 'saving' | 'paused' | 'completed' | 'ended' | 'failed';
  processed: number; saved: number; total: number; reason?: string;
  touched: number; inFlight: number;
  dismissed?: boolean; leaseSuperseded?: boolean;
}
export const editTargetKey = (doc: Pick<ConnectorDocument, 'target' | 'identity' | 'version'>) => doc.target
  ? JSON.stringify([doc.target.project_id, doc.target.interview_id, doc.target.recording_id, doc.version.id])
  : JSON.stringify([doc.identity, doc.version.id]);
export const ownsEditing = (task: AIEditActivity) => ['waiting', 'processing', 'saving'].includes(task.state);
export const blocksHumanEditing = (task: AIEditActivity) => !task.leaseSuperseded && (task.inFlight > 0 ||
  !!task.requestId && !task.requestComplete && !(task.state === 'ended' && ['user_ended','user_cancelled'].includes(task.reason ?? '')) ||
  !['completed', 'ended'].includes(task.state));

export const visibleAIActivities = (activities: AIEditActivity[]) => {
  // Keep task receipts, but never display an earlier attempt over a newer result.
  const newest = new Map<string, AIEditActivity>();
  for (const task of activities) newest.set(task.key, task);
  return [...newest.values()].filter(task => task.inFlight > 0 || !task.dismissed && task.reason !== 'clarification_required' && task.reason !== 'prepare_failed');
};

/** One window-wide authority. A revoked task can never regain access implicitly. */
export class AIEditOwnership {
  private entries = new Map<string, AIEditActivity>();
  constructor(private notify: (tasks: AIEditActivity[]) => void, private now = () => Date.now()) {}
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
  acquire(id: string, client: string, doc: ConnectorDocument, kind: AIEditActivity['kind'], total: number, projectScope=false, previousId?: string) {
    const key = editTargetKey(doc);
    const predecessor = previousId ? this.entries.get(previousId) : undefined;
    const handoff = predecessor && predecessor.key === key && predecessor.client === client && !predecessor.inFlight && ['completed','ended'].includes(predecessor.state) ? predecessor : undefined;
    if ([...this.entries.values()].some(task => (task.key === key || (projectScope || task.projectScope) && task.target?.project_id === doc.target?.project_id) && blocksHumanEditing(task) && task.task_id !== id && task !== handoff))
      throw Error('manuscript_locked_by_other_ai_end_editing_first');
    // Only the newest notice for a target remains; terminal receipts stay queryable.
    for (const task of this.entries.values()) if (!blocksHumanEditing(task)) task.dismissed = true;
    const previous = this.entries.get(id);
    if (previous && previous.state !== 'paused') throw Error('editing_task_ended_prepare_again');
    this.entries.set(id, { task_id: id, client, key, target: doc.target, version: doc.label, version_id: doc.version.id, kind, projectScope,
      ...(handoff ? {requestId:handoff.requestId,saved:handoff.saved,total:handoff.total,requestStatus:'waiting' as const,phase:handoff.phase,proofreadSaved:handoff.proofreadSaved} : {}),
      ...previous, state: 'waiting', processed: previous?.processed ?? 0, saved: previous?.saved ?? handoff?.saved ?? 0,
      total: previous?.total ?? handoff?.total ?? total, touched: this.now(), inFlight: 0 });
    this.changed();
  }
  rename(from: string, to: string) {
    const task = this.entries.get(from)!; this.entries.delete(from); task.task_id = to; this.entries.set(to, task); this.changed();
  }
  assert(id: string, client?: string) {
    const task = this.entries.get(id);
    if (!task || task.state === 'ended' || task.state === 'completed' || task.state === 'paused') throw Error('editing_task_ended_prepare_again');
    if (client !== undefined && task.client !== client) throw Error('editing_task_belongs_to_another_client');
    task.touched = this.now();
    return task;
  }
  update(id: string, patch: Partial<AIEditActivity>) {
    const task = this.entries.get(id); if (!task) return;
    Object.assign(task, patch, { touched: this.now() }); this.changed();
  }
  end(id: string, reason = 'user_ended') {
    const task = this.entries.get(id); if (!task || task.state === 'completed' && !blocksHumanEditing(task)) return;
    this.update(id, { state: 'ended', reason, dismissed: reason === 'user_ended' && task.kind !== 'incremental', ...(task.kind === 'incremental' ? {requestStatus: 'stopped' as const, endedBy:'user'} : {}) });
  }
  dismiss(id: string) { const task = this.entries.get(id); if (task && !blocksHumanEditing(task)) this.update(id, { dismissed: true }); }
  endAll(reason: string) { for (const task of this.entries.values()) if (blocksHumanEditing(task)) this.end(task.task_id, reason); }
  interruptAll(reason: string) {
    for (const task of this.entries.values()) if (blocksHumanEditing(task) && task.state !== 'ended')
      this.update(task.task_id, { reason });
  }

}
