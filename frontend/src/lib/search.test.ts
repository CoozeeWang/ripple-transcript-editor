import { describe, it, expect } from "vitest";

import { findMatches, replaceAt } from "./search";
import type { Transcript } from "../types";

function makeTranscript(texts: string[]): Transcript {
  return {
    audio: { filename: "a.m4a", duration: 1 },
    speakers: [],
    segments: texts.map((text, i) => ({
      id: `s${i + 1}`,
      speaker_id: "spk",
      start: i,
      end: i + 1,
      text,
    })),
  };
}

describe("findMatches", () => {
  it("空 query 或空转录返回空数组", () => {
    expect(findMatches(makeTranscript(["你好"]), "")).toEqual([]);
    expect(findMatches(null, "你")).toEqual([]);
  });

  it("找出同段落的多处匹配", () => {
    const matches = findMatches(makeTranscript(["你好世界你好"]), "你");
    expect(matches).toEqual([
      { segmentId: "s1", start: 0 },
      { segmentId: "s1", start: 4 },
    ]);
  });

  it("跨段落按顺序找出匹配", () => {
    const matches = findMatches(makeTranscript(["你好世界", "再见世界"]), "世界");
    expect(matches).toEqual([
      { segmentId: "s1", start: 2 },
      { segmentId: "s2", start: 2 },
    ]);
  });

  it("重叠查询词不重复匹配", () => {
    // "aaa" 里找 "aa"：indexOf 从 start+len 继续，只匹配第一处，不匹配重叠的第二处
    expect(findMatches(makeTranscript(["aaa"]), "aa")).toEqual([{ segmentId: "s1", start: 0 }]);
  });
});

describe("replaceAt", () => {
  it("替换中间一段", () => {
    expect(replaceAt("你好世界", 2, "世界", "宇宙")).toBe("你好宇宙");
  });

  it("替换开头", () => {
    expect(replaceAt("abc", 0, "a", "x")).toBe("xbc");
  });

  it("替换结尾", () => {
    expect(replaceAt("abc", 2, "c", "z")).toBe("abz");
  });
});
