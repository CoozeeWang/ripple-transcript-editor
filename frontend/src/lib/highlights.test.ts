import { describe, it, expect } from "vitest";

import {
  collectHighlightGroups,
  countHighlights,
  mergeHighlights,
  snippetAround,
} from "./highlights";
import type { Highlight, Segment, Transcript } from "../types";

const segment = (id: string, speakerId: string, text: string, highlights?: Highlight[]): Segment => ({
  id,
  speaker_id: speakerId,
  start: 0,
  end: 10,
  text,
  ...(highlights ? { highlights } : {}),
});

const transcript = (segments: Segment[]): Transcript => ({
  audio: { filename: "a.wav", duration: 60 },
  speakers: [{ id: "spk1", name: "说话人 1" }],
  segments,
});

describe("snippetAround", () => {
  // 26 个互不相同的汉字，索引一眼可数：0甲 1乙 2丙 3丁 4戊 5己 6庚 7辛 8壬 9癸
  // 10子 11丑 12寅 13卯 14辰 15巳 16午 17未 18申 19酉 20戌 21亥 22壹 23贰 24叁 25肆
  const text = "甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥壹贰叁肆";

  it("前后各取 8 个字符，两端都带省略号", () => {
    const result = snippetAround(text, { start: 10, end: 14 });
    expect(result).toEqual({
      before: "丙丁戊己庚辛壬癸",
      marked: "子丑寅卯",
      after: "辰巳午未申酉戌亥",
      leadingEllipsis: true,
      trailingEllipsis: true,
    });
  });

  it("高亮贴着开头 → 无前导省略号", () => {
    const result = snippetAround(text, { start: 0, end: 4 });
    expect(result.before).toBe("");
    expect(result.leadingEllipsis).toBe(false);
  });

  it("高亮贴着结尾 → 无尾部省略号", () => {
    const result = snippetAround(text, { start: 22, end: 26 });
    expect(result.after).toBe("");
    expect(result.trailingEllipsis).toBe(false);
  });

  it("整段高亮 → 两端都不带省略号", () => {
    const result = snippetAround(text, { start: 0, end: text.length });
    expect(result.leadingEllipsis).toBe(false);
    expect(result.trailingEllipsis).toBe(false);
    expect(result.marked).toBe(text);
  });

  it("越界范围被裁剪到文本内，不抛错", () => {
    const result = snippetAround("abc", { start: -5, end: 99 });
    expect(result.marked).toBe("abc");
  });

  it("start > end 时退化为空高亮，不做负长度切片", () => {
    const result = snippetAround("abcde", { start: 3, end: 1 });
    expect(result.marked).toBe("");
  });
});

describe("mergeHighlights", () => {
  const incoming: Highlight = { id: "new", start: 5, end: 8 };

  it("没有已有高亮 → 只留下新的", () => {
    expect(mergeHighlights([], incoming)).toEqual([{ id: "new", start: 5, end: 8 }]);
  });

  it("完全不重叠 → 两条并存，按位置排序", () => {
    const existing: Highlight[] = [{ id: "a", start: 0, end: 2 }];
    expect(mergeHighlights(existing, incoming)).toEqual([
      { id: "a", start: 0, end: 2 },
      { id: "new", start: 5, end: 8 },
    ]);
  });

  it("部分重叠 → 合并成一条，沿用先出现那条的 id", () => {
    const existing: Highlight[] = [{ id: "a", start: 0, end: 6 }];
    expect(mergeHighlights(existing, incoming)).toEqual([{ id: "a", start: 0, end: 8 }]);
  });

  it("紧邻（end === start）→ 视为一条，不留缝", () => {
    const existing: Highlight[] = [{ id: "a", start: 0, end: 5 }];
    expect(mergeHighlights(existing, incoming)).toEqual([{ id: "a", start: 0, end: 8 }]);
  });

  it("新范围完全包住旧的 → 合并成新范围（id 取最靠前那条）", () => {
    const existing: Highlight[] = [{ id: "a", start: 6, end: 7 }];
    expect(mergeHighlights(existing, incoming)).toEqual([{ id: "new", start: 5, end: 8 }]);
  });

  it("乱序输入 → 输出按位置排序", () => {
    const existing: Highlight[] = [
      { id: "b", start: 10, end: 12 },
      { id: "a", start: 0, end: 2 },
    ];
    expect(mergeHighlights(existing, incoming).map((h) => h.start)).toEqual([0, 5, 10]);
  });

  it("空范围（start ≥ end）被丢弃", () => {
    const existing: Highlight[] = [{ id: "empty", start: 3, end: 3 }];
    expect(mergeHighlights(existing, incoming)).toEqual([{ id: "new", start: 5, end: 8 }]);
  });
});

