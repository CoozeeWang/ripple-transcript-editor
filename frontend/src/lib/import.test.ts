import { describe, it, expect } from "vitest";

import { inspectTranscript, UNLABELED_SPEAKER_ID } from "./import";

describe("inspectTranscript", () => {
  it("非对象输入报错", () => {
    const r = inspectTranscript("hello");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("顶层结构不是对象");
  });

  it("缺 segments 报错", () => {
    const r = inspectTranscript({ audio: { filename: "a.m4a" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("转录片段");
  });

  it("空 segments 报错", () => {
    const r = inspectTranscript({ audio: { filename: "a.m4a" }, segments: [] });
    expect(r.ok).toBe(false);
  });

  it("缺时间码的段落报错", () => {
    const r = inspectTranscript({ segments: [{ text: "没有时间码" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("时间戳");
  });

  it("正常导入保持说话人和段落", () => {
    const r = inspectTranscript({
      audio: { filename: "a.m4a", duration: 10 },
      speakers: [{ id: "spk1", name: "王远" }],
      segments: [{ id: "s1", speaker_id: "spk1", start: 0, end: 5, text: "你好" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.transcript.segments).toHaveLength(1);
      expect(r.transcript.segments[0].text).toBe("你好");
      expect(r.repairs).toEqual([]);
    }
  });

  it("缺说话人名单时自动补上", () => {
    const r = inspectTranscript({
      audio: { filename: "a.m4a" },
      segments: [{ id: "s1", speaker_id: "spkA", start: 0, end: 5, text: "你好" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.transcript.speakers.map((s) => s.id)).toEqual(["spkA"]);
      expect(r.transcript.speakers[0].name).toBe("说话人 1");
      expect(r.repairs.some((x) => x.includes("自动创建"))).toBe(true);
    }
  });

  it("段落缺说话人时归入「未标注」", () => {
    const r = inspectTranscript({
      audio: { filename: "a.m4a" },
      segments: [{ id: "s1", start: 0, end: 5, text: "你好" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.transcript.segments[0].speaker_id).toBe(UNLABELED_SPEAKER_ID);
    }
  });

  it("段落缺编号时自动补上", () => {
    const r = inspectTranscript({
      audio: { filename: "a.m4a" },
      speakers: [{ id: "spk1", name: "王远" }],
      segments: [{ speaker_id: "spk1", start: 0, end: 5, text: "你好" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.transcript.segments[0].id).toBeTruthy();
      expect(r.repairs.some((x) => x.includes("片段编号"))).toBe(true);
    }
  });

  it("旧版「Speaker N」规范为「说话人 N」", () => {
    const r = inspectTranscript({
      audio: { filename: "a.m4a" },
      speakers: [{ id: "spk1", name: "Speaker 1" }],
      segments: [{ id: "s1", speaker_id: "spk1", start: 0, end: 5, text: "你好" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.transcript.speakers[0].name).toBe("说话人 1");
    }
  });

  it("识别顶层 engine 字段", () => {
    const r = inspectTranscript({
      engine: "ElevenLabs Scribe v2",
      audio: { filename: "a.m4a" },
      speakers: [],
      segments: [{ id: "s1", speaker_id: "x", start: 0, end: 5, text: "你好" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.engine).toBe("ElevenLabs Scribe v2");
    }
  });
});

describe('damaged optional transcript data', () => {
  const segment = { id: 's1', speaker_id: 'a', start: 0, end: 1, text: '正文' };
  it.each([
    { words: { length: 1 } },
    { words: [null] },
    { words: [{ text: '正文', start: 1, end: 0 }] },
    { annotations: '损坏的批注' },
    { annotations: [null] },
    { annotations: [{ id: 'a', text: { broken: true }, createdAt: '' }] },
  ])('rejects malformed nested fields without changing the input: %j', extra => {
    const data = { segments: [{ ...segment, ...extra }] };
    const before = JSON.stringify(data);
    expect(inspectTranscript(data).ok).toBe(false);
    expect(JSON.stringify(data)).toBe(before);
  });
});

it('preserves valid word timing, source coordinates and annotations on import', () => {
  const words = [{ text: '正文', start: 0, end: 1, origins: [{ model: 'm', segment: 's', from: 0, to: 2, start: 0, end: 1 }] }];
  const annotations = [{ id: 'note', text: '保留批注', createdAt: '2026-09-22' }];
  const result = inspectTranscript({ segments: [{ id: 's', speaker_id: 'a', start: 0, end: 1, text: '正文', words, annotations }] });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.transcript.segments[0].words).toEqual(words);
    expect(result.transcript.segments[0].annotations).toEqual(annotations);
  }
});
