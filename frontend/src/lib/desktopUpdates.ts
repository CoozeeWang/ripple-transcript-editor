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
export function isDesktopUpdateWindow() { return typeof window !== 'undefined' && Boolean((window as unknown as {__RIPPLE_UPDATE_WINDOW__?:unknown}).__RIPPLE_UPDATE_WINDOW__); }
export async function prepareDesktopUpdate(): Promise<void> {
  if (isDesktopUpdateWindow()) return desktopUpdateInvoke<void>('update_prepare');
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
};

// Only the main editor owns draft/save guards. The auxiliary window must ask it.
type UpdateEvent = { payload: number };
type NativeEvents = { listen: (name: string, handler: (event: UpdateEvent) => void) => Promise<() => void> };
export async function installDesktopUpdateBridge(): Promise<() => void> {
  const tauri = (window as unknown as {__TAURI__?:{event?:NativeEvents;core?:{invoke:(name:string,args?:Record<string,unknown>)=>Promise<unknown>}}}).__TAURI__;
  if (!tauri?.event || !tauri.core) return () => {};
  let inFlight = false, released = false;
  const unprepare = await tauri.event.listen('desktop-update-prepare', event => {
    if(inFlight) { void tauri.core!.invoke('update_prepared',{token:event.payload,error:'update_work_in_progress'}).catch(()=>{}); return; }
    inFlight=true;released=false;
    void (async()=>{
      let error:string|null=null;
      try { await prepareDesktopUpdate(); } catch(e) { error=e instanceof Error?e.message:'update_work_in_progress'; }
      if(released) { cancelDesktopUpdatePreparation();inFlight=false;return; }
      try { await tauri.core!.invoke('update_prepared',{token:event.payload,error}); }
      catch { cancelDesktopUpdatePreparation(); }
      finally { inFlight=false; }
    })();
  });
  const unrelease = await tauri.event.listen('desktop-update-release',()=>{
    released=true; if(!inFlight)cancelDesktopUpdatePreparation();
  });
  return ()=>{unprepare();unrelease();cancelDesktopUpdatePreparation();};
}
