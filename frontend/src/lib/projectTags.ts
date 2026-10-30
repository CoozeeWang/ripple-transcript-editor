import { readManifest, readModelEdit, readModelOriginal } from '../localStore';
import type { Transcript } from '../types';
import { recordingDirectory, type OpenProject } from './projectStore';
import { originalGroups } from './originalGroups';
import { type TagLibrary, countProjectTags } from './tags';
export interface TagCountVersion {
    recordingId: string;
    modelId: string;
    transcript: Transcript;
}
/** A manuscript is one confirmed original group shown in the project board, not each editing model or revision.
 * The visible version substitutes its manuscript's representative even when it is an original.
 * Trash is deliberately excluded. Failure is surfaced; partial counts are never returned.
 */
export async function projectTagCounts(project: OpenProject, current: TagCountVersion, library?:TagLibrary): Promise<Map<string, number>> {
    const versions: {
        manuscriptId: string;
        transcript: Transcript;
    }[] = [];
    for (const interview of project.data.interviews)
        for (const recording of interview.recordings) {
            const directory = await recordingDirectory(project, interview.id, recording);
            const manifest = await readManifest(directory, recording.file);
            for (const group of originalGroups(manifest?.models ?? [])) {
                const viewed = recording.id === current.recordingId && group.models.some(model => model.id === current.modelId);
                const editing = group.models.filter(model => !model.designatedOriginal && model.edits.some(edit => edit.id === model.activeEditId));
                const active = editing.find(model => model.id === manifest?.activeModelId);
                const recent = [...editing].sort((a, b) => {
                    const updated = (model: typeof a) => model.edits.find(edit => edit.id === model.activeEditId)?.updated_at ?? '';
                    return updated(b).localeCompare(updated(a)) || a.id.localeCompare(b.id);
                })[0];
                const model = active ?? recent ?? group.original ?? group.models[0];
                const transcript = viewed ? current.transcript : (model.designatedOriginal || !model.edits.length
                    ? await readModelOriginal(directory, recording.file, model.id) : await readModelEdit(directory, recording.file, model.id, model.activeEditId))?.transcript;
                if (!transcript)
                    throw new Error('tag_count_version_unavailable');
                versions.push({ manuscriptId: `${recording.id}:${(group.original ?? group.models[0]).id}`, transcript });
            }
        }
    return countProjectTags(versions,library??project.data.tagLibrary);
}
