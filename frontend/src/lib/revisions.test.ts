import { expect,it } from "vitest";
import { decideRevision,revisionDone,revisionFor,revisionText,resolvedSuggestion } from "./revisions";
it("groups replacement deletions and insertions together and resolves mixed decisions",()=>{
 const state=revisionFor("甲乙丙丁戊",{id:"a",text:"甲二丙四戊",reason:"改字"});
 expect(state.parts.filter(p=>p.changed).map(p=>[p.before,p.after])).toEqual([["乙","二"],["丁","四"]]);
 state.parts[1].choice="reject";state.parts[3].choice="accept";state.reviewed=true;
 expect(revisionText(state)).toBe("甲乙丙四戊");expect(revisionDone(state)).toBe(true);
});
it("does not count untouched suggestions or unchanged samples as reviewed",()=>{expect(revisionDone(revisionFor("甲",{id:"a",text:"甲",reason:"保留"}))).toBe(false);});
it("rejected deletion preserves original and accepted deletion remains explicit",()=>{const segment={id:"a",text:"嗯",start:0,end:1,speaker_id:"s"};const proposal={id:"a",text:"",action:"delete" as const,reason:"删除"};const state=revisionFor(segment.text,proposal);expect(resolvedSuggestion(segment,proposal,decideRevision(state,"reject"))).toEqual({...proposal,action:"edit",text:"嗯"});expect(resolvedSuggestion(segment,proposal,decideRevision(state,"accept"))).toEqual(proposal);});

it("keeps unchanged interiors of long paragraphs unmarked",()=>{
 const middle="讨论过程和说话人的表达需要完整保留。".repeat(100);
 const before="甲"+middle+"乙";const after="丙"+middle+"丁";
 const state=revisionFor(before,{id:"long",text:after,reason:""});
 expect(state.parts.filter(p=>p.changed).map(p=>[p.before,p.after])).toEqual([["甲","丙"],["乙","丁"]]);
 expect(revisionText(state)).toBe(after);
});
it("repairs legacy large runs while preserving accepted and rejected text and review status",async()=>{
 const {refineRevisionParts}=await import("./revisions");
 const middle="保持口语和叙述顺序。".repeat(100);
 for(const choice of ["accept","reject","pending"] as const){
  const old={parts:[{before:"甲"+middle+"乙",after:"丙"+middle+"丁",changed:true,choice}],reviewed:choice!=="pending",operation:"accept" as const};
  const repaired=refineRevisionParts(old);
  expect(revisionText(repaired)).toBe(revisionText(old));expect(repaired.reviewed).toBe(old.reviewed);
  expect(repaired.parts.filter(p=>p.changed).map(p=>p.choice)).toEqual([choice,choice]);
  expect(repaired.parts.filter(p=>!p.changed).map(p=>p.after).join("")).toBe(middle);
 }
});
