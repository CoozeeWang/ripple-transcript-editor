import type { OpenProject } from './projectStore';
import type { RecentProject } from './nativeRecentProjects';
import { msg } from '../i18n';

export interface LinkProjectAccess {
 access: (directory: FileSystemDirectoryHandle) => Promise<string>;
 open: (directory: FileSystemDirectoryHandle) => Promise<OpenProject>;
 choose: () => Promise<FileSystemDirectoryHandle | null>;
 permit: (directory: FileSystemDirectoryHandle) => Promise<unknown>;
}
/** Only look at the explicitly active project or one saved candidate. Never search disks or match titles. */
export async function resolveLinkProject(id: string, active: OpenProject | null, recent: RecentProject[], io: LinkProjectAccess): Promise<OpenProject | null> {
 const candidates = recent.filter(item => item.id === id);
 const selected = active?.data.id === id ? active.directory : candidates.length === 1 ? candidates[0].directory : undefined;
 let project: OpenProject | null = null;
 if (selected) {
  try { if (await io.access(selected) === 'granted') project = await io.open(selected); }
  catch { /* Missing, moved or expired access requires an explicit new choice. */ }
 }
 if (!project) {
  const directory = await io.choose();
  if (!directory) return null;
  await io.permit(directory);
  project = await io.open(directory);
 }
 // This check must precede remembering a path, publishing a project or reading manuscript files.
 if (project.data.id !== id) throw Error(msg('ProjectWorkspace.recentProjectMismatch'));
 return project;
}
