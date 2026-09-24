import {expect,it} from "vitest";
import type {Transcript} from "../types";
import {applyComparisonDecision,comparisonParts,comparisonReviewKey,reconcileComparisonReviews} from "./comparisonReview";
import {buildJsonPayload} from "./export";
const before="甲旧乙丙原丁";
const make=(text="甲新乙丙改丁"):Transcript=>({audio:{filename:"test.wav",duration:1},speakers:[],segments:[{id:"s",speaker_id:"p",start:0,end:1,text}]});
const decide=(t:Transcript,index:number,choice:"accept"|"reject")=>reconcileComparisonReviews(applyComparisonDecision(t,{segmentId:"s",base:"m:e1",before,text:t.segments[0].text,key:comparisonParts(before,t.segments[0].text).filter(p=>p.changed)[index].key,choice}));
it("accepts one change without changing text or approving another, and preserves it when another is rejected",()=>{
 const source=make();const accepted=decide(source,0,"accept");
 expect(accepted.segments).toEqual(source.segments);
 expect(accepted.comparisonReviews?.[comparisonReviewKey("m:e1","s")].accepted).toHaveLength(1);
 const rejected=decide(accepted,1,"reject");expect(rejected.segments[0].text).toBe("甲新乙丙原丁");
 expect(rejected.comparisonReviews).toEqual(accepted.comparisonReviews);
 expect(source.comparisonReviews).toBeUndefined();
 expect(JSON.parse(JSON.stringify(accepted)).comparisonReviews).toEqual(accepted.comparisonReviews);
 expect(buildJsonPayload(accepted,undefined)).not.toHaveProperty("comparisonReviews");
});
it("invalidates changed approvals and scopes them to the selected baseline",()=>{
 const accepted=decide(make(),0,"accept");
 expect(accepted.comparisonReviews?.[comparisonReviewKey("m:e2","s")]).toBeUndefined();
 const edited=reconcileComparisonReviews({...accepted,segments:[{...accepted.segments[0],text:"甲另乙丙改丁"}]});
 expect(edited.comparisonReviews).toEqual({});
});
it.each([["甲旧乙","甲乙","甲旧乙"],["甲乙","甲新乙","甲乙"],["甲乙","甲\n乙","甲乙"]])("rejects a local insertion or deletion including a paragraph break",(before,text,expected)=>{
 const t=make(text),part=comparisonParts(before,text).find(p=>p.changed)!;
 expect(applyComparisonDecision(t,{base:"b",segmentId:"s",before,text,key:part.key,choice:"reject"}).segments[0].text).toBe(expected);
});
it("rejects an entirely new paragraph without merging its neighbours",()=>{
 const t=make("新增");t.segments=[{...t.segments[0],id:"left"},t.segments[0],{...t.segments[0],id:"right"}];
 const result=applyComparisonDecision(t,{base:"b",segmentId:"s",before:"",text:"新增",key:comparisonParts("","新增")[0].key,choice:"reject"});
 expect(result.segments.map(s=>s.id)).toEqual(["left","right"]);
});
it("ignores obsolete menu snapshots",()=>{
 const t=make("刚输入的文字");expect(applyComparisonDecision(t,{base:"b",segmentId:"s",before,text:"甲新乙丙改丁",key:comparisonParts(before,"甲新乙丙改丁")[1].key,choice:"reject"})).toBe(t);
});

import type {Segment} from "../types";
import {reanchorCharacters,timeForCharacter} from "./transcriptOps";
import {comparisonRows} from "./comparisonSegments";
import {mergeSegmentWithNext,splitSegmentAt} from "./segmentOps";
const timedSource=(text:string,start=0):Segment=>({id:"s",speaker_id:"p",text,start,end:start+text.length,
 words:Array.from(text,(text,i)=>({text,start:start+i,end:start+i+1,speaker_id:"p"}))});
