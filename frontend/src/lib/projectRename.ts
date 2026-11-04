import type { ProjectConnectorAccess } from './projectConnectorHost';
import { ProjectConnectorHosts } from './projectConnectorHost';
import { acquireProjectEditor, renameProjectMetadata, recordingDirectory, withProjectLock } from './projectStore';
import { renameConnectorVersionLabel } from '../localStore';
import { blocksHumanEditing, type AIEditOwnership } from './aiEditOwnership';

export type RenameKind = 'project' | 'session' | 'audio' | 'transcript';
export interface RenameTarget {
  target_type: RenameKind; project_id: string; interview_id?: string; recording_id?: string; version_id?: string;
}
export interface RenameRequest extends RenameTarget { expected_name: string; new_name: string }
export function parseRenameRequest(args: Record<string, unknown>): RenameRequest {
  const kinds = ['project', 'session', 'audio', 'transcript'];
  if (!kinds.includes(String(args.target_type))) throw Error('invalid_rename_target');
  const kind = args.target_type as RenameKind;
  const required = ['project_id', ...(kind !== 'project' ? ['interview_id'] : []),
    ...(['audio', 'transcript'].includes(kind) ? ['recording_id'] : []), ...(kind === 'transcript' ? ['version_id'] : [])];
  if (required.some(key => typeof args[key] !== 'string' || !args[key] || String(args[key]).length > 200)) throw Error('rename_target_ids_required');
  if (Object.keys(args).some(key => ![...required, 'target_type', 'expected_name', 'new_name'].includes(key))) throw Error('invalid_rename_arguments');
  if (typeof args.expected_name !== 'string' || typeof args.new_name !== 'string') throw Error('rename_names_required');
  const name = args.new_name.trim();
  if (!name || name.length > 200 || Array.from(name).some(char=>char.charCodeAt(0)<32||char.charCodeAt(0)===127)) throw Error('invalid_rename_name');
  return { ...args, new_name: name } as unknown as RenameRequest;
}

/** Metadata-only writes through the ordinary project and manuscript queues. No client paths. */
export async function renameProjectItem(hosts: ProjectConnectorHosts, access: () => ProjectConnectorAccess | undefined,
  editing: AIEditOwnership, raw: Record<string, unknown>): Promise<Record<string, unknown>> {
  const request = parseRenameRequest(raw);
  const initial = await hosts.project();
  if (initial.data.id !== request.project_id) throw Error('rename_project_changed');
  const check = () => {
    const current = access()?.project();
    if (!current || current.data.id !== request.project_id || current.directory !== initial.directory) throw Error('rename_project_changed');
    if (editing.values().some(task => blocksHumanEditing(task) && (!task.target || task.target.project_id === request.project_id &&
      (task.projectScope || request.target_type === 'project' || task.target.interview_id === request.interview_id &&
        (request.target_type === 'session' || task.target.recording_id === request.recording_id)))))
      throw Error('rename_target_in_use');
    access()?.assertRenameReady?.();
  };
  check();
  const end = access()?.beginRename?.();
  let release: (() => void) | undefined;
  try {
    if (!access()?.active().directory) release = await acquireProjectEditor(initial.data.id);
    check();
    let changed: boolean;
    let published = initial;
    if (request.target_type === 'transcript') {
      changed = await withProjectLock(initial.data.id, async () => {
        check();
        const fresh = await hosts.project();
        const session = fresh.data.interviews.find(item => item.id === request.interview_id);
        const recording = session?.recordings.find(item => item.id === request.recording_id);
        if (!session || !recording) throw Error('target_not_in_current_project');
        const directory = await recordingDirectory(fresh, session.id, recording);
        const result = await renameConnectorVersionLabel(directory, recording.file, request.version_id!, request.expected_name, request.new_name, check);
        published = fresh;
        return result;
      });
    } else {
      const result = await renameProjectMetadata(initial, request, check);
      changed = result.changed; published = result.project;
    }
    // A notification failure must not turn a durable rename into an ambiguous write failure.
    let viewUpdated = true;
    try {
      await access()?.publishTagProject?.(published);
      access()?.onRenamed?.(request);
    } catch { viewUpdated = false; }
    return { saved: true, changed, target: { target_type: request.target_type, project_id: request.project_id,
      ...(request.interview_id ? { interview_id: request.interview_id } : {}),
      ...(request.recording_id ? { recording_id: request.recording_id } : {}),
      ...(request.version_id ? { version_id: request.version_id } : {}) },
      previous_name: changed ? request.expected_name : request.new_name, name: request.new_name,
      view_updated: viewUpdated, content_unchanged: true, paths_unchanged: true };
  } finally { release?.(); end?.(); }
}
