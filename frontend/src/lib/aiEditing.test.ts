import { describe, expect, it } from "vitest";
import type { Transcript } from "../types";
import { nextAIEditName, applyAISuggestions, batchSegments, diffParts, exampleForRange, learningExample, isReviewed, markReviewed } from "./aiEditing";

const baseline: Transcript = { audio: { filename: "a.wav", duration: 6 }, speakers: [{ id: "sp", name: "张三" }], segments: [
  { id: "a", speaker_id: "sp", start: 0, end: 4, text: "我我觉得", words: [..."我我觉得"].map((text, start) => ({ text, start, end: start + 1 })),
    highlights: [{ id: "h", start: 2, end: 4 }], annotations: [{ id: "n", text: "回听", createdAt: "now" }] },
  { id: "b", speaker_id: "sp", start: 4, end: 6, text: "可能吧" },
] };

describe("AI editing contracts", () => {
  it("only approves explicit segment revisions and invalidates changed or split content", () => {
    const [a, b] = baseline.segments;
    expect(isReviewed(a, {})).toBe(false);
    const reviews = markReviewed(baseline, [a], true);
    expect(isReviewed(a, reviews)).toBe(true);
    expect(isReviewed(b, reviews)).toBe(false);
    for (const changed of [{ ...a, text: "新文字" }, { ...a, end: 3 }, { ...a, id: "split" }, { ...a, speaker_id: "other" }]) {
      expect(isReviewed(changed, reviews)).toBe(false);
    }
    expect(markReviewed({ ...baseline, reviewedSegments: reviews }, [a], false)).toEqual({});
    const updated = { ...baseline, reviewedSegments: reviews, segments: [{ ...a, text: "已变化" }, b] };
    expect(Object.keys(markReviewed(updated, [b], true))).toEqual(["b"]);
  });
  it("changes only accepted text and retains audio, speakers, notes, timestamps and highlights", () => {
    const next = applyAISuggestions(baseline, baseline, [{ id: "a", text: "我觉得", reason: "删除重复" }]);
    expect(next.segments[1]).toBe(baseline.segments[1]);
    expect(next.audio).toBe(baseline.audio);
    expect(next.speakers).toBe(baseline.speakers);
    expect(next.segments[0].annotations).toEqual(baseline.segments[0].annotations);
    expect(next.segments[0].words?.filter(w => "觉得".includes(w.text))).toEqual(baseline.segments[0].words?.slice(2));
    expect(next.segments[0].highlights).toEqual([{ id: "h", start: 1, end: 3 }]);
    expect(baseline.segments[0].text).toBe("我我觉得");
  });
  it("refuses stale suggestions, unknown ids, duplicate ids and empty text", () => {
    const suggestion = { id: "a", text: "我觉得", reason: "" };
    expect(() => applyAISuggestions({ ...baseline, segments: baseline.segments.slice(1) }, baseline, [suggestion])).toThrow("发生了变化");
    expect(() => applyAISuggestions(baseline, baseline, [{ ...suggestion, id: "missing" }])).toThrow();
    expect(() => applyAISuggestions(baseline, baseline, [suggestion, suggestion])).toThrow();
    expect(() => applyAISuggestions(baseline, baseline, [{ ...suggestion, text: " " }])).toThrow();
  });
  it("uses time windows to pair split or merged paragraphs rather than relying on ids", () => {
    const split = { ...baseline.segments[0], id: "new", start: 2, text: "觉得" };
    expect(exampleForRange(baseline, [split], "A").before).toBe("觉得");
    const merged = { ...baseline.segments[0], end: 6, text: "我觉得\n可能吧" };
    expect(exampleForRange(baseline, [merged], "A")).toEqual({ before: "我我觉得\n\n可能吧", after: merged.text, source: "A" });
    expect(exampleForRange(null, [merged], "A").before).toBe("");
  });
  it("batches every selected segment once with bounded requests", () => {
    const segments = Array.from({ length: 20 }, (_, i) => ({ ...baseline.segments[0], id: `${i}`, text: "字".repeat(1000) }));
    const batches = batchSegments(segments);
    expect(batches.map(b => b.length)).toEqual([3, 3, 3, 3, 3, 3, 2]);
    expect(batches.flat()).toEqual(segments);
    expect(() => batchSegments([{ ...segments[0], text: "字".repeat(6001) }])).toThrow("拆分");
  });
  it("highlights deletions and insertions without losing punctuation or emoji", () => {
    const before = "我我，🙂不确定"; const after = "我，🙂还不确定";
    expect(diffParts(before, after, "before").map(p => p.text).join("")).toBe(before);
    expect(diffParts(before, after, "after").map(p => p.text).join("")).toBe(after);
    expect(diffParts(before, after, "after").filter(p => p.changed).map(p => p.text).join("")).toBe("还");
  });
});


