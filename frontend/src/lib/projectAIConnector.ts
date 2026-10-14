import { AIConnector, type ConnectorHost } from './aiConnector';
import { ProjectConnectorHosts, type ProjectConnectorAccess } from './projectConnectorHost';
import type { ContinuationProgress } from './incrementalContinuation';

type Bound = Awaited<ReturnType<ProjectConnectorHosts['bind']>>;
interface Owner { controller: AIConnector; bound?: Bound }
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
  constructor(host: ConnectorHost, access: () => ProjectConnectorAccess | undefined) {
    this.hosts = new ProjectConnectorHosts(access, host);
    this.legacy = { controller: new AIConnector({ ...host, continuationProgress: tasks => {
      this.progress.set(this.legacy, tasks); this.notify(host);
    } }) };
    this.host = host;
  }
  private host: ConnectorHost;
  private notify(host: ConnectorHost) { host.continuationProgress?.([...this.progress.values()].flat()); }
  private async owner(interview: string, recording: string, version: string): Promise<Owner> {
    const key = JSON.stringify([interview, recording, version]);
    let owner = this.owners.get(key);
    if (!owner || owner.bound?.target().version_id !== version) {
      if (this.owners.size >= 64) throw Error('too_many_project_targets_restart_connection');
      const bound = await this.hosts.bind(interview, recording, version);
      const next: Owner = { bound, controller: null! };
      next.controller = new AIConnector({ ...bound.host, continuationProgress: tasks => {
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
      for (const task of await probe.tasks()) {
        if (taskId && task.id !== taskId) continue;
        if (this.tasks.has(task.id)) continue;
        const owner = await this.owner(candidate.interview_id, candidate.recording_id, task.target.id);
        this.tasks.set(task.id, owner);
        const result = await owner.controller.handle('status', { task_id: task.id });
        if (result.result_version) owner.bound!.setVersion(result.result_version as Parameters<Bound['setVersion']>[0]);
        results.push({ ...result, target: owner.bound!.target() });
      }
    }
    return { project_id: directory.project_id, project: directory.project, tasks: results };
  }
  async handle(operation: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
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
      return { ...this.remember(owner, await owner.controller.handle('read_current', {})), instructions: instruction };
    }
    if (operation === 'project_tasks') {
      const recovered = await this.recover();
      const tasks = [...recovered.tasks];
      for (const [id, owner] of this.tasks) if (owner.bound && !tasks.some(t => t.task_id === id))
        tasks.push(this.remember(owner, await owner.controller.handle(this.markIds.has(id) ? 'marks_status' : 'status', { task_id: id })));
      return { ...recovered, tasks };
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
    const result = await owner.controller.handle(operation, args);
    if (operation === 'prepare_marks' && typeof result.task_id === 'string') this.markIds.add(result.task_id);
    return this.remember(owner, result);
  }
}
