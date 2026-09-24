import { describe, it, expect } from "vitest";

import {
  activeWordRange,
  alignTimestampWords,
  joinText,
  lcsAlignment,
  mapCharsByDiff,
  reanchorCharacters,
  reanchorRanges,
  timeForCharacter,
} from "./transcriptOps";
import type { Segment, Word } from "../types";

describe("joinText", () => {
  it("中文合并不加空格", () => {
    expect(joinText("你好", "世界")).toBe("你好世界");
  });

  it("英文合并加空格", () => {
    expect(joinText("hello", "world")).toBe("hello world");
  });

  it("合并时去掉连接处的空白", () => {
    expect(joinText("你好 ", " 世界")).toBe("你好世界");
  });
});

describe("timeForCharacter", () => {
  const segment: Segment = {
    id: "seg1",
    speaker_id: "spk1",
    start: 0,
    end: 4,
    text: "你好",
    words: [
      { text: "你", start: 0, end: 2 },
      { text: "好", start: 2, end: 4 },
    ],
  };

  it("第一个字符映射到第一个词的时间戳", () => {
    expect(timeForCharacter(segment, 0)).toBe(0);
  });

  it("第二个字符映射到第二个词的时间戳", () => {
    expect(timeForCharacter(segment, 1)).toBe(2);
  });

  it("无词级时间戳时按比例插值", () => {
    const plain: Segment = { ...segment, words: undefined, end: 10 };
    expect(timeForCharacter(plain, 1)).toBe(5);
  });
});

describe("activeWordRange", () => {
  const segment: Segment = {
    id: "seg1",
    speaker_id: "spk1",
    start: 0,
    end: 4,
    text: "你好",
    words: [
      { text: "你", start: 0, end: 2 },
      { text: "好", start: 2, end: 4 },
    ],
  };

  it("时间落在第一个词 → 字符范围 [0,1)", () => {
    expect(activeWordRange(segment, 1)).toEqual({ start: 0, end: 1 });
  });

  it("时间落在第二个词 → 字符范围 [1,2)", () => {
    expect(activeWordRange(segment, 3)).toEqual({ start: 1, end: 2 });
  });

  it("空文本返回 null", () => {
    expect(activeWordRange({ ...segment, text: "" }, 1)).toBeNull();
  });
});

describe("mapCharsByDiff", () => {
  it("相同文本 → 恒等映射", () => {
    expect(Array.from(mapCharsByDiff("abc", "abc"))).toEqual([0, 1, 2]);
  });

  it("前缀插入 → 新字符映射 -1，其余保持", () => {
    expect(Array.from(mapCharsByDiff("abc", "xabc"))).toEqual([-1, 0, 1, 2]);
  });

  it("中间删除 → 后续字符保持原索引（时间戳不漂移）", () => {
    expect(Array.from(mapCharsByDiff("abcde", "abde"))).toEqual([0, 1, 3, 4]);
  });
});

describe("lcsAlignment", () => {
  it("返回 b 中每个字符在 a 中的匹配索引或 -1", () => {
    expect(Array.from(lcsAlignment("abc", "axc"))).toEqual([0, -1, 2]);
  });

  it("空串返回全 -1", () => {
    expect(Array.from(lcsAlignment("", "ab"))).toEqual([-1, -1]);
  });
});

describe("reanchorCharacters", () => {
  const chunks: Word[] = [
    { text: "你", start: 0, end: 2 },
    { text: "好", start: 2, end: 4 },
  ];

  it("追加字符 → 新字符并入最近邻居的 chunk 并继承其时间戳", () => {
    const result = reanchorCharacters(chunks, "你好", "你好吗");
    // 「吗」是新增字符，没有自己的时间戳，并入「好」的 chunk
    expect(result?.map((w) => w.text)).toEqual(["你", "好吗"]);
    expect(result?.[1].start).toBe(2);
  });

  it("删除中间字符 → 剩余字符保持原时间戳", () => {
    const three: Word[] = [
      { text: "你", start: 0, end: 1 },
      { text: "好", start: 1, end: 2 },
      { text: "吗", start: 2, end: 3 },
    ];
    const result = reanchorCharacters(three, "你好吗", "你吗");
    expect(result?.map((w) => w.text)).toEqual(["你", "吗"]);
    // 「吗」的时间戳不因删除「好」而漂移
    expect(result?.[1].start).toBe(2);
  });

  it("无 chunks 返回 undefined（不凭空造时间戳）", () => {
    expect(reanchorCharacters(undefined, "你好", "你好吗")).toBeUndefined();
  });

  it("newText 为空返回空数组", () => {
    expect(reanchorCharacters(chunks, "你好", "")).toEqual([]);
  });

  it("修复局部缺失映射且保留有效时间戳", () => {
    const mismatched: Word[] = [{ text: "你好", start: 0, end: 4 }];
    // 缺失文字补为无时间窗，已有词的绝对时间保持不变。
    expect(reanchorCharacters(mismatched, "你好吗", "你好吗呀")).toEqual([
      {text: "你好", start: 0, end: 4}, {text: "吗呀", start: 4, end: 4},
    ]);
  });
});