describe("automatic learning example alignment", () => {
  it("pairs merged revisions with the complete original range", () => {
    const merged = [{...baseline.segments[0],end:6,text:"我觉得\n\n可能吧"}];
    expect(learningExample(baseline,merged,"合并示范")).toEqual({before:"我我觉得\n\n可能吧",after:"我觉得\n\n可能吧",source:"合并示范"});
  });
  it("uses precise word boundaries for a split original", () => {
    const split = [{...baseline.segments[0],start:2,text:"觉得"}];
    expect(learningExample(baseline,split,"拆分示范").before).toBe("觉得");
    expect(()=>learningExample(baseline,[{...split[0],start:2.5}],"不精确的拆分")).toThrow("缺少精确的逐字时间戳");
  });
  it("rejects missing originals and ambiguous partial segments", () => {
    expect(()=>learningExample(null,baseline.segments,"示范")).toThrow("没有可用于对照的基准稿");
    expect(()=>learningExample(baseline,[{...baseline.segments[1],start:5}],"示范")).toThrow("扩大范围");
  });
});

it("applies explicit deletion and merging while preserving annotations and word alignment", () => {
  const merged=applyAISuggestions(baseline,baseline,[{id:"b",action:"merge_previous",text:"也许吧",reason:"合并"}]);
  expect(merged.segments).toHaveLength(1);
  expect(merged.segments[0].text).toBe("我我觉得\n也许吧");
  expect(merged.segments[0].end).toBe(6);
  expect(merged.segments[0].annotations).toEqual(baseline.segments[0].annotations);
  expect(merged.segments[0].words?.map(w=>w.text).join("")).toBe(merged.segments[0].text);
  const removed=applyAISuggestions(baseline,baseline,[{id:"a",action:"delete",text:"",reason:"删除"}]);
  expect(removed.segments).toEqual([baseline.segments[1]]);
  expect(baseline.segments).toHaveLength(2);
  expect(()=>applyAISuggestions(baseline,baseline,[{id:"a",action:"delete",text:"",reason:"删除"},{id:"b",action:"merge_previous",text:"可能吧",reason:"合并"}])).toThrow("相邻片段");
});


it("names AI drafts by source and increments only that source's saved drafts", () => {
  expect(nextAIEditName("修改稿 v1", [])).toBe("修改稿 v1 · AI 辅助 01");
  expect(nextAIEditName("修改稿 v1", ["修改稿 v1 · AI 辅助 01", "修改稿 v1 · AI 辅助 03", "修改稿 v2 · AI 辅助 09"])).toBe("修改稿 v1 · AI 辅助 04");
  expect(nextAIEditName("自定义稿", ["自定义稿 · AI 辅助 99"])).toBe("自定义稿 · AI 辅助 100");
});

it("packs short segments into fewer requests while preserving every segment",()=>{
 const segments=Array.from({length:100},(_,i)=>({id:String(i),text:"嗯。",start:i,end:i+1,speaker_id:"s"}));
 const batches=batchSegments(segments);
 expect(batches.map(b=>b.length)).toEqual([100]);expect(batches.flat()).toEqual(segments);
});
it('uses character budget first, retains long single segments and bounds tiny-segment batches',()=>{
 const segment=(id:string,text:string)=>({id,text,start:0,end:1,speaker_id:'s'});
 const input=[segment('a','字'.repeat(2000)),segment('b','字'.repeat(1500)),segment('c','字'.repeat(4000)),segment('d','嗯')];
 expect(batchSegments(input).map(b=>b.map(s=>s.id))).toEqual([['a'],['b'],['c'],['d']]);
 const tiny=Array.from({length:260},(_,i)=>segment(String(i),'嗯'));
 expect(batchSegments(tiny).map(b=>b.length)).toEqual([128,128,4]);
});
