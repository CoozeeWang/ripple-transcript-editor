export interface SegmentLinkReceiver { ready: () => boolean; open: (raw: string) => Promise<void> }
/** Keep a fetched URL until the current editor can accept it; serialize the whole save/open operation. */
export function createSegmentLinkDelivery(next: () => Promise<string | null>) {
 let pending: string | null = null;
 let busy = false;
 return async (receiver: SegmentLinkReceiver) => {
  if (busy || !receiver.ready()) return;
  busy = true;
  try {
   pending ??= await next();
   if (!pending || !receiver.ready()) return;
   const raw = pending; pending = null;
   await receiver.open(raw);
  } finally { busy = false; }
 };
}
