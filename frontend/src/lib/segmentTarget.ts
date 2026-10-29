import { readConnectorManifest, readModelEdit, readModelOriginal } from '../localStore';
import { recordingDirectory, type OpenProject, type ProjectInterview, type ProjectRecording } from './projectStore';
import type { SegmentTarget } from './segmentTransfer';
import { msg } from '../i18n';

/** The UUID identifies a version even after reassignment changes recording/model IDs. Hints never substitute for identity. */
export async function resolveSegmentTarget(project: OpenProject, target: SegmentTarget) {
 if (project.data.id !== target.project) throw Error(msg('ProjectWorkspace.recentProjectMismatch'));
 const matches: {session:ProjectInterview;recording:ProjectRecording;model:string;version:string}[]=[];
 // Search only indexed active material within this explicitly authorized project, never arbitrary paths.
 for (const session of project.data.interviews) for (const recording of session.recordings) {
  const directory=await recordingDirectory(project,session.id,recording);
  const manifest=await readConnectorManifest(directory,recording.file);
  for (const model of manifest?.models ?? []) {
   if (model.originalLinkId === target.identity && (model.original || model.designatedOriginal)) matches.push({session,recording,model:model.id,version:'original'});
   for (const edit of model.edits) if (edit.linkId === target.identity) {
    const sourceEdit = model.designatedOriginalEditId ?? model.activeEditId;
    if (!model.designatedOriginal || sourceEdit === edit.id) matches.push({session,recording,model:model.id,version:model.designatedOriginal ? 'original' : edit.id});
   }
  }
 }
 if (matches.length !== 1) throw Error(msg('segmentTransfer.missing'));
 const match=matches[0];
 const directory=await recordingDirectory(project,match.session.id,match.recording);
 const file=match.version === 'original' ? await readModelOriginal(directory,match.recording.file,match.model) : await readModelEdit(directory,match.recording.file,match.model,match.version);
 if (!file?.transcript.segments.some(segment=>segment.id === target.segment)) throw Error(msg('segmentTransfer.missing'));
 return match;
}
