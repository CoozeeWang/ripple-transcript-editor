import { describe, expect, it } from "vitest";
import { nextSpeakerColorIndex, normalizeSpeakerName } from "./speakers";
import type { Speaker } from "../types";

describe("normalizeSpeakerName", () => {
  it("去首尾空格", () => {
    expect(normalizeSpeakerName("  张三  ")).toBe("张三");
  });

  it("转小写", () => {
    expect(normalizeSpeakerName("Alice")).toBe("alice");
  });

  it("全角转半角", () => {
    expect(normalizeSpeakerName("Ｓｐｅａｋｅｒ　１")).toBe("speaker 1");
  });

  it("全角空格转半角空格", () => {
    expect(normalizeSpeakerName("说话人　1")).toBe("说话人 1");
  });
});

describe("nextSpeakerColorIndex", () => {
  it("全部空时返回 0", () => {
    expect(nextSpeakerColorIndex([])).toBe(0);
  });

  it("挑第一个未占用槽位", () => {
    const speakers: Speaker[] = [
      { id: "a", name: "A", colorIndex: 0 },
      { id: "b", name: "B", colorIndex: 1 },
    ];
    expect(nextSpeakerColorIndex(speakers)).toBe(2);
  });

  it("无 colorIndex 的说话人按渲染回退色（数组位置）占位，不重复分配", () => {
    const speakers: Speaker[] = [
      { id: "a", name: "A", colorIndex: 0 },
      { id: "b", name: "B" }, // 无 colorIndex：渲染层显示 位置 1 的颜色
    ];
    // 旧行为（只统计显式值）会返回 1，与 b 的实际显示色撞色。修复后考虑回退色 → 2。
    expect(nextSpeakerColorIndex(speakers)).toBe(2);
  });

  it("混合显式与回退色时按「实际显示色」去重", () => {
    // a 显式 0；b 无字段 → 回退 1。新说话人应拿 2。
    expect(
      nextSpeakerColorIndex([
        { id: "a", name: "A", colorIndex: 0 },
        { id: "b", name: "B" },
      ]),
    ).toBe(2);
    // a 无字段 → 回退 0；b 显式 1。新说话人应拿 2。
    expect(
      nextSpeakerColorIndex([
        { id: "a", name: "A" },
        { id: "b", name: "B", colorIndex: 1 },
      ]),
    ).toBe(2);
  });

  it("前四个槽位占用后继续分配第五色", () => {
    const speakers: Speaker[] = [
      { id: "a", name: "A", colorIndex: 0 },
      { id: "b", name: "B", colorIndex: 1 },
      { id: "c", name: "C", colorIndex: 2 },
      { id: "d", name: "D", colorIndex: 3 },
    ];
    expect(nextSpeakerColorIndex(speakers)).toBe(4);
  });
});

it("ten presets are assigned in order before wrapping",()=>{
 const speakers: Speaker[] = [];
 for(let i=0;i<10;i++) {
   expect(nextSpeakerColorIndex(speakers)).toBe(i);
   speakers.push({id:String(i),name:String(i),colorIndex:i});
 }
 expect(nextSpeakerColorIndex(speakers)).toBe(0);
});