const edit=(segment:Segment,text:string):Segment=>({...segment,text,words:reanchorCharacters(segment.words,segment.text,text)});
function reject(t:Transcript,baseline:Segment[],id="s",index=0){
 const row=comparisonRows(t.segments,baseline).find(row=>!row.deleted&&row.segment.id===id)!;
 const part=comparisonParts(row.before!,row.segment.text).filter(p=>p.changed)[index];
 return applyComparisonDecision(t,{base:"b",segmentId:id,before:row.before!,text:row.segment.text,key:part.key,choice:"reject"},baseline);
}
it("restores deleted character timing from the source, preserving other words and the source file",()=>{
 const source=timedSource("甲乙丙");const saved=JSON.stringify(source);
 const t={...make(),segments:[edit(source,"甲丙")]};
 const result=reject(t,[source]);
 expect(result.segments[0].words).toEqual(source.words);
 expect(timeForCharacter(result.segments[0],1)).toBe(1);
 expect(JSON.stringify(source)).toBe(saved);
 expect(JSON.parse(JSON.stringify(result)).segments[0].words).toEqual(source.words);
});
it("restores multiple rejected deletions independently after successive edits",()=>{
 const source=timedSource("甲乙丙丁戊");
 const t={...make(),segments:[edit(edit(source,"甲丙丁戊"),"甲丙戊")]};
 const once=reject(t,[source]);
 expect(once.segments[0].text).toBe("甲乙丙戊");
 expect(timeForCharacter(once.segments[0],3)).toBe(4);
 expect(reject(once,[source]).segments[0].words).toEqual(source.words);
});
it("uses the chosen baseline and ignores obsolete source text",()=>{
 const source=timedSource("甲乙丙",10),t={...make(),segments:[edit(source,"甲丙")]};
 expect(timeForCharacter(reject(t,[source]).segments[0],1)).toBe(11);
 const part=comparisonParts(source.text,"甲丙").find(p=>p.changed)!;
 expect(applyComparisonDecision(t,{base:"b",segmentId:"s",before:source.text,text:"甲丙",key:part.key,choice:"reject"},[timedSource("另一稿")])).toBe(t);
});
it("restores replacements without borrowing timing from a neighbouring character",()=>{
 const source=timedSource("甲乙丙"),t={...make(),segments:[edit(source,"甲新丙")]};
 const result=reject(t,[source]).segments[0];
 expect(result.words).toEqual(source.words);
 expect(timeForCharacter(result,1)).toBe(1);
 expect(result.words?.at(-1)).toEqual(source.words!.at(-1));
});
it("recovers the correct source segment after a merge, retaining absolute audio times",()=>{
 const first=timedSource("甲乙",0),second={...timedSource("丙丁",10),id:"next"};
 const merged=mergeSegmentWithNext([first,second],"s")!;
 const t={...make(),segments:[edit(merged[0],"甲乙\n丁")]};
 const result=reject(t,[first,second]).segments[0];
 expect(result.text).toBe("甲乙\n丙丁");
 expect(timeForCharacter(result,3)).toBe(10);
 expect(timeForCharacter(result,4)).toBe(11);
});
it("recovers the correct occurrence in a split paragraph with repeated text",()=>{
 const source=timedSource("甲乙甲乙");
 const pieces=splitSegmentAt([source],"s",2,undefined,"second")!;
 const t={...make(),segments:[pieces[0],edit(pieces[1],"甲")]};
 const result=reject(t,[source],"second");
 expect(result.segments[0]).toBe(pieces[0]);
 expect(timeForCharacter(result.segments[1],1)).toBe(3);
});
it("restores a partial word using its original interpolation, and a newline without shifting following words",()=>{
 const source={...timedSource("甲乙丙"),words:[{text:"甲乙丙",start:3,end:6}]};
 const result=reject({...make(),segments:[edit(source,"甲丙")]},[source]).segments[0];
 expect(timeForCharacter(result,1)).toBe(4);
 const multiline=timedSource("甲\n乙");
 expect(reject({...make(),segments:[edit(multiline,"甲乙")]},[multiline]).segments[0].words).toEqual(multiline.words);
});
it("does not invent positive timing for restored text when the baseline lacks words",()=>{
 const source={...timedSource("甲乙丙"),words:undefined};
 const result=reject({...make(),segments:[edit(source,"甲丙")]},[source]).segments[0];
 expect(result.words?.every(word=>word.start===word.end)).toBe(true);
 expect(result.words?.map(w=>w.text).join("")).toBe(source.text);
});
it("retains timing for a separate accepted edit while restoring source anchors around the rejected edit",()=>{
 const source=timedSource("甲乙丙丁戊"),segment=edit(source,"甲新丙改戊");
 const parts=comparisonParts(source.text,segment.text).filter(p=>p.changed);
 const t=applyComparisonDecision({...make(),segments:[segment]},{base:"b",segmentId:"s",before:source.text,text:segment.text,key:parts[1].key,choice:"accept"},[source]);
 const result=reject(t,[source]);
 expect(result.segments[0].text).toBe("甲乙丙改戊");
 expect(timeForCharacter(result.segments[0],3)).toBe(timeForCharacter(segment,3));
 expect(result.comparisonReviews).toEqual(t.comparisonReviews);
 expect(timeForCharacter(result.segments[0],0)).toBe(0);
 expect(timeForCharacter(result.segments[0],1)).toBe(1);
});
it("rejects inserted characters and recovers the neighbour's full original time window",()=>{
 const source=timedSource("甲乙");
 const result=reject({...make(),segments:[edit(source,"甲新增乙")]},[source]);
 expect(result.segments[0].words).toEqual(source.words);
});
it("preserves existing timing on matching text when a legacy baseline has no word timing",()=>{
 const source={...timedSource("甲乙丙"),words:undefined};
 const current=edit(timedSource(source.text),"甲丙");
 const result=reject({...make(),segments:[current]},[source]).segments[0];
 expect(timeForCharacter(result,0)).toBe(0);
 expect(timeForCharacter(result,2)).toBe(2);
 expect(result.words?.find(word=>word.text==="乙")?.end).toBe(0);
});
