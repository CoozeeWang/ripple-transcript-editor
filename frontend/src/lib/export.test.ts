import { setInterfaceLanguage } from "../i18n";
import { describe, it, expect } from "vitest";

import {
  exportFormats,
  exportFilenameStem,
  buildExportModel,
  buildJsonPayload,
  escapeHtml,
  formatClock,
  formatDateField,
  renderMarkdown,
  renderTxt,
  renderDocx,
  renderPdfHtml,
} from "./export";
import type { InterviewMetadata, Transcript } from "../types";

it('does not export internal AI save receipts as manuscript JSON',()=>{
  const transcript:Transcript={audio:{filename:'synthetic.wav',duration:1},speakers:[],segments:[{id:'s',speaker_id:'',start:0,end:1,text:'Synthetic'}],
    aiContinuationReceipts:{task:{task_id:'task',batch_id:'batch',source_version_id:'m:e1',version_id:'m:e2',processed_ids:['s'],changed_segments:1,deleted_segments:0,merged_segments:0}}};
  expect(buildJsonPayload(transcript,undefined)).not.toHaveProperty('aiContinuationReceipts');
  expect(transcript.aiContinuationReceipts).toBeTruthy();
});

it('retains paragraph breaks and annotation ranges in Word and PDF exports', async () => {
  const model = buildExportModel({ audio: { filename: 'synthetic.wav', duration: 2 }, speakers: [],
    segments: [{ id: 's', speaker_id: '', start: 0, end: 2, text: 'First paragraph\nSecond paragraph',
      annotations: [{ id: 'a', text: 'Synthetic note', createdAt: '2026-01-01' }] }] }, null);
  const { default: JSZip } = await import('jszip');
  const archive = await JSZip.loadAsync(await (await renderDocx(model)).arrayBuffer());
  const xml = await archive.file('word/document.xml')!.async('string');
  expect(xml).toMatch(/First paragraph[\s\S]*<w:br\/>[\s\S]*Second paragraph/);
  expect(xml).toMatch(/commentRangeStart[\s\S]*First paragraph[\s\S]*Second paragraph[\s\S]*commentRangeEnd/);
  expect(renderPdfHtml(model)).toContain('.body, .anno-text { white-space: pre-wrap; }');
  expect(renderPdfHtml(model)).toContain('First paragraph\nSecond paragraph');
});

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

  it.each(["第一段\n第二段", "第一段\r\n第二段", "第一段<br>第二段", "第一段<BR />第二段"])("exports real Markdown paragraphs for %s", text => {
    const md=renderMarkdown({...model,segments:[{...model.segments[0],text}]});
    expect(md).toContain("：第一段\n\n第二段\n");
    expect(md).not.toMatch(/<br/i);
    expect(text).toMatch(/第一段/);
  });

  it("txt 含标题和说话人", () => {
    const txt = renderTxt(model);
    expect(txt).toContain("标题");
    expect(txt).toContain("王远 [00:00:00]\n你好");
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

it('uses locale punctuation in format labels while keeping export format IDs stable',async()=>{
 const chinese=exportFormats();
 await setInterfaceLanguage('en');
 try {
  const english=exportFormats();
  expect(english.map(item=>item[1])).toEqual(chinese.map(item=>item[1]));
  expect(english.filter(item=>['docx','json','md'].includes(item[1])).map(item=>item[0])).toEqual(['Word (.docx)','JSON (.json)','Markdown (.md)']);
 } finally { await setInterfaceLanguage('zh-CN'); }
});

it('preserves literal manuscript text after real GFM parsing', async () => {
  const { marked } = await import('marked');
  const { JSDOM } = await import('jsdom');
  const body = '*literal* _text_ [link](https://example.invalid) <tag> &amp; \\path\n# literal heading\n- literal list\n1. literal item\n    indented text\n| a | b |\n| - | - |';
  const note = 'First *note*\n\n# still a note <tag>';
  const model = buildExportModel({ audio: { filename: 'synthetic.wav', duration: 1 }, speakers: [{ id: 's', name: 'Synthetic *speaker*' }], segments: [{ id: 's', speaker_id: 's', start: 0, end: 1, text: body, annotations: [{ id: 'a', text: note, createdAt: '2026-01-01' }] }] }, null);
  model.title = 'Synthetic <title>\n# literal title';
  model.notes = 'Synthetic note\n# literal metadata';
  const doc = new JSDOM(await marked.parse(renderMarkdown(model), { gfm: true })).window.document;
  expect(doc.querySelectorAll('h1')).toHaveLength(1);
  expect(doc.querySelector('h1')?.textContent).toBe('Synthetic <title> # literal title');
  expect(doc.querySelectorAll('a, em, code, pre, table, tag, script')).toHaveLength(0);
  expect(doc.querySelectorAll('strong')).toHaveLength(1);
  expect(doc.querySelector('strong')?.textContent).toBe('Synthetic *speaker*');
  for (const line of body.split('\n')) expect(doc.body.textContent).toContain(line);
  expect(doc.querySelectorAll('blockquote')).toHaveLength(1);
  for (const line of note.split('\n').filter(Boolean)) expect(doc.querySelector('blockquote')?.textContent).toContain(line);
  expect(doc.querySelectorAll('ul')).toHaveLength(1);
});

it.each([
  ['zh-CN', ['日期：2026/10/15', '地点：Synthetic location', '参与者：Synthetic speaker', '话题：Synthetic topic', '音频：synthetic.wav', '备注：First note\nSecond note']],
  ['en', ['Date: 2026/10/15', 'Location: Synthetic location', 'Participants: Synthetic speaker', 'Topics: Synthetic topic', 'Audio: synthetic.wav', 'Notes: First note\nSecond note']],
] as const)('includes the same interview information in Word and PDF for %s', async (language, fields) => {
  try {
    await setInterfaceLanguage(language);
    const { JSDOM } = await import('jsdom');
    const { default: JSZip } = await import('jszip');
    const model = buildExportModel({ audio: { filename: 'synthetic.wav', duration: 2 }, speakers: [{ id: 's', name: 'Synthetic speaker' }], segments: [{ id: 's1', speaker_id: 's', start: 0, end: 2, text: 'Synthetic body', annotations: [{ id: 'a', text: 'Synthetic annotation', createdAt: '2026-10-15' }] }] }, { id: 'synthetic', title: '合成标题 Synthetic title', recorded_at: '2026-10-15', location: 'Synthetic location', topics: ['Synthetic topic'], participants: [], notes: 'First note\nSecond note', created_at: '', updated_at: '' });
    const before = JSON.stringify(model);
    const archive = await JSZip.loadAsync(await (await renderDocx(model)).arrayBuffer());
    const xml = await archive.file('word/document.xml')!.async('string');
    const document = new JSDOM(xml, { contentType: 'application/xml' }).window.document;
    const paragraphs = [...document.getElementsByTagName('w:p')].map(p => [...p.getElementsByTagName('w:r')].map(r => [...r.children].map(c => c.tagName === 'w:br' ? '\n' : c.tagName === 'w:t' ? c.textContent : '').join('')).join(''));
    expect(paragraphs.slice(0, 7)).toEqual([model.title, ...fields]);
    expect(paragraphs.slice(7)).toEqual(['Synthetic speaker [00:00:00]', 'Synthetic body']);
    const pdf = new JSDOM(renderPdfHtml(model)).window.document;
    expect(pdf.querySelector('h1')?.textContent).toBe(model.title);
    expect([...pdf.querySelectorAll('table.meta tr')].map(row => [...row.children].map(cell => cell.textContent).join('：').replace('：', language === 'en' ? ': ' : '：'))).toEqual(fields);
    expect(await archive.file('word/comments.xml')!.async('string')).toContain('Synthetic annotation');
    const noNotes = await JSZip.loadAsync(await (await renderDocx({ ...model, notes: '' })).arrayBuffer());
    const noNotesDocument = new JSDOM(await noNotes.file('word/document.xml')!.async('string'), { contentType: 'application/xml' }).window.document;
    expect(noNotesDocument.getElementsByTagName('w:p')).toHaveLength(8);
    expect(JSON.stringify(model)).toBe(before);
  } finally { await setInterfaceLanguage('zh-CN'); }
});
