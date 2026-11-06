export interface SegmentLinkReceiver { ready: () => boolean; open: (raw: string) => Promise<void>; openProject?: (directory: FileSystemDirectoryHandle) => Promise<void> }
/** Keep a fetched request until the current editor can accept it; serialize the whole save/open operation. */
export function createSegmentLinkDelivery<T = string>(next: () => Promise<T | null>) {
 let pending: T | null = null;
 let busy = false;
 return async (receiver: { ready: () => boolean; open: (value: T) => Promise<void> }) => {
  if (busy || !receiver.ready()) return;
  busy = true;
  try {
   pending ??= await next();
   if (!pending || !receiver.ready()) return;
   const raw = pending; pending = null;
   await receiver.open(raw);
   return true;
  } finally { busy = false; }
 };
}
