import { readConnectorRules, writeConnectorRules, readContinuationTasks, writeContinuationTask,
  readConnectorManifest, readModelEdit, readModelOriginal, saveConnectorVersion } from '../localStore';
import { parseProject, recordingDirectory, type OpenProject, type ProjectRecording } from './projectStore';
import { connectorReferences, connectorVersions } from './connectorVersions';
import type { ConnectorDocument, ConnectorHost, ConnectorVersion } from './aiConnector';
import { applyAISuggestions } from './aiVersionEdits';
import { applyAIMarks } from './aiMarks';
import { applyContinuationBatch, checkContinuationGuard } from './continuationBatch';

export interface ProjectTarget {
  project_id: string; project: string; interview_id: string; interview: string;
  recording_id: string; recording: string; version_id: string; version: string;
}
export interface ProjectConnectorAccess {
  onSaved?: (target: ProjectTarget) => void;
  project: () => OpenProject | null;
  active: () => { interview_id: string; recording_id: string; version_id: string | null;
    directory: FileSystemDirectoryHandle | null };
}
export interface ProjectCandidate {
  interview_id: string; interview: string; recording_id: string; recording: string;
  versions: ConnectorVersion[];
  unavailable?: boolean;
}
const signature = (interview: string, r: ProjectRecording) => JSON.stringify([interview, r.id, r.name, r.file, r.storage, r.fingerprint, r.manuscriptDirectory]);

