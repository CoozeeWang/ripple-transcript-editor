import { describe, it, expect } from "vitest";

import {
  exportFilenameStem,
  buildExportModel,
  buildJsonPayload,
  escapeHtml,
  formatClock,
  formatDateField,
  renderMarkdown,
  renderTxt,
} from "./export";
import type { InterviewMetadata, Transcript } from "../types";

describe("formatClock", () => {
  it("0 秒 → 00:00:00", () => {
    expect(formatClock(0)).toBe("00:00:00");
  });

  it("65 秒 → 00:01:05", () => {
    expect(formatClock(65)).toBe("00:01:05");
  });

  it("3661 秒 → 01:01:01", () => {
    expect(formatClock(3661)).toBe("01:01:01");
  });
});

describe("formatDateField", () => {
  it("空值返回 —", () => {
    expect(formatDateField(null)).toBe("—");
    expect(formatDateField(undefined)).toBe("—");
    expect(formatDateField("")).toBe("—");
  });

  it("ISO 日期转 YYYY/MM/DD", () => {
    expect(formatDateField("2026-08-31T14:00")).toBe("2026/08/31");
  });

  it("已是 YYYY/MM/DD 则原样返回", () => {
    expect(formatDateField("2026/08/31")).toBe("2026/08/31");
  });
});

describe("buildExportModel", () => {
  const transcript: Transcript = {
    audio: { filename: "meeting.m4a", duration: 10 },
    speakers: [{ id: "spk1", name: "王远", colorIndex: 0 }],
    segments: [
      {
        id: "seg1",
        speaker_id: "spk1",
        start: 0,
        end: 5,
        text: "你好",
        annotations: [{ id: "a1", text: "重点", createdAt: "2026/08/31" }],
      },
    ],
  };

  const metadata: InterviewMetadata = {
    id: "iv1",
    title: "一次访谈",
    recorded_at: "2026-08-31T14:00",
    location: "北京",
    participants: [{ name: "王远", role: "采访者" }],
    topics: ["城市记忆"],
    notes: "备注内容",
    created_at: "2026-08-31T00:00",
    updated_at: "2026-08-31T00:00",
  };

  it("映射标题、元数据与说话人", () => {
    const model = buildExportModel(transcript, metadata);
    expect(model.title).toBe("一次访谈");
    expect(model.location).toBe("北京");
    // 参与者自动匹配说话人列表（不再读取 metadata.participants）。
    expect(model.participants).toBe("王远");
    expect(model.segments[0].speakerName).toBe("王远");
    expect(model.segments[0].timestamp).toBe("00:00:00");
    expect(model.segments[0].annotations[0].text).toBe("重点");
  });

  it("无 metadata 时回退到音频文件名", () => {
    const model = buildExportModel(transcript, null);
    expect(model.title).toBe("meeting.m4a");
  });

  it("未知说话人标注为「未知说话人」", () => {
    const t: Transcript = {
      ...transcript,
      segments: [{ id: "s1", speaker_id: "ghost", start: 0, end: 1, text: "x" }],
    };
    const model = buildExportModel(t, metadata);
    expect(model.segments[0].speakerName).toBe("未知说话人");
  });
});

describe("renderMarkdown / renderTxt", () => {
  const model = buildExportModel(
    {
      audio: { filename: "a.m4a", duration: 1 },
      speakers: [{ id: "spk1", name: "王远" }],
      segments: [{ id: "s1", speaker_id: "spk1", start: 0, end: 1, text: "你好" }],
    },
    {
      id: "iv1",
      title: "标题",
      recorded_at: null,
      location: "地点",
      participants: [],
      topics: [],
      notes: "",
      created_at: "",
      updated_at: "",
    },
  );

  it("markdown 含标题和说话人", () => {
    const md = renderMarkdown(model);
    expect(md).toContain("# 标题");
    expect(md).toContain("**王远** [00:00:00]：你好");
  });

  it("txt 含标题和说话人", () => {
    const txt = renderTxt(model);
    expect(txt).toContain("标题");
    expect(txt).toContain("王远 [00:00:00]：你好");
  });
});

describe("escapeHtml", () => {
  it("转义 < > &", () => {
    expect(escapeHtml("<a>&</a>")).toBe("&lt;a&gt;&amp;&lt;/a&gt;");
  });
});

describe("buildJsonPayload", () => {
  function makeTranscript(): Transcript {
    return {
      audio: { filename: "interview.m4a" } as Transcript["audio"],
      speakers: [],
      segments: [],
    } as Transcript;
  }

  it("engine 非 imported 时写入 engine 字段", () => {
    const payload = buildJsonPayload(makeTranscript(), "elevenlabs");
    expect(payload.engine).toBe("elevenlabs");
  });

  it("engine 为 imported 时不写入", () => {
    const payload = buildJsonPayload(makeTranscript(), "imported");
    expect(payload.engine).toBeUndefined();
  });

  it("engine 为空时不写入", () => {
    const payload = buildJsonPayload(makeTranscript(), undefined);
    expect(payload.engine).toBeUndefined();
  });

  it("原 transcript 字段保留", () => {
    const t = makeTranscript();
    const payload = buildJsonPayload(t, "elevenlabs") as { segments: unknown[]; audio: unknown };
    expect(payload.segments).toEqual([]);
    expect(payload.audio).toEqual(t.audio);
  });
});


it("formats export filenames with a source title and version label", () => {
  expect(exportFilenameStem("访谈名称", "修改稿 v1 · AI 辅助 01")).toBe("访谈名称_修改稿 v1 · AI 辅助 01");
  expect(exportFilenameStem("访谈名称", "我的定稿")).toBe("访谈名称_我的定稿");
  expect(exportFilenameStem("访谈名称", "原稿")).toBe("访谈名称_原稿");
});
it('exports a date-only value without timezone conversion',()=>{
 expect(formatDateField('2026-09-20')).toBe('2026/09/20');
});
it('does not export invented zero timestamps for untimed manuscripts',()=>{
 const t={timeAligned:false,audio:{filename:'',duration:0},speakers:[{id:'s',name:'说话人'}],segments:[{id:'a',speaker_id:'s',text:'原话',start:0,end:0}]};
 const model=buildExportModel(t,null);
 expect(renderTxt(model)).not.toContain('[00:00]');
 expect(renderMarkdown(model)).toContain('**说话人**：原话');
 expect(buildJsonPayload(t,undefined).timeAligned).toBe(false);
});

describe('subtitle export', () => {
  const t: Transcript = { audio: { filename: '访谈.wav', duration: 70 }, speakers: [], segments: [{ id: 'a', speaker_id: '', start: 59.9996, end: 65.25, text: '第一句\n第二句' }] };
  it('uses millisecond timestamps with carry and the correct subtitle headers', async () => {
    const { renderSubtitles } = await import('./export');
    expect(renderSubtitles(t, 'srt')).toBe('1\n00:01:00,000 --> 00:01:05,250\n第一句\n第二句\n');
    expect(renderSubtitles(t, 'vtt')).toContain('WEBVTT\n\n1\n00:01:00.000 --> 00:01:05.250');
  });
  it('rejects untimed imports and invalid durations rather than inventing timing', async () => {
    const { renderSubtitles, canExportSubtitles } = await import('./export');
    expect(() => renderSubtitles({ ...t, timeAligned: false }, 'srt')).toThrow('没有有效时间戳');
    expect(canExportSubtitles({ ...t, segments: [{ ...t.segments[0], end: 0 }] })).toBe(false);
    expect(canExportSubtitles({ ...t, segments: [] })).toBe(false);
  });
});
