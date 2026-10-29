import { expect, it } from 'vitest';
import { populateSegmentDrag, type SegmentDragWriter } from './segmentDragPayload';
it('keeps native operation negotiation available and exports only interoperable text types', () => {
 const data=new Map([['text/uri-list','https://stale.invalid/']]);
 const transfer: SegmentDragWriter={clearData:()=>data.clear(),setData:(type:string,value:string)=>data.set(type,value),effectAllowed:'none',dropEffect:'none'};
 const snapshot={plain:'Synthetic (2)\n\nBody\n\nSource',html:'<div>Synthetic<br>Body<br><a href="https://example.com/">Source</a></div>'};
 populateSegmentDrag(transfer,snapshot);
 expect([...data]).toEqual([['text/plain',snapshot.plain],['text/html',snapshot.html]]);
 expect(transfer.effectAllowed).toBe('all');expect(transfer.dropEffect).toBe('copy');
 expect(snapshot.plain).toContain('Body');
});