/** Project handles come only from the open workspace; no client-provided paths. */
export class ProjectConnectorHosts {
  private projectId = '';
  private scope = crypto.randomUUID();
  private directories = new Map<string, { signature: string; directory: Promise<FileSystemDirectoryHandle> }>();
  constructor(private access: () => ProjectConnectorAccess | undefined, private activeHost: ConnectorHost) {}
  async project(): Promise<OpenProject> {
    const current = this.access()?.project();
    if (!current) throw Error('no_open_project');
    if (this.projectId && this.projectId !== current.data.id) throw Error('project_changed_read_directory_again');
    const data = parseProject(await (await (await current.directory.getFileHandle('ripple-project.json')).getFile()).text());
    const fresh = { ...current, data };
    if (this.access()?.project()?.directory !== current.directory || fresh.data.id !== current.data.id)
      throw Error('project_changed_read_directory_again');
    this.projectId = fresh.data.id;
    return fresh;
  }
  private async locate(interviewId: string, recordingId: string, expected?: string) {
    const project = await this.project();
    const interview = project.data.interviews.find(i => i.id === interviewId);
    const recording = interview?.recordings.find(r => r.id === recordingId);
    if (!interview || !recording) throw Error('target_not_in_current_project');
    const key = `${interviewId}:${recordingId}`, stamp = signature(interview.title, recording);
    if (expected !== undefined && stamp !== expected) throw Error('project_target_changed_read_directory_again');
    let cached = this.directories.get(key);
    if (!cached || cached.signature !== stamp) {
      const active = this.access()?.active();
      const directory = active?.interview_id === interviewId && active.recording_id === recordingId && active.directory
        ? Promise.resolve(active.directory) : recordingDirectory(project, interviewId, recording);
      cached = { signature: stamp, directory }; this.directories.set(key, cached);
    }
    return { project, interview, recording, stamp, directory: await cached.directory };
  }
  async candidates(): Promise<{ project_id: string; project: string; candidates: ProjectCandidate[] }> {
    const project = await this.project(), candidates: ProjectCandidate[] = [];
    for (const interview of project.data.interviews) for (const recording of interview.recordings) {
      let versions: ConnectorVersion[] = [], unavailable = false;
      try {
        const entry = await this.locate(interview.id, recording.id);
        versions = connectorVersions((await readConnectorManifest(entry.directory, recording.file))?.models ?? []);
      } catch (error) {
        if (error instanceof Error && ['no_open_project', 'project_changed_read_directory_again', 'target_not_in_current_project'].includes(error.message)) throw error;
        unavailable = true;
      }
      candidates.push({ interview_id: interview.id, interview: interview.title,
        recording_id: recording.id, recording: recording.name, versions, ...(unavailable ? { unavailable: true } : {}) });
    }
    await this.project();
    return { project_id: project.data.id, project: project.data.title, candidates };
  }
  async bind(interviewId: string, recordingId: string, versionId: string) {
    const entry = await this.locate(interviewId, recordingId);
    const versions = connectorVersions((await readConnectorManifest(entry.directory, entry.recording.file))?.models ?? []);
    let version = versions.find(v => v.id === versionId);
    if (!version) throw Error('target_version_unavailable');
    const identity = `${this.scope}:${entry.project.data.id}:${interviewId}:${recordingId}`;
    const check = async () => { await this.locate(interviewId, recordingId, entry.stamp); };
    const isActive = () => {
      const active = this.access()?.active();
      return active?.interview_id === interviewId && active.recording_id === recordingId && active.version_id === version!.id;
    };
    const target = (): ProjectTarget => ({ project_id: entry.project.data.id, project: entry.project.data.title,
      interview_id: interviewId, interview: entry.interview.title, recording_id: recordingId,
      recording: entry.recording.name, version_id: version!.id, version: version!.name });
    const current = async (): Promise<ConnectorDocument> => {
      await check();
      const manifest = await readConnectorManifest(entry.directory, entry.recording.file);
      const selected = connectorVersions(manifest?.models ?? []).find(v => v.id === version!.id);
      if (!selected) throw Error('target_version_unavailable');
      version = selected;
      // A targeted active version must see unsaved editor changes before snapshotting.
      const activeDocument = isActive() ? await this.activeHost.current() : null;
      const data = activeDocument ?? (version.kind === 'original'
        ? await readModelOriginal(entry.directory, entry.recording.file, version.model_id)
        : await readModelEdit(entry.directory, entry.recording.file, version.model_id, version.edit_id));
      await check();
      if (!data) throw Error('target_version_unavailable');
      return { identity, target: target(), background: !isActive(), editable: version.kind === 'edit', transcript: data.transcript,
        title: entry.recording.name, label: version.name, version,
        names: connectorVersions(manifest?.models ?? []).map(v => v.name),
        rules: await readConnectorRules(entry.directory, entry.recording.file),
        remember: async rules => { await check(); await writeConnectorRules(entry.directory, entry.recording.file, rules); },
        references: async () => { await check(); return connectorReferences(entry.directory, entry.recording.file,
          (await readConnectorManifest(entry.directory, entry.recording.file))?.models ?? []); },
        continuations: { scope: identity, read: async () => { await check(); return readContinuationTasks(entry.directory, entry.recording.file); },
          write: async task => { await check(); await writeContinuationTask(entry.directory, entry.recording.file, task); } },
      };
    };
    const host: ConnectorHost = { current,
      publish: async (baseline, suggestions, name, saveTarget) => {
        const guard = async () => { await check(); this.activeHost.assertWrite?.(saveTarget.task_id); };
        await guard();
        if (saveTarget.identity !== identity || saveTarget.source_version.id !== version!.id)
          throw Error('source_changed_read_current_again');
        let result: Record<string, unknown>;
        if (isActive()) {
          const doc = await this.activeHost.current();
          await guard();
          if (!isActive() || doc.version.id !== version!.id) throw Error('source_changed_read_current_again');
          result = await this.activeHost.publish(baseline, suggestions, name, { ...saveTarget, identity: doc.identity });
        } else {
          const saved = await saveConnectorVersion(entry.directory, entry.recording.file, {
            version: version!, baseline, check: guard,
            allowRebase: !!saveTarget.checkpoint,
            name: saveTarget.save_mode === 'new_version' ? name : undefined,
            update: existing => {
              if (saveTarget.checkpoint) {
                if (!checkContinuationGuard(existing, saveTarget.checkpoint.guard)) throw Error('batch_conflict_manual_changes_preserved');
                return applyContinuationBatch(existing, suggestions, saveTarget.checkpoint);
              }
              return applyAISuggestions(existing, baseline, suggestions);
            },
          });
          result = { version: saved.version.name, version_id: saved.version.edit_id, result_version: saved.version,
            comparison_requested: false, undo_available: false, background: true };
        }
        if (saveTarget.checkpoint && result.result_version) version = result.result_version as ConnectorVersion;
        const savedTarget = { ...target(), version_id: (result.result_version as ConnectorVersion)?.id ?? version!.id,
          version: (result.result_version as ConnectorVersion)?.name ?? version!.name };
        if (result.background) this.access()?.onSaved?.(savedTarget);
        return { ...result, target: savedTarget };
      },
      applyMarks: async (baseline, marks, taskId) => {
        const guard = async () => { await check(); this.activeHost.assertWrite?.(taskId); };
        await guard();
        if (isActive()) {
          const result = await this.activeHost.applyMarks!(baseline, marks, taskId);
          return { ...result, target: target() };
        }
        let counts = { added_annotations: 0, added_highlights: 0 };
        await saveConnectorVersion(entry.directory, entry.recording.file, { version: version!, baseline, check: guard,
          update: existing => {
            if (JSON.stringify(existing) !== JSON.stringify(baseline)) throw Error('source_changed_read_current_again');
            const result = applyAIMarks(existing, marks, taskId);
            counts = { added_annotations: result.added_annotations, added_highlights: result.added_highlights }; return result.transcript;
          } });
        this.access()?.onSaved?.(target());
        return { saved: true, version: version!.name, version_id: version!.edit_id, target: target(), ...counts, background: true, undo_available: false };
      },
    };
    return { host, target, isActive, tasks: async () => {
      await check(); return readContinuationTasks(entry.directory, entry.recording.file);
    }, setVersion: (next: ConnectorVersion) => { version = next; } };
  }
}
