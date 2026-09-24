import { expect,it } from "vitest";
import { comparisonRows } from "./comparisonSegments";
const segment=(id:string,text=id)=>({id,text,start:0,end:1,speaker_id:"s"});
it("places deletion ghosts without moving current segments, including trailing and complete deletion",()=>{
 const before=[segment("a"),segment("b"),segment("c"),segment("d")];
 const rows=comparisonRows([segment("b","B"),segment("new"),segment("c")],before);
 expect(rows.map(r=>[r.segment.id,r.deleted])).toEqual([["a",true],["b",false],["new",false],["c",false],["d",true]]);
 expect(rows[1].before).toBe("b");expect(rows[2].before).toBe("");
 expect(comparisonRows([],before).every(r=>r.deleted)).toBe(true);
 expect(comparisonRows([segment("b")],undefined)[0].before).toBeUndefined();
});

import { mergeSegmentWithNext, splitSegmentAt } from "./segmentOps";
import { revisionFor } from "./revisions";
const timed=(id:string,text:string,start:number,end:number)=>({...segment(id,text),start,end});
it("compares repeated merges without marking unchanged text or creating ghosts",()=>{
 const baseline=[timed("a","第一段。",0,2),timed("b","第二段。",3,5),timed("c","第三段。",5,8)];
 const current=mergeSegmentWithNext(mergeSegmentWithNext(baseline,"a")!,"a")!;
 const rows=comparisonRows(current,baseline);
 expect(rows).toHaveLength(1);
 expect(rows[0].before).toBe(current[0].text);
 expect(revisionFor(rows[0].before!,{id:"a",text:current[0].text,reason:""}).parts.every(p=>!p.changed)).toBe(true);
 expect(baseline.map(s=>s.text)).toEqual(["第一段。","第二段。","第三段。"]);
});
it("marks only actual word changes and preserves deletions outside the merge",()=>{
 const baseline=[timed("a","我可能去。",0,2),timed("b","你也去。",3,5),timed("c","不用了。",6,8)];
 const merged=mergeSegmentWithNext(baseline,"a")![0];
 const rows=comparisonRows([{...merged,text:"我去。\n你也去。"}],baseline);
 expect(rows.map(r=>[r.segment.id,r.deleted])).toEqual([["a",false],["c",true]]);
 const changes=revisionFor(rows[0].before!,{id:"a",text:rows[0].segment.text,reason:""}).parts.filter(p=>p.changed);
 expect(changes.map(p=>[p.before,p.after])).toEqual([["可能",""]]);
});
it("retains deleted text inside an expanded merge as inline deletions",()=>{
 const baseline=[timed("a","甲",0,2),timed("b","嗯。",3,4),timed("c","乙",5,7)];
 const rows=comparisonRows([{...baseline[0],end:7,text:"甲\n乙"}],baseline);
 expect(rows).toHaveLength(1);
 expect(rows[0].before).toBe("甲\n嗯。\n乙");
});
it("does not consume surviving neighbours or infer merges from partial time boundaries",()=>{
 const baseline=[timed("a","甲",0,2),timed("b","乙",3,5),timed("c","丙",6,8)];
 const rows=comparisonRows([{...baseline[0],end:8},baseline[1]],baseline);
 expect(rows[0].before).toBe("甲");
 expect(rows.some(r=>r.segment.id==="c"&&r.deleted)).toBe(true);
 expect(comparisonRows([{...baseline[0],end:6}],baseline).filter(r=>r.deleted)).toHaveLength(2);
});

it.each([[0,5,2,5],[0,8,2,4],[2,5,0,4]])("uses actual merge sources with overlapping or equal-end time ranges",(aStart,aEnd,bStart,bEnd)=>{
 const baseline=[timed("a","甲",aStart,aEnd),timed("b","乙",bStart,bEnd)];
 const current=mergeSegmentWithNext(baseline,"a")!;
 const rows=comparisonRows(current,baseline);
 expect(rows).toHaveLength(1);expect(rows[0].before).toBe("甲\n乙");
 expect(current[0].start).toBe(Math.min(aStart,bStart));expect(current[0].end).toBe(Math.max(aEnd,bEnd));
});
it("does not include a separately deleted paragraph merely because it lies inside a later merge",()=>{
 const baseline=[timed("a","甲",0,2),timed("b","删除",2,4),timed("c","丙",4,6)];
 const current=mergeSegmentWithNext([baseline[0],baseline[2]],"a")!;
 const rows=comparisonRows(current,baseline);
 expect(rows.find(r=>r.segment.id==="a")?.before).toBe("甲\n丙");
 expect(rows.filter(r=>r.deleted).map(r=>r.segment.id)).toEqual(["b"]);
});

it("compares complete splits without treating the second half as inserted text",()=>{
 const baseline=[timed("a","甲乙丙丁",0,4)];
 const current=splitSegmentAt(baseline,"a",2,undefined,"new")!;
 const rows=comparisonRows(current,baseline);
 expect(rows.map(r=>r.before)).toEqual(["甲乙","丙丁"]);
 const changed=comparisonRows([{...current[0],text:"甲"},current[1]],baseline);
 expect(changed.map(r=>r.before)).toEqual(["甲乙","丙丁"]);
 expect(revisionFor(changed[1].before!,{id:"new",text:current[1].text,reason:""}).parts.every(p=>!p.changed)).toBe(true);
});
it("compares a split of an earlier merged version against that version",()=>{
 const baseline=mergeSegmentWithNext([timed("a","甲乙",0,2),timed("b","丙丁",2,4)],"a")!;
 const current=splitSegmentAt(baseline,"a",3,undefined,"new")!;
 const rows=comparisonRows(current,baseline);
 expect(rows.map(r=>r.before).join("")).toBe(baseline[0].text);
 expect(rows).toHaveLength(2);
});
it('compares explicit splits of untimed text without using invented audio windows',()=>{
 const source={...segment('a','甲乙丙丁'),start:0,end:0};
 const current=[{...source,text:'甲乙',splitFrom:'a'},{...source,id:'b',text:'丙丁',splitFrom:'a'}];
 expect(comparisonRows(current,[source]).map(r=>r.before)).toEqual(['甲乙','丙丁']);
});
