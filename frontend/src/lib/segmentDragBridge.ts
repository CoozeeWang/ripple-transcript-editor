import type { segmentTransfer } from './segmentTransfer';
type Payload = ReturnType<typeof segmentTransfer>;
function bridge() { return (window as unknown as {__TAURI__?:{core?:{invoke:<T>(command:string,args:unknown)=>Promise<T>}}}).__TAURI__?.core; }
export function hasNativeSegmentDrag() { return /Mac/.test(navigator.platform) && !!bridge(); }
/** Resolves only when AppKit ends the session, including cancellation. */
export async function startNativeSegmentDrag(payload: Payload): Promise<boolean> {
 const native=bridge();if(!native)throw Error('Native drag unavailable');
 return native.invoke<boolean>('start_segment_drag',{payload});
}
