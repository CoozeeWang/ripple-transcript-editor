import { nativeDesktopAvailable } from './desktopFs';

export type UpdatePhase = 'idle'|'checking'|'current'|'unavailable'|'available'|'downloading'|'verifying'|'ready'|'installing'|'error';
export interface DesktopUpdateInfo {
  currentVersion: string; build: string|null; phase: UpdatePhase; availableVersion: string|null;
  notes: string|null; downloaded: number; total: number|null; error: string|null;
  result: { status: string; version: string }|null;
}
const guards = new Set<() => Promise<void>>();
let preparing = false;
export function desktopUpdatePreparing() { return preparing; }
export function cancelDesktopUpdatePreparation() { preparing=false; }
export function assertDesktopUpdateIdle() { if(preparing)throw Error('update_work_in_progress'); }
export function registerDesktopUpdateGuard(guard: () => Promise<void>) {
  guards.add(guard); return () => { guards.delete(guard); };
}
/** A missing workspace guard is not permission to terminate the application. */
export async function prepareDesktopUpdate(): Promise<void> {
  if (!guards.size) throw Error('update_work_in_progress');
  if (preparing) throw Error('update_work_in_progress');
  preparing=true;
  try { for (const guard of [...guards]) await guard(); }
  catch(error){preparing=false;throw error;}
}
export function desktopUpdatesAvailable() { return nativeDesktopAvailable(); }
export function desktopUpdateInvoke<T>(command: string): Promise<T> {
  const tauri = (window as unknown as {__TAURI__?:{core?:{invoke:<R>(name:string)=>Promise<R>}}}).__TAURI__;
  if (!tauri?.core?.invoke) return Promise.reject(Error('update_development'));
  return tauri.core.invoke<T>(command);
}
export const desktopUpdates = {
  status: () => desktopUpdateInvoke<DesktopUpdateInfo>('update_status'),
  check: () => desktopUpdateInvoke<DesktopUpdateInfo>('update_check'),
  download: () => desktopUpdateInvoke<DesktopUpdateInfo>('update_download'),
  cancel: () => desktopUpdateInvoke<void>('update_cancel'),
  install: () => desktopUpdateInvoke<void>('update_install'),
  releases: () => desktopUpdateInvoke<void>('update_open_releases'),
  dismissResult: () => desktopUpdateInvoke<void>('update_dismiss_result'),
};
