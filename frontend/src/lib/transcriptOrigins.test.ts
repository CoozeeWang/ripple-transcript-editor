import {expect,it} from "vitest";
import type {Transcript,Segment} from "../types";
import {seedOriginalOrigins,restoreTranscriptOrigins} from "./transcriptOrigins";
import {reanchorCharacters,timeForCharacter} from "./transcriptOps";
import {applyAISuggestions} from "./aiEditing";
import {applyComparisonDecision,comparisonParts} from "./comparisonReview";
import {mergeSegmentWithNext,splitSegmentAt} from "./segmentOps";
import {buildJsonPayload} from "./export";
const raw=(text="甲乙丙丁",start=10):Transcript=>({audio:{filename:"synthetic.wav",duration:100},speakers:[{id:"p",name:"测试"}],segments:[{id:"s",speaker_id:"p",start,end:start+text.length,text,
 words:Array.from(text,(text,i)=>({text,start:start+i,end:start+i+1}))}]});
const edit=(s:Segment,text:string)=>({...s,text,words:reanchorCharacters(s.words,s.text,text)});
const seeded=(text?:string)=>seedOriginalOrigins(raw(text),"m1");
it("records original character coordinates without changing the original object",()=>{
 const original=raw(),snapshot=JSON.stringify(original),t=seedOriginalOrigins(original,"m1");
 expect(t.segments[0].words![1].origins).toEqual([{model:"m1",segment:"s",from:1,to:2,start:11,end:12}]);
 expect(JSON.stringify(original)).toBe(snapshot);
});
it("replacements inherit the replaced range instead of a preceding word",()=>{
 const s=seeded().segments[0],changed=edit(s,"甲新丙丁");
 expect(changed.words!.find(w=>w.text==="新")).toMatchObject({start:11,end:12,timing:"replacement",origins:s.words![1].origins});
 expect(changed.words![0]).toEqual(s.words![0]);
 expect(timeForCharacter(changed,2)).toBe(12);
});
it("successive complete replacements keep the immutable range",()=>{
 const s=seeded("甲乙").segments[0];
 const a=edit(s,"丙丁"),b=edit(a,"戊己庚"),c=edit(b,"辛壬");
 expect(c.words![0].origins).toEqual([{model:"m1",segment:"s",from:0,to:2,start:10,end:12}]);
 expect(c.words![0]).toMatchObject({start:10,end:12});
});
it("insertions do not shrink neighbours and remain approximate after further edits",()=>{
 const s=seeded("甲乙").segments[0],a=edit(s,"甲新增乙"),b=edit(a,"甲补充乙");
 expect(a.words!.find(w=>w.text==="新增")).toMatchObject({start:11,end:11,timing:"approximate"});
 expect(timeForCharacter(a,3)).toBe(11);
 expect(b.words!.find(w=>w.text==="补充")).toMatchObject({start:11,end:11,timing:"approximate"});
 expect(edit(s,"新增甲乙").words![0]).toMatchObject({start:10,end:10,timing:"approximate"});
});
it("AI edits preserve the same source coordinates as manual edits",()=>{
 const t=seeded(),text="甲新丙丁";
 const ai=applyAISuggestions(t,t,[{id:"s",text,reason:"纠错"}]);
 expect(ai.segments[0].words).toEqual(edit(t.segments[0],text).words);
});
it("splits repeated text by position and retains origin coordinates through merging",()=>{
 const t=seeded("甲乙甲乙"),s=t.segments[0];
 const split=splitSegmentAt([s],s.id,2,undefined,"second")!;
 expect(timeForCharacter(split[1],0)).toBe(12);
 expect(split[1].words![0].origins![0].from).toBe(2);
 const merged=mergeSegmentWithNext(split,s.id)![0];
 expect(merged.words!.find(w=>w.origins?.[0]?.from===2)).toEqual(s.words![2]);
 expect(edit(merged,"甲乙\n甲改").words!.at(-1)?.origins).toEqual(s.words![3].origins);
});
it("rejecting a change from another model does not reassign untouched source coordinates",()=>{
 const source=seeded(),other=seedOriginalOrigins(raw("甲旧丙丁",40),"m2");
 const current={...source,segments:[edit(source.segments[0],"甲新丙丁")]};
 const part=comparisonParts(other.segments[0].text,current.segments[0].text).find(p=>p.changed)!;
 const result=applyComparisonDecision(current,{base:"m2:e1",segmentId:"s",before:other.segments[0].text,text:current.segments[0].text,key:part.key,choice:"reject"},other.segments);
 expect(result.segments[0].words![0]).toEqual(source.segments[0].words![0]);
 expect(result.segments[0].words![1].origins![0].model).toBe("m2");
 expect(result.segments[0].words!.at(-1)).toEqual(source.segments[0].words!.at(-1));
});
it("accepting a change only records the display decision",()=>{
 const source=seeded(),current={...source,segments:[edit(source.segments[0],"甲新丙丁")]};
 const part=comparisonParts(source.segments[0].text,current.segments[0].text).find(p=>p.changed)!;
 const result=applyComparisonDecision(current,{base:"m1:e1",segmentId:"s",before:source.segments[0].text,text:current.segments[0].text,key:part.key,choice:"accept"},source.segments);
 expect(result.segments).toBe(current.segments);
});
it("backfills legacy edits from the original and refuses ambiguous repeated text",()=>{
 const source=raw(),legacy={...source,segments:[edit(source.segments[0],"甲新丙丁")]};
 const restored=restoreTranscriptOrigins(legacy,source,"m1");
 expect(restored.segments[0].words![1]).toMatchObject({start:11,end:12,timing:"approximate"});
 const repeated=raw("甲乙甲乙"),short={...repeated,segments:[edit(repeated.segments[0],"甲乙")]};
 expect(restoreTranscriptOrigins(short,repeated,"m1").segments[0].words!.every(w=>w.timing==="unresolved"&&w.origins!.length===0)).toBe(true);
});
it("reopening an already sourced version preserves all coordinates even if another original is supplied",()=>{
 const t=seeded(),current={...t,segments:[edit(t.segments[0],"甲新增乙丙丁")]};
 const saved=JSON.parse(JSON.stringify(current));
 expect(restoreTranscriptOrigins(saved,raw("不同原稿",40),"m2")).toEqual(current);
 const exported=buildJsonPayload(current,undefined) as unknown as Transcript;
 expect(exported.segments[0].words!.every(w=>!w.origins&&!w.timing)).toBe(true);
 expect(current.segments[0].words![0].origins).toBeDefined();
});
it("missing original timestamps remain unresolved rather than becoming precise",()=>{
 const t=raw();delete t.segments[0].words;
 const s=seedOriginalOrigins(t,"m1").segments[0];
 expect(s.words!.every(w=>w.timing==="unresolved" && w.start===w.end)).toBe(true);
});

