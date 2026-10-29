import { expect, it, vi } from 'vitest';
import { createSegmentLinkDelivery } from './segmentLinkDelivery';
it('does not dequeue before ready, and retains a URL if readiness changes during fetch',async()=>{
 let ready=false; const open=vi.fn(async()=>{}); const next=vi.fn(async()=>{ready=false;return 'synthetic-link';});
 const deliver=createSegmentLinkDelivery(next); const receiver={ready:()=>ready,open};
 await deliver(receiver);expect(next).not.toHaveBeenCalled();
 ready=true;await deliver(receiver);expect(open).not.toHaveBeenCalled();
 ready=true;await deliver(receiver);expect(open).toHaveBeenCalledExactlyOnceWith('synthetic-link');expect(next).toHaveBeenCalledTimes(1);
});
it('serializes saving/opening and releases the queue after a handled failure',async()=>{
 let finish!:()=>void; const wait=new Promise<void>(resolve=>{finish=resolve;});
 const next=vi.fn(async()=> 'synthetic-link');const deliver=createSegmentLinkDelivery(next);
 const first=deliver({ready:()=>true,open:async()=>wait});await Promise.resolve();
 await deliver({ready:()=>true,open:vi.fn()});expect(next).toHaveBeenCalledTimes(1);
 finish();await first;
 await expect(deliver({ready:()=>true,open:async()=>{throw Error('save failed');}})).rejects.toThrow('save failed');
 await deliver({ready:()=>true,open:async()=>{}});expect(next).toHaveBeenCalledTimes(3);
});