describe("reanchorRanges", () => {
  const range = (start: number, end: number, id = "h1") => ({ id, start, end });

  it("文本未变 → 原样返回（含额外字段）", () => {
    expect(reanchorRanges([range(1, 3)], "abcde", "abcde")).toEqual([
      { id: "h1", start: 1, end: 3 },
    ]);
  });

  it("高亮之前插入文字 → 整体平移，长度不变", () => {
    expect(reanchorRanges([range(2, 4)], "abcde", "abXcde")).toEqual([
      { id: "h1", start: 3, end: 5 },
    ]);
  });

  it("高亮之后插入文字 → 范围不动", () => {
    expect(reanchorRanges([range(0, 2)], "abcde", "abcdeX")).toEqual([
      { id: "h1", start: 0, end: 2 },
    ]);
  });

  it("高亮中间插入文字 → 范围外扩，包住新字符", () => {
    expect(reanchorRanges([range(1, 4)], "abcde", "abXcde")).toEqual([
      { id: "h1", start: 1, end: 5 },
    ]);
  });

  it("高亮中间删除文字 → 收缩到存活字符", () => {
    expect(reanchorRanges([range(1, 4)], "abcde", "abe")).toEqual([
      { id: "h1", start: 1, end: 2 },
    ]);
  });

  it("高亮覆盖的字符全被删 → 该范围丢弃", () => {
    expect(reanchorRanges([range(2, 4)], "abcde", "abe")).toEqual([]);
  });

  it("粘贴替换掉高亮的一部分 → 收缩到存活部分", () => {
    expect(reanchorRanges([range(2, 6)], "abcdefgh", "abXYefgh")).toEqual([
      { id: "h1", start: 4, end: 6 },
    ]);
  });

  it("多处高亮各自重锚，互不干扰", () => {
    // new = "aXbcdYe"：X 插在 a 之后，Y 插在 d 与 e 之间（即第二处高亮的内部）
    expect(reanchorRanges([range(0, 1, "a"), range(3, 5, "b")], "abcde", "aXbcdYe")).toEqual([
      { id: "a", start: 0, end: 1 },
      { id: "b", start: 4, end: 7 },
    ]);
  });

  it("中文：删掉高亮的前半 → 收缩到剩下的字", () => {
    // 高亮「这个数字」，删掉「这个」后只剩「数字」
    expect(reanchorRanges([range(2, 6)], "他说这个数字不对", "他说数字不对")).toEqual([
      { id: "h1", start: 2, end: 4 },
    ]);
  });

  it("newText 为空 → 返回空数组", () => {
    expect(reanchorRanges([range(0, 2)], "abc", "")).toEqual([]);
  });

  it("没有高亮 → 返回空数组", () => {
    expect(reanchorRanges([], "abc", "abcd")).toEqual([]);
  });

  it("越界范围被裁剪到文本长度内", () => {
    expect(reanchorRanges([range(3, 99)], "abcde", "abcdeX")).toEqual([
      { id: "h1", start: 3, end: 5 },
    ]);
  });
});

describe("timestamp gaps after edits", () => {
  const edited: Segment = {
    id: "edited", speaker_id: "s", start: 0, end: 12, text: "甲新增乙丙尾",
    words: [
      {text: "甲", start: 1, end: 2},
      {text: "新增", start: 0, end: 0},
      {text: "乙", start: 5, end: 6},
      {text: "丙", start: 9, end: 10},
      {text: "尾", start: 0, end: 0},
    ],
  };
  it("holds the previous timestamped text in every gap, including after the final timed word", () => {
    expect(activeWordRange(edited, 0)).toBeNull();
    expect(activeWordRange(edited, 3)).toEqual({start: 0, end: 1});
    expect(activeWordRange(edited, 5.5)).toEqual({start: 3, end: 4});
    expect(activeWordRange(edited, 7)).toEqual({start: 3, end: 4});
    expect(activeWordRange(edited, 11)).toEqual({start: 4, end: 5});
    // Backward seek must recompute the previous anchor rather than retain a future highlight.
    expect(activeWordRange(edited, 3)).toEqual({start: 0, end: 1});
  });
  it("seeks untimed additions to their preceding timed word instead of time zero", () => {
    expect(timeForCharacter(edited, 2)).toBe(1);
    expect(timeForCharacter(edited, 5)).toBe(9);
    expect(timeForCharacter(edited, edited.text.length)).toBe(12);
  });
});


describe("partial timestamp alignment", () => {
  it("keeps late absolute timestamps even when an earlier paragraph is missing from word text", () => {
    const words = [{text: "甲", start: 10, end: 11}, {text: "乙", start: 90, end: 91}];
    const segment: Segment = {id: "s", speaker_id: "p", start: 10, end: 100, text: "甲\n新增\n乙", words};
    expect(timeForCharacter(segment, 5)).toBe(90);
    expect(activeWordRange(segment, 90.5)).toEqual({start: 5, end: 6});
    expect(activeWordRange(segment, 50)).toEqual({start: 0, end: 1});
    expect(words.map(w => w.text).join("")).toBe("甲乙");
  });
  it("checks content as well as length, and never invents timestamps for changed text", () => {
    const words = [{text: "甲", start: 10, end: 11}, {text: "乙", start: 90, end: 91}];
    const aligned = alignTimestampWords(words, "甲丙");
    expect(aligned).toEqual([{text: "甲", start: 10, end: 11}, {text: "丙", start: 11, end: 11}]);
  });
});