import {reanchorTextEdits} from "./transcriptOps";
it("manual deletion uses the selected occurrence, including multiple events in one draft",()=>{
 const s=seeded("甲乙甲乙").segments[0];
 const words=reanchorTextEdits(s.words,s.text,"甲",[
  {before:s.text,text:"甲乙",start:0,end:2},
  {before:"甲乙",text:"甲",start:1,end:2},
 ]);
 expect(words![0].origins![0].from).toBe(2);
 expect(words![0].start).toBe(12);
});
it("keeps source coordinates when unique text is moved within a single edit",()=>{
 const s=seeded("甲乙丙丁").segments[0],moved=edit(s,"丙丁甲乙");
 expect(moved.words!.map(w=>w.origins![0].from)).toEqual([2,3,0,1]);
 expect(timeForCharacter(moved,2)).toBe(10);
});
it("does not certify an occurrence when AI deletes an indistinguishable repeated phrase",()=>{
 const t=seeded("甲乙甲乙");
 const result=applyAISuggestions(t,t,[{id:"s",text:"甲乙",reason:"去重"}]);
 expect(result.segments[0].words!.every(w=>w.timing==="unresolved"&&!w.origins!.length)).toBe(true);
});
it("rejecting a deletion of the first repeated phrase restores both original occurrences",()=>{
 const t=seeded("甲乙甲乙"),s=t.segments[0];
 const text="甲乙",words=reanchorTextEdits(s.words,s.text,text,[{before:s.text,text,start:0,end:2}]);
 const current={...t,segments:[{...s,text,words}]},part=comparisonParts(s.text,text).find(p=>p.changed)!;
 const restored=applyComparisonDecision(current,{base:"m1:original",segmentId:s.id,before:s.text,text,key:part.key,choice:"reject"},t.segments);
 expect(restored.segments[0].words).toEqual(s.words);
});
