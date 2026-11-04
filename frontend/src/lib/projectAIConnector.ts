import { AIConnector, type ConnectorDocument, type ConnectorHost } from './aiConnector';
import { AIEditOwnership, editTargetKey, ownsEditing } from './aiEditOwnership';
import { ProjectConnectorHosts, type ProjectConnectorAccess } from './projectConnectorHost';
import type { ContinuationProgress } from './incrementalContinuation';
import { ProjectTagTasks } from './projectTagTasks';

type Bound = Awaited<ReturnType<ProjectConnectorHosts['bind']>>;
interface Owner { controller: AIConnector; host: ConnectorHost; bound?: Bound }
const instruction = 'Ask the user for the exact version when not already specified, even if there is only one candidate. List candidates with interview, recording and version names and IDs. Never select the newest or active version automatically. Report the actual target before editing; confirm save mode and scope. The open editor stays unchanged when editing another manuscript. Background current-version writes have no editor undo; explain this when offering save modes and use new_version for a persistent separate before/after copy.';

/** Snapshot/task IDs route independently; reading B never retargets a task for A. */
export class ProjectAIConnector {
  private hosts: ProjectConnectorHosts;
  private legacy: Owner;
  private owners = new Map<string, Owner>();
  private snapshots = new Map<string, Owner>();
  private tasks = new Map<string, Owner>();
  private markIds = new Set<string>();
  private progress = new Map<Owner, ContinuationProgress[]>();
  readonly editing: AIEditOwnership;
  private tagTasks: ProjectTagTasks;
  private clients = new Map<string, string>();
  private access: () => ProjectConnectorAccess | undefined;
  constructor(host: ConnectorHost, access: () => ProjectConnectorAccess | undefined) {
    this.access = access;
    this.editing = new AIEditOwnership(tasks => host.editingActivity?.(tasks));
    const guarded = this.guard(host);
    this.hosts = new ProjectConnectorHosts(access, guarded);
    this.tagTasks = new ProjectTagTasks(this.hosts,guarded,access,this.editing);
    this.legacy = { host: guarded, controller: new AIConnector({ ...guarded, continuationProgress: tasks => {
      this.progress.set(this.legacy, tasks); this.notify(host);
    } }) };
    this.host = host;
  }
  private host: ConnectorHost;
  private guard(host: ConnectorHost): ConnectorHost {
    return { ...host, assertWrite: id => this.editing.assert(id),
      publish: (...args) => { this.editing.assert(args[3].task_id); return host.publish(...args); },
      applyMarks: (...args) => { this.editing.assert(args[2]); if (!host.applyMarks) throw Error('marks_unavailable'); return host.applyMarks(...args); } };
  }
  private notify(host: ConnectorHost) {
    const tasks = [...this.progress.values()].flat();
    for (const task of tasks) if (this.editing.get(task.task_id)) this.reconcile(task.task_id, { ...task, complete: task.state === 'completed' }, 'progress');
    host.continuationProgress?.(tasks);
  }
  private reconcile(id: string, result: Record<string, unknown>, operation: string) {
    const activity = this.editing.get(id); if (!activity) return;
    const receipt = result.result && typeof result.result === 'object' ? result.result as Record<string, unknown> : result;
    const complete = result.state === 'completed' && (receipt.saved === true || receipt.reason === 'no_changes' || result.complete === true)
      || result.complete === true || ['publish', 'apply_marks'].includes(operation) && (receipt.saved === true || receipt.reason === 'no_changes');
    // A later invalid request cannot overwrite a confirmed terminal receipt.
    if (activity.state === 'completed' && (!activity.requestId || activity.requestComplete) && !complete) return;
    const revoked = activity.state === 'ended' && ['user_ended','user_cancelled'].includes(activity.reason ?? '');
    const failed = !!receipt.error;
    const paused = result.state === 'paused' || operation === 'pause';
    const cancelled = result.state === 'cancelled' || operation === 'cancel' || operation === 'cancel_marks';
    const versionId=typeof result.version_id==='string'?result.version_id:activity.version_id;
    const versionName=typeof result.version==='string'?result.version:activity.version;
    const target=result.project_target as typeof activity.target ?? (activity.target?{...activity.target,version_id:versionId,version:versionName}:undefined);
    this.editing.update(id, {
      version_id:versionId,version:versionName,target,
      ...(target?{key:editTargetKey({target,version:{id:versionId} as ConnectorDocument['version'],identity:''})}:{}),
      state: revoked ? 'ended' : complete ? 'completed' : activity.state === 'ended' ? 'ended' : failed ? 'failed' : cancelled ? 'ended' : paused ? 'paused' : result.state === 'draft' || ownsEditing(activity) ? 'waiting' : activity.state,
      total: Number(result.request_total ?? result.total_segments ?? activity.total),
      requestId: typeof result.request_id === 'string' ? result.request_id : activity.requestId,
      requestStatus: revoked ? 'stopped' : result.request_status as typeof activity.requestStatus ?? activity.requestStatus,
      requestComplete: result.request_complete === true,
      phase: result.phase as typeof activity.phase ?? activity.phase,
      proofreadSaved: Number(result.proofread_saved ?? activity.proofreadSaved ?? 0),
      endedBy: typeof result.ended_by === 'string' ? result.ended_by : activity.endedBy,
      nextPhase: typeof result.next_phase === 'string' ? result.next_phase : activity.nextPhase,
      processed: complete ? activity.total : Number(result.staged ?? result.staged_count ?? (Array.isArray(result.staged_ids) ? result.staged_ids.length : activity.processed)),
      saved: Number(result.request_saved ?? result.saved_segments ?? (complete ? activity.total : activity.saved)),
      reason: revoked ? activity.reason : complete ? undefined : cancelled ? String(result.reason ?? 'user_cancelled') : failed ? String(receipt.error) : paused ? String(result.reason ?? 'user_paused') : activity.reason,
    });
  }
  private async owner(interview: string, recording: string, version: string): Promise<Owner> {
    const key = JSON.stringify([interview, recording, version]);
    let owner = this.owners.get(key);
    if (!owner || owner.bound?.target().version_id !== version) {
      if (this.owners.size >= 64) throw Error('too_many_project_targets_restart_connection');
      const bound = await this.hosts.bind(interview, recording, version);
      const next: Owner = { bound, host: this.guard(bound.host), controller: null! };
      next.controller = new AIConnector({ ...next.host, continuationProgress: tasks => {
        const target = bound.target();
        this.progress.set(next, tasks.map(task => ({ ...task, is_current: bound.isActive() && task.is_current, project_target: target })));
        this.notify(this.host);
      } });
      this.owners.set(key, next); owner = next;
    }
    return owner;
  }
  private remember(owner: Owner, result: Record<string, unknown>) {
    if (typeof result.snapshot === 'string') this.snapshots.set(result.snapshot, owner);
    if (typeof result.task_id === 'string') this.tasks.set(result.task_id, owner);
    if (this.snapshots.size > 256) this.snapshots.delete(this.snapshots.keys().next().value!);
    return owner.bound ? { ...result, target: result.target ?? owner.bound.target() } : result;
  }
  private async recover(taskId?: string) {
    const directory = await this.hosts.candidates();
    const results: Record<string, unknown>[] = [];
    for (const candidate of directory.candidates) {
      if (!candidate.versions.length) continue;
      const probe = await this.hosts.bind(candidate.interview_id, candidate.recording_id, candidate.versions[0].id);
      const journals=await probe.tasks();
      for (const task of journals) {
        if (taskId && task.id !== taskId) continue;
        if (this.tasks.has(task.id)) continue;
        const owner = await this.owner(candidate.interview_id, candidate.recording_id, task.target.id);
        this.tasks.set(task.id, owner);
        if (task.owner_client) this.clients.set(task.id, task.owner_client);
        let result = await owner.controller.handle('status', { task_id: task.id });
        if (result.result_version) owner.bound!.setVersion(result.result_version as Parameters<Bound['setVersion']>[0]);
        if (result.state === 'draft' && !this.editing.get(task.id)) result = await owner.controller.handle('pause', { task_id: task.id });
        if (!journals.some(t=>t.previous_task_id===task.id) && (result.state === 'paused' || result.state === 'completed' || result.state === 'cancelled' && !!result.request_id && result.reason !== 'user_cancelled')) {
          this.editing.restorePaused(task.id, task.owner_client ?? 'local', await owner.host.current(), task.ids.length, Number(result.saved_segments ?? 0));
          this.reconcile(task.id, result, 'status');
        }
        results.push({ ...result, target: owner.bound!.target() });
      }
    }
    return { project_id: directory.project_id, project: directory.project, tasks: results };
  }
  async handle(operation: string, args: Record<string, unknown>, client = 'local'): Promise<Record<string, unknown>> {
    if(operation.startsWith('tags_'))return this.tagTasks.handle(operation,args,client);
    if (operation === 'dismiss_editing') {
      if (client !== 'window') throw Error('window_action_required');
      this.editing.dismiss(String(args.task_id));
      return { dismissed: true };
    }
    if (operation === 'end_editing') {
      const id = String(args.task_id);
      if(this.tagTasks.has(id))return this.tagTasks.cancel(id,client);
      if (client !== 'window' && this.clients.get(id) !== client) throw Error('editing_task_belongs_to_another_client');
      this.editing.end(id);
      const owner = this.tasks.get(id);
      // Revocation is synchronous even if a save is already in progress. Cancelling
      // its journal may wait for that save; the original result remains queryable.
      if (owner) void owner.controller.handle(this.markIds.has(id) ? 'cancel_marks' : 'cancel', { task_id: id, initiator:'user', reason:'user_stop' }).catch(() => {});
      return { ended: true, already_saved_changes_retained: true };
    }
    if (operation === 'read_current' && this.access()?.project()) {
      const active = this.access()!.active();
      if (!active.version_id) throw Error('no_editable_interview');
      return this.handle('read_project', { interview_id: active.interview_id, recording_id: active.recording_id, version_id: active.version_id }, client);
    }
    if (operation === 'project_directory') {
      const directory = await this.hosts.candidates();
      const query = args.query === undefined ? '' : String(args.query).trim().toLocaleLowerCase();
      const cursor = args.cursor === undefined ? 0 : Number(args.cursor);
      const limit = args.limit === undefined ? 20 : Number(args.limit);
      if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isInteger(limit) || limit < 1 || limit > 50 || query.length > 200)
        throw Error('invalid_project_directory_range');
      const matches = directory.candidates.filter(item => !query || [item.interview, item.recording,
        ...item.versions.map(v => v.name)].some(name => name.toLocaleLowerCase().includes(query)));
      return { project_id: directory.project_id, project: directory.project, candidates: matches.slice(cursor, cursor + limit),
        next_cursor: cursor + limit < matches.length ? String(cursor + limit) : null, instructions: instruction };
    }
    if (operation === 'read_project') {
      if (typeof args.interview_id !== 'string' || typeof args.recording_id !== 'string')
        return { writable: false, needs_clarification: ['interview_and_recording'], instructions: instruction };
      const directory = await this.hosts.candidates();
      const candidate = directory.candidates.find(c => c.interview_id === args.interview_id && c.recording_id === args.recording_id);
      if (!candidate) throw Error('target_not_in_current_project');
      if (typeof args.version_id !== 'string' || !args.version_id)
        return { ...candidate, project_id: directory.project_id, project: directory.project,
          writable: false, needs_clarification: ['exact_version'], instructions: instruction };
      const owner = await this.owner(args.interview_id, args.recording_id, args.version_id);
      const result = this.remember(owner, await owner.controller.handle('read_current', {}));
      this.clients.set(String(result.snapshot), client);
      return { ...result, instructions: instruction };
    }
    if (operation === 'project_tasks') {
      const recovered = await this.recover();
      const tasks = [...recovered.tasks];
      for (const [id, owner] of this.tasks) if (owner.bound && !tasks.some(t => t.task_id === id))
        tasks.push(this.remember(owner, await owner.controller.handle(this.markIds.has(id) ? 'marks_status' : 'status', { task_id: id })));
      const metadata = tasks.filter(task => args.include_history === true || !['completed', 'cancelled'].includes(String(task.state))).map(task =>
        Object.fromEntries(['task_id','state','reason','target','result_version','save_mode','saved_segments','total_segments','saved_batches','version_id','previous_task_id','next_action','updated','request_id','request_saved','request_total','request_complete','whole_request','phase','proofread_saved','request_status','request_remaining_count','proofreading_remaining_count','ended_by','next_phase'].filter(key => task[key] !== undefined).map(key => [key, task[key]])));
      return { ...recovered, tasks: metadata, instructions: 'Metadata only. Use include_history to find cancelled/completed tasks. Query an exact task status to resume paused work or inspect cancelled remaining scope; never inherit historical instructions into a new task.' };
    }
    let owner: Owner | undefined;
    if (typeof args.snapshot === 'string') owner = this.snapshots.get(args.snapshot);
    if (typeof args.task_id === 'string') {
      owner = this.tasks.get(args.task_id);
      if (!owner) {
        // Durable project tasks survive a reconnect without selecting a default version.
        await this.recover(args.task_id).catch(error => {
          if (!(error instanceof Error && error.message === 'no_open_project')) throw error;
        });
        owner = this.tasks.get(args.task_id);
      }
    }
    owner ??= this.legacy;
    if (owner.bound) await this.hosts.project();
    const id = String(args.task_id ?? args.snapshot ?? '');
    const expected = this.clients.get(id);
    // The internal window may stop/recover tasks; remote clients cannot adopt another client's task.
    if (expected && client !== 'window' && expected !== client) {
      // Terminal receipt inspection grants no right to resume or write the old task.
      if (operation === 'status') {
        const status = await owner.controller.handle('status', args);
        if (['cancelled', 'completed'].includes(String(status.state))) return this.remember(owner, status);
      }
      throw Error('editing_task_belongs_to_another_client');
    }
    const preparing = operation === 'prepare' || operation === 'prepare_marks';
    const writing = ['stage', 'publish', 'batch', 'checkpoint', 'stage_marks', 'apply_marks'].includes(operation);
    let reserved: string | undefined;
    if (preparing) {
      const doc = await owner.host.current();
      reserved = crypto.randomUUID();
      this.editing.acquire(reserved, client, doc, operation === 'prepare_marks' ? 'marks' : args.delivery_mode === 'incremental' ? 'incremental' : 'text', 0, false, typeof args.previous_task_id === 'string' ? args.previous_task_id : undefined);
    }
    let activity = typeof args.task_id === 'string' ? this.editing.get(args.task_id) : undefined;
    if (operation === 'checkpoint' && activity && typeof args.batch_id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(args.batch_id)) {
      this.editing.update(activity.task_id, { saveAttempt: { batch_id: args.batch_id, received_at: new Date().toISOString() } });
    }
    if (writing && activity && activity.state !== 'completed') {
      this.editing.assert(activity.task_id, client === 'window' ? undefined : client);
      this.editing.update(activity.task_id, { inFlight: activity.inFlight + 1, state: ['publish','checkpoint','apply_marks'].includes(operation) ? 'saving' : 'processing' });
    }
    if (operation === 'resume' && activity) {
      if (activity.kind === 'incremental' && activity.state === 'ended' && !activity.inFlight && ['connection_lost','connection_failed','connection_disabled','task_timeout'].includes(activity.reason ?? '')) {
        // This explicit resume is the only way to re-acquire an interrupted lease.
        // Pause the durable journal first; its existing content guards remain intact.
        await owner.controller.handle('pause', args).catch(error => {
          if (!(error instanceof Error && error.message === 'task_not_editable')) throw error;
        });
        this.editing.update(activity.task_id, { state: 'paused' });
      }
      if (activity.state !== 'paused') throw Error('editing_task_ended_prepare_again');
      const doc = await owner.host.current();
      this.editing.acquire(activity.task_id, activity.client, doc, activity.kind, activity.total);
      activity = this.editing.get(activity.task_id);
    }
    try {
      const result = await owner.controller.handle(operation, preparing ? { ...args, owner_client: client } : args);
      if (reserved) {
        if (typeof result.task_id === 'string') {
          this.editing.rename(reserved, result.task_id);
          this.clients.set(result.task_id, client);
          this.editing.update(result.task_id, { total: Number(result.segment_count ?? 0) });
          if (typeof args.previous_task_id === 'string') this.editing.update(args.previous_task_id,{leaseSuperseded:true});
          if (args.delivery_mode === 'incremental') this.reconcile(result.task_id, await owner.controller.handle('status', {task_id: result.task_id}), 'status');
        } else {this.editing.end(reserved, 'clarification_required');this.editing.update(reserved,{leaseSuperseded:true});}
      }
      if (operation === 'prepare_marks' && typeof result.task_id === 'string') this.markIds.add(result.task_id);
      if (activity && (writing || ['pause','resume','cancel','cancel_marks','status','marks_status'].includes(operation))) {
        this.reconcile(activity.task_id, result, operation);
        if (owner.bound && result.result_version) {
          const target = owner.bound.target();
          const version = result.result_version as ConnectorDocument['version'];
          this.editing.update(activity.task_id, { target, version: target.version, version_id: target.version_id,
            key: editTargetKey({ target, version, identity: '' }) });
        }
      }
      const remembered = this.remember(owner, result);
      if (activity && ['status','marks_status'].includes(operation)) return { ...remembered, editing_state: activity.state, editing_reason: activity.reason,
        ...(operation === 'status' && remembered.save_diagnostics ? { save_diagnostics: {
          ...remembered.save_diagnostics as Record<string,unknown>,
          window_save_attempt: activity.saveAttempt ?? null,
          arrival_history_scope: 'current_window_session',
        }} : {}) };
      if (operation === 'read_current' && typeof result.snapshot === 'string') this.clients.set(result.snapshot, client);
      return remembered;
    } catch (error) {
      if (reserved) {this.editing.end(reserved, 'prepare_failed');this.editing.update(reserved,{leaseSuperseded:true});}
      if (activity && (writing || operation === 'resume') && activity.state !== 'completed' && activity.state !== 'ended') {
        this.editing.update(activity.task_id, { state: 'failed', reason: 'operation_failed_check_result' });
        // Consult the actual task receipt, including a save that finished before a
        // reply/validation error. Never infer success just from visible text/marks.
        try { this.reconcile(activity.task_id, await owner.controller.handle(this.markIds.has(activity.task_id) ? 'marks_status' : 'status', { task_id: activity.task_id }), 'status'); }
        catch { /* Uncertain outcome retains protection and the exact task. */ }
      }
      throw error;
    } finally {
      if (activity && writing) this.editing.update(activity.task_id, { inFlight: Math.max(0, activity.inFlight - 1) });
    }
  }
}
