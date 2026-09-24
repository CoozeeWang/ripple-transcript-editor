import { describe, expect, it } from "vitest";

import { mergeSegmentWithNext, removeSegmentAndMerge, splitSegmentAt } from "./segmentOps";
import type { Segment } from "../types";
import { timeForCharacter } from "./transcriptOps";

function seg(id: string, text: string, start: number, end: number, speakerId = "s1"): Segment {
  return { id, speaker_id: speakerId, start, end, text };
}

describe("removeSegmentAndMerge", () => {
  it("keeps later timestamps when deleting an interjection between an untimed and a timed segment", () => {
    const result = removeSegmentAndMerge([
      seg("a", "前段", 0, 5),
      seg("filler", "嗯", 5, 6, "s2"),
      { ...seg("b", "后段", 10, 20), words: [
        {text: "后", start: 10, end: 11}, {text: "段", start: 15, end: 16},
      ] },
    ], "filler")![0];
    expect(result.words?.map(word => word.text).join("")).toBe(result.text);
    expect(timeForCharacter(result, result.text.indexOf("段", 3))).toBe(15);
  });
  it("deletes the whole segment and merges matching neighbors, preserving their metadata", () => {
    const segments: Segment[] = [
      { ...seg("a", "甲", 0, 10), annotations: [{ id: "a1", text: "批注", createdAt: "t" }] },
      { ...seg("b", "删除正文", 10, 20, "s2"), annotations: [{ id: "b1", text: "删除批注", createdAt: "t" }] },
      { ...seg("c", "乙", 20, 30), highlights: [{ id: "h", start: 0, end: 1 }] },
    ];
    const result = removeSegmentAndMerge(segments, "b")!;
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({id: "a", text: "甲\n乙", start: 0, end: 30});
    expect(result[0].annotations?.map(a => a.id)).toEqual(["a1"]);
    expect(result[0].highlights).toEqual([{id: "h", start: 2, end: 3}]);
    expect(segments).toHaveLength(3);
    expect(segments[0].text).toBe("甲");
  });
  it("keeps neighbors separate when speakers differ", () => {
    const segments = [seg("a", "甲", 0, 10), seg("b", "乙", 10, 20), seg("c", "丙", 20, 30, "s2")];
    expect(removeSegmentAndMerge(segments, "b")?.map(s => s.id)).toEqual(["a", "c"]);
  });
  it("handles first, last, only and missing segments", () => {
    const segments = [seg("a", "甲", 0, 10), seg("b", "乙", 10, 20), seg("c", "丙", 20, 30)];
    expect(removeSegmentAndMerge(segments, "a")?.map(s => s.id)).toEqual(["b", "c"]);
    expect(removeSegmentAndMerge(segments, "c")?.map(s => s.id)).toEqual(["a", "b"]);
    expect(removeSegmentAndMerge([segments[0]], "a")).toEqual([]);
    expect(removeSegmentAndMerge(segments, "missing")).toBeNull();
  });
});

describe("mergeSegmentWithNext", () => {
  it("合并当前段与下一段：文本拼接、删除下一段、时间窗取下一段终点", () => {
    const segments = [
      seg("a", "你好", 0, 10),
      seg("b", "世界", 10, 20),
      seg("c", "再见", 20, 30),
    ];
    const result = mergeSegmentWithNext(segments, "a");
    expect(result).not.toBeNull();
    expect(result!.map((s) => s.id)).toEqual(["a", "c"]);
    expect(result![0].text).toBe("你好\n世界");
    expect(result![0].end).toBe(20);
    expect(result![0].start).toBe(0);
  });

  it("合并后下一段内容不会出现两遍（只保留在合并段中）", () => {
    const segments = [seg("a", "第一段", 0, 10), seg("b", "第二段", 10, 20)];
    const result = mergeSegmentWithNext(segments, "a");
    expect(result).not.toBeNull();
    expect(result!.length).toBe(1);
    // 文本 = 两段拼接一次，且没有任何残余段仍包含「第二段」。
    expect(result![0].text).toBe("第一段\n第二段");
    expect(result!.filter((s) => s.text.includes("第二段"))).toHaveLength(1);
  });

  it("合并时拼接批注", () => {
    const segments = [
      { ...seg("a", "你好", 0, 10), annotations: [{ id: "n1", text: "批注A", createdAt: "t" }] },
      { ...seg("b", "世界", 10, 20), annotations: [{ id: "n2", text: "批注B", createdAt: "t" }] },
    ];
    const result = mergeSegmentWithNext(segments, "a")!;
    expect(result[0].annotations?.map((a) => a.text)).toEqual(["批注A", "批注B"]);
  });

  it("末尾段无下一段时返回 null", () => {
    const segments = [seg("a", "你好", 0, 10)];
    expect(mergeSegmentWithNext(segments, "a")).toBeNull();
  });

  it("不存在的段返回 null", () => {
    expect(mergeSegmentWithNext([seg("a", "你好", 0, 10)], "zzz")).toBeNull();
  });
});

describe("splitSegmentAt", () => {
  it("在光标处拆分：前半保留原 id，后半用新 id", () => {
    const segments = [seg("a", "你好世界", 0, 20)];
    const result = splitSegmentAt(segments, "a", 2, undefined, "a2");
    expect(result).not.toBeNull();
    expect(result!.map((s) => s.id)).toEqual(["a", "a2"]);
    expect(result![0].text).toBe("你好");
    expect(result![1].text).toBe("世界");
    expect(result![0].end).toBe(result![1].start);
  });

  it("光标在边界或拆分后有空半时返回 null", () => {
    const segments = [seg("a", "你好", 0, 10)];
    expect(splitSegmentAt(segments, "a", 0, undefined, "a2")).toBeNull();
    expect(splitSegmentAt(segments, "a", 2, undefined, "a2")).toBeNull(); // 后半空
  });
});

describe("paragraph merge boundaries", () => {
  it("adds exactly one paragraph boundary while keeping interior paragraphs", () => {
    const result = mergeSegmentWithNext([seg("a", "甲\n乙\n\n", 0, 10), seg("b", "\n 丙\n丁", 10, 20)], "a")!;
    expect(result[0].text).toBe("甲\n乙\n丙\n丁");
  });
  it("moves the next segment's highlights past the inserted newline", () => {
    const result = mergeSegmentWithNext([
      seg("a", "甲😀", 0, 10),
      {...seg("b", "乙丙", 10, 20), highlights: [{id: "h", start: 0, end: 2}]},
    ], "a")!;
    expect(result[0].highlights?.map(h => result[0].text.slice(h.start, h.end))).toEqual(["乙丙"]);
    expect(result[0].highlights?.[0].start).toBe(4);
  });
});