describe("countHighlights", () => {
  it("没有 transcript → 0", () => {
    expect(countHighlights(null)).toBe(0);
  });

  it("跨片段累计", () => {
    const data = transcript([
      segment("s1", "spk1", "你好", [
        { id: "h1", start: 0, end: 1 },
        { id: "h2", start: 1, end: 2 },
      ]),
      segment("s2", "spk1", "世界", [{ id: "h3", start: 0, end: 2 }]),
    ]);
    expect(countHighlights(data)).toBe(3);
  });

  it("空范围不计数", () => {
    const data = transcript([
      segment("s1", "spk1", "你好", [{ id: "h1", start: 1, end: 1 }]),
    ]);
    expect(countHighlights(data)).toBe(0);
  });
});

describe("collectHighlightGroups", () => {
  it("没有 transcript → 空数组", () => {
    expect(collectHighlightGroups(null)).toEqual([]);
  });

  it("按文档顺序分组，无高亮的片段不出现", () => {
    const data = transcript([
      segment("s1", "spk1", "第一段没有高亮"),
      segment("s2", "spk1", "第二段有一处高亮", [{ id: "h1", start: 3, end: 5 }]),
      segment("s3", "spk1", "第三段有两处高亮", [
        { id: "h2", start: 4, end: 6 },
        { id: "h3", start: 0, end: 2 },
      ]),
    ]);
    const groups = collectHighlightGroups(data);
    expect(groups.map((g) => g.segment.id)).toEqual(["s2", "s3"]);
    expect(groups[0].index).toBe(1);
    // 组内按位置排序：h3(0) 在 h2(4) 之前
    expect(groups[1].items.map((i) => i.highlight.id)).toEqual(["h3", "h2"]);
  });

  it("跳过被隐藏的说话人", () => {
    const data = transcript([
      segment("s1", "spk1", "隐藏的", [{ id: "h1", start: 0, end: 2 }]),
      segment("s2", "spk2", "可见的", [{ id: "h2", start: 0, end: 2 }]),
    ]);
    const groups = collectHighlightGroups(data, new Set(["spk1"]));
    expect(groups.map((g) => g.segment.id)).toEqual(["s2"]);
  });

  it("空范围不进清单", () => {
    const data = transcript([
      segment("s1", "spk1", "你好", [{ id: "h1", start: 0, end: 0 }]),
    ]);
    expect(collectHighlightGroups(data)).toEqual([]);
  });

  it("每条都带上下文示意", () => {
    // 同上的天干地支串，高亮「子丑寅卯」位于索引 10..14
    const data = transcript([
      segment("s1", "spk1", "甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥壹贰叁肆", [
        { id: "h1", start: 10, end: 14 },
      ]),
    ]);
    const groups = collectHighlightGroups(data);
    expect(groups[0].items[0].snippet).toEqual({
      before: "丙丁戊己庚辛壬癸",
      marked: "子丑寅卯",
      after: "辰巳午未申酉戌亥",
      leadingEllipsis: true,
      trailingEllipsis: true,
    });
  });
});
