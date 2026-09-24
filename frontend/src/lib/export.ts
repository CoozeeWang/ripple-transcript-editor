import { msg, interfaceLanguage } from '../i18n';
import { validSpeakerColor, SPEAKER_PALETTE } from "./speakers";
import type { InterviewMetadata, Speaker, Transcript } from "../types";
import { sanitizeForFilename } from "../localStore";

// 导出（Markdown / TXT / Word / PDF / JSON）的格式化逻辑。
// 除 downloadBlob 外全部是无副作用的纯函数，独立成模块以便单元测试。

// 说话人配色，取自 app 内 .segment--speaker-0..3 的色板（按 speakers 数组顺序索引）。
const SPEAKER_COLORS = SPEAKER_PALETTE;
const SPEAKER_DEFAULT_COLOR = "#8e6a50";

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

// 将 ISO 日期或 "YYYY/MM/DD" 统一显示为 "YYYY/MM/DD"；空值返回"—"。
export function formatDateField(value: string | null | undefined): string {
  if (!value) return "—";
  const trimmed = value.trim();
  if (!trimmed) return "—";
  // Date-only metadata is a calendar day, not a UTC instant.
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed.replace(/-/g, "/");
  if (trimmed.includes("T") || trimmed.includes("-")) {
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      const y = parsed.getFullYear();
      const m = String(parsed.getMonth() + 1).padStart(2, "0");
      const d = String(parsed.getDate()).padStart(2, "0");
      return `${y}/${m}/${d}`;
    }
  }
  return trimmed;
}

interface ExportAnnotation {
  text: string;
  date: string;
}
interface ExportSegment {
  speakerName: string;
  speakerColor: string;
  timestamp: string;
  text: string;
  annotations: ExportAnnotation[];
}
export interface ExportModel {
  title: string;
  date: string;
  location: string;
  participants: string;
  topics: string;
  notes: string;
  audioFile: string;
  segments: ExportSegment[];
}

export function speakerColorFor(speakerId: string, speakers: Speaker[]): string {
  const speaker = speakers.find((s) => s.id === speakerId);
  if (validSpeakerColor(speaker?.color)) return speaker.color;
  const idx = speaker?.colorIndex ?? speakers.findIndex((s) => s.id === speakerId);
  return SPEAKER_COLORS[(idx >= 0 ? idx : 0) % SPEAKER_COLORS.length] ?? SPEAKER_DEFAULT_COLOR;
}

export function buildExportModel(
  transcript: Transcript,
  metadata: InterviewMetadata | null,
): ExportModel {
  const title = metadata?.title?.trim() || transcript.audio?.filename || msg('export.m1307');
  return {
    title,
    date: formatDateField(metadata?.recorded_at),
    location: metadata?.location?.trim() || "—",
    // 参与者自动匹配说话人列表：UI 没有其他输入参与者的入口，metadata.participants
    // 通常是空的，直接用 transcript.speakers 保证导出始终反映真实说话人。
    participants: transcript.speakers.map((s) => s.name).join("、") || "—",
    topics: (metadata?.topics ?? []).join("、") || "—",
    notes: metadata?.notes?.trim() || "",
    audioFile: transcript.audio?.filename || "—",
    segments: transcript.segments.map((seg) => {
      const sp = transcript.speakers.find((s) => s.id === seg.speaker_id);
      return {
        speakerName: sp?.name || msg('export.m1308'),
        speakerColor: speakerColorFor(seg.speaker_id, transcript.speakers),
        timestamp: transcript.timeAligned === false ? "" : formatClock(seg.start),
        text: seg.text || "",
        annotations: (seg.annotations ?? []).map((a) => ({
          text: a.text,
          date: formatDateField(a.createdAt),
        })),
      };
    }),
  };
}

