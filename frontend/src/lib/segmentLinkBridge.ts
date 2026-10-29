/** Native queue remains authoritative until the UI is ready to accept one URL. */
export async function nextSegmentLink(): Promise<string | null> {
 const bridge = (window as unknown as {__TAURI__?:{core?:{invoke:<T>(name:string)=>Promise<T>}}}).__TAURI__?.core;
 return bridge ? bridge.invoke<string | null>('segment_link_next') : null;
}
