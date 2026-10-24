import { nativeDesktopAvailable } from './desktopFs';

export type UpdatePhase = 'idle'|'checking'|'current'|'no_releases'|'unavailable'|'available'|'error';
export interface DesktopUpdateInfo {
  currentVersion: string; build: string|null; phase: UpdatePhase; availableVersion: string|null;
  notes: string|null; error: string|null; releaseUrl: string|null;
}
export function isDesktopUpdateWindow() {
  return typeof window !== 'undefined' && Boolean((window as unknown as {__RIPPLE_UPDATE_WINDOW__?:unknown}).__RIPPLE_UPDATE_WINDOW__);
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
  releases: () => desktopUpdateInvoke<void>('update_open_releases'),
};