export function renderMarkdown(m: ExportModel): string {
  const lines: string[] = ["# " + m.title, ""];
  lines.push(msg('export.m1309', { v0: m.date }));
  lines.push(msg('export.m1310', { v0: m.location }));
  lines.push(msg('export.m1311', { v0: m.participants }));
  lines.push(msg('export.m1312', { v0: m.topics }));
  lines.push(msg('export.m1313', { v0: m.audioFile }));
  if (m.notes) lines.push(msg('export.m1314', { v0: m.notes }));
  lines.push("", "---", "");
  for (const seg of m.segments) {
    lines.push(`**${seg.speakerName}**${seg.timestamp ? ` [${seg.timestamp}]` : ""}：${seg.text}`);
    for (const a of seg.annotations) {
      lines.push(msg('export.m1315', { v0: a.date, v1: a.text }));
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function renderTxt(m: ExportModel): string {
  const lines: string[] = [m.title, ""];
  lines.push(msg('export.m1316', { v0: m.date }));
  lines.push(msg('export.m1317', { v0: m.location }));
  lines.push(msg('export.m1318', { v0: m.participants }));
  lines.push(msg('export.m1319', { v0: m.topics }));
  lines.push(msg('export.m1320', { v0: m.audioFile }));
  if (m.notes) lines.push(msg('export.m1321', { v0: m.notes }));
  lines.push("", "========", "");
  for (const seg of m.segments) {
    lines.push(`${seg.speakerName}${seg.timestamp ? ` [${seg.timestamp}]` : ""}：${seg.text}`);
    for (const a of seg.annotations) {
      lines.push(msg('export.m1322', { v0: a.date, v1: a.text }));
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// PDF 通过浏览器打印导出：返回带内联打印样式的完整 HTML 文档。
export function renderPdfHtml(m: ExportModel): string {
  const meta: Array<[string, string]> = [
    [msg('export.m1323'), m.date],
    [msg('export.m1324'), m.location],
    [msg('export.m1325'), m.participants],
    [msg('export.m1326'), m.topics],
    [msg('export.m1327'), m.audioFile],
  ];
  if (m.notes) meta.push([msg('export.m1328'), m.notes]);
  const metaHtml = meta
    .map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`)
    .join("");
  const segHtml = m.segments
    .map((seg) => {
      const anns = seg.annotations
        .map(
          (a) =>
            `<div class="anno"><span class="anno-tag">${escapeHtml(msg('export.m1329', { v0: a.date }))}</span><span class="anno-text">${escapeHtml(a.text)}</span></div>`,
        )
        .join("");
      return `<div class="seg"><span class="sp" style="color:${seg.speakerColor}">${escapeHtml(
        seg.speakerName,
      )}</span><span class="ts">${seg.timestamp ? `[${seg.timestamp}]` : ""}</span><span class="body">：${escapeHtml(
        seg.text,
      )}</span></div>${anns}`;
    })
    .join("");
  return `<!doctype html>
<html lang="${interfaceLanguage()}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(m.title)}</title>
<style>
  body { font-family: Inter, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color:#262621; max-width: 820px; margin: 0 auto; padding: 24px; line-height: 1.7; }
  h1 { font-size: 22px; margin: 0 0 12px; }
  table.meta { border-collapse: collapse; font-size: 13px; margin-bottom: 16px; }
  table.meta th { text-align: left; color:#888; font-weight: 600; padding: 2px 12px 2px 0; white-space: nowrap; vertical-align: top; }
  table.meta td { padding: 2px 0; }
  hr { border: none; border-top: 1px solid #e2e0d8; margin: 16px 0; }
  .seg { margin: 10px 0 2px; }
  .sp { font-weight: 700; }
  .ts { color:#999; font-family: ui-monospace, Menlo, monospace; font-size: 12px; margin: 0 4px; }
  .anno { margin: 2px 0 6px 0; padding: 6px 10px; background:#fff8e6; border-left: 3px solid #e0b84a; border-radius: 3px; font-size: 13.5px; }
  .anno-tag { color:#9a7b2e; font-weight:600; margin-right:6px; }
  .toolbar { display:flex; justify-content:flex-end; align-items:center; margin:0 0 24px; padding:0 0 16px; border-bottom:1px solid #deddd6; }
  .toolbar button { min-height:36px; padding:0 14px; border:1px solid #d8d6ce; border-radius:8px; background:#fff; color:#262621; font:670 0.78rem/1.3 Inter, -apple-system, "PingFang SC", sans-serif; cursor:pointer; }
  .toolbar button:hover { background:#f4f1ea; }
  .toolbar button:focus-visible { outline:2px solid #327884; outline-offset:2px; }
  @media print { body { margin:0; padding:0; } .toolbar { display:none; } @page { margin: 18mm; } }
</style>
</head>
<body>
  <div class="toolbar"><button onclick="window.print()">${escapeHtml(msg('extra.print'))}</button></div>
  <h1>${escapeHtml(m.title)}</h1>
  <table class="meta">${metaHtml}</table>
  <hr/>
  ${segHtml}
</body>
</html>`;
}

// Word：浏览器内用 docx 库生成真实 .docx，批注用原生评论（作者留空、带日期）。
// 注意：docx 的评论 id 必须是数字（CommentRangeStart/End/Reference 与 ICommentOptions.id 均为 number）。
export async function renderDocx(m: ExportModel): Promise<Blob> {
  const docx = await import("docx");
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    CommentRangeStart,
    CommentRangeEnd,
    CommentReference,
  } = docx;

  const commentConfigs: Array<{
    id: number;
    author: string;
    date: Date;
    children: unknown[];
  }> = [];

  const paragraphChildren: unknown[] = [];
  let commentId = 0;

  m.segments.forEach((seg) => {
    const speakerRun = new TextRun({ text: `${seg.speakerName} `, bold: true, color: seg.speakerColor.replace("#", "") });
    const tsRun = new TextRun({ text: seg.timestamp ? `[${seg.timestamp}]：` : "：", color: "999999" });
    const bodyRun = new TextRun({ text: seg.text });

    const runs: unknown[] = [speakerRun, tsRun];
    if (seg.annotations.length === 0) {
      runs.push(bodyRun);
    } else {
      const ids: number[] = [];
      seg.annotations.forEach((a) => {
        const id = commentId++;
        const parsed = new Date(a.date.replace(/\//g, "-"));
        commentConfigs.push({
          id,
          author: "",
          date: Number.isNaN(parsed.getTime()) ? new Date() : parsed,
          children: [new Paragraph(a.text)],
        });
        ids.push(id);
      });
      const startRuns = ids.map((id) => new CommentRangeStart(id));
      const endRuns = ids.map((id) => new CommentRangeEnd(id)).reverse();
      const refRuns = ids.map((id) => new CommentReference(id));
      runs.push(...startRuns, bodyRun, ...endRuns, ...refRuns);
    }
    paragraphChildren.push(
      new Paragraph({ spacing: { after: 120 }, children: runs as never }),
    );
  });

  const doc = new Document({
    comments: { children: commentConfigs as never },
    sections: [{ children: paragraphChildren as never }],
  });

  return Packer.toBlob(doc);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 构造 JSON 导出的载荷：engine 非 imported 时在顶层标注来源引擎，否则原样导出。 */
export function buildJsonPayload(
  transcript: Transcript,
  engine: string | undefined,
): Record<string, unknown> {
  // 高亮是编辑辅助记号，不随 JSON 导出：它不是稿件内容，落到别处只会变成
  // 一堆脱离了上下文的偏移量。md/txt/docx/pdf 由各自 render 函数决定，
  // 天然不含高亮——这里显式剥离，是为了让 JSON 也保持一致。
  const segments = transcript.segments.map((segment) => {
    const copy = { ...segment };
    delete copy.highlights;
    if(copy.words)copy.words=copy.words.map(word=>{
      const clean={...word};delete clean.origins;delete clean.timing;return clean;
    });
    return copy;
  });
  const base = { ...transcript, segments } as Record<string, unknown>;
  delete base.comparisonReviews;
  if (engine && engine !== "imported") {
    return { engine, ...base };
  }
  return base;
}

/** Display labels remain unchanged; exported filenames use consistent separators. */
export function exportFilenameStem(title: string, versionLabel?: string): string {
  return [sanitizeForFilename(title) || "transcript", versionLabel ? sanitizeForFilename(versionLabel) : ""].filter(Boolean).join("_");
}

/** 按格式导出当前转录。engine 用于 JSON 导出时标注来源引擎（非 imported 才写入）。 */
export async function exportTranscript(
  format: ExportFormat,
  transcript: Transcript,
  metadata: InterviewMetadata | null,
  engine: string | undefined,
  versionLabel?: string,
): Promise<void> {
  const model = buildExportModel(transcript, metadata);
  const stem = exportFilenameStem(model.title, versionLabel);
  if (format !== 'pdf') {
    downloadBlob(await transcriptBlob(format, transcript, metadata, engine), `${stem}.${format}`);
    return;
  }
  if (format === "pdf") {
    const html = renderPdfHtml(model).replace(/<title>.*?<\/title>/s, `<title>${escapeHtml(stem)}</title>`);
    const win = window.open("", "_blank");
    if (win) {
      win.document.write(html);
      win.document.close();
      win.focus();
      window.setTimeout(() => {
        try {
          win.print();
        } catch {
          /* 用户可在新页面手动打印 */
        }
      }, 300);
    } else {
      downloadBlob(new Blob([html], { type: "text/html;charset=utf-8" }), `${stem}.html`);
    }
  }
}

export const exportFormats = () => [
  ['Word（.docx）', 'docx'], [msg('export.m1331'), 'txt'], [msg('export.m1332'), 'pdf'],
  ['JSON（.json）', 'json'], [msg('export.m1333'), 'srt'], [msg('export.m1334'), 'vtt'], ['Markdown（.md）', 'md'],
] as const;
export type ExportFormat = ReturnType<typeof exportFormats>[number][1];
export function canExportSubtitles(t: Transcript) {
  return t.timeAligned !== false && t.segments.length > 0 && t.segments.every(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.start >= 0 && Math.round(s.end * 1000) > Math.round(s.start * 1000));
}
export function renderSubtitles(t: Transcript, format: 'srt' | 'vtt') {
  if (!canExportSubtitles(t)) throw new Error(msg('export.m1335'));
  const time = (seconds: number) => { const ms = Math.round(seconds * 1000); return `${formatClock(Math.floor(ms / 1000))}${format === 'srt' ? ',' : '.'}${String(ms % 1000).padStart(3, '0')}`; };
  return (format === 'vtt' ? 'WEBVTT\n\n' : '') + t.segments.map((s, i) => `${i + 1}\n${time(s.start)} --> ${time(s.end)}\n${s.text.replace(/\r?\n\s*\r?\n/g, '\n')}`).join('\n\n') + '\n';
}
export async function transcriptBlob(format: Exclude<ExportFormat, 'pdf'>, t: Transcript, metadata: InterviewMetadata | null, engine?: string): Promise<Blob> {
  const model = buildExportModel(t, metadata);
  if (format === 'docx') return renderDocx(model);
  const text = format === 'json' ? JSON.stringify(buildJsonPayload(t, engine), null, 2) : format === 'md' ? renderMarkdown(model) : format === 'txt' ? renderTxt(model) : renderSubtitles(t, format);
  return new Blob([text], { type: format === 'json' ? 'application/json' : 'text/plain;charset=utf-8' });
}
