import { loadBooleanPreference } from './preferences';
import { handleValue, type OpenProject } from './projectStore';

export const OPEN_LAST_PROJECT = 'ripple-open-last-project';
export const RESTORE_PROJECT_INTERVIEW = 'ripple-restore-project-interview';
export const FIXED_PROJECT_LOCATION = 'ripple-fixed-project-location';
export const loadProjectLocation = (fixed: boolean) => handleValue<FileSystemDirectoryHandle>(fixed ? 'preferred-project-parent' : 'last-project-parent');
export const saveProjectLocation = (handle: FileSystemDirectoryHandle, fixed = false) => handleValue(fixed ? 'preferred-project-parent' : 'last-project-parent', handle);
export async function defaultProjectLocation() {
  try { return await loadProjectLocation(loadBooleanPreference(FIXED_PROJECT_LOCATION, false)) ?? null; }
  catch { return null; }
}
export function restoredInterview(project: OpenProject): string | null {
  const first = project.data.interviews[0]?.id ?? null;
  if (!loadBooleanPreference(RESTORE_PROJECT_INTERVIEW, true)) return first;
  try {
    const id = localStorage.getItem(`ripple-project-interview:${project.data.id}`);
    return project.data.interviews.some(i => i.id === id) ? id : first;
  } catch { return first; }
}
export function rememberInterview(projectId: string, interviewId: string) {
  try { localStorage.setItem(`ripple-project-interview:${projectId}`, interviewId); } catch { /* Local preferences may be unavailable. */ }
}
// Startup must not request new access without a user gesture.
export async function canRestoreProject(directory: FileSystemDirectoryHandle) {
  const handle = directory as FileSystemDirectoryHandle & { queryPermission?: (options: { mode: string }) => Promise<string> };
  return Boolean(handle.queryPermission && await handle.queryPermission({ mode: 'readwrite' }) === 'granted');
}

export type PickerPurpose = 'save-project' | 'open-project' | 'open-audio' | 'open-audio-folder' | 'open-manuscript';
export async function pickerLocation(purpose: PickerPurpose, mode: 'read' | 'readwrite' = 'readwrite') {
  const id = `ripple-${purpose}`;
  try {
    const fixed = purpose === 'save-project' && loadBooleanPreference(FIXED_PROJECT_LOCATION, false);
    const handle = fixed ? await loadProjectLocation(true)
      : purpose === 'save-project' ? await loadProjectLocation(false)
      : await handleValue<FileSystemDirectoryHandle>(`picker:${purpose}`);
    const query = handle as (FileSystemDirectoryHandle & { queryPermission?: (o: { mode: string }) => Promise<string> }) | undefined;
    if (query?.queryPermission && await query.queryPermission({ mode }) === 'granted') return { id, startIn: handle };
  } catch { /* Let the system picker choose a usable location. */ }
  return { id };
}
export async function chooseDirectory(purpose: PickerPurpose, mode: 'read' | 'readwrite' = 'readwrite') {
  const options = await pickerLocation(purpose, mode);
  const picker = window as unknown as { showDirectoryPicker: (o: { mode: string; id: string; startIn?: FileSystemDirectoryHandle }) => Promise<FileSystemDirectoryHandle> };
  const handle = await picker.showDirectoryPicker({ ...options, mode });
  try {
    if (purpose === 'save-project') await saveProjectLocation(handle);
    else await handleValue(`picker:${purpose}`, handle);
  } catch { /* Remembering a location must not block the selected directory. */ }
  return handle;
}
