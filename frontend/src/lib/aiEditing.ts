import { apiErrorMessage } from '../i18n/errors';
import { msg } from '../i18n';
import { comparisonRows } from "./comparisonSegments";
import { mergeSegmentWithNext } from "./segmentOps";
import type { Segment, Transcript } from "../types";
import { mapCharsByDiff, reanchorCharacters, reanchorRanges } from "./transcriptOps";

export interface AIExample { before: string; after: string; source: string }
export interface AIPreference { document_id?: string | null; common?: boolean; kind?: "rule" | "style"; name: string; instructions: string; examples: AIExample[] }
export interface SavedAIPreference extends AIPreference { id: string; updated_at: string }
export interface AIEngineChoice { id: string; name: string; model: string; revision?: string; active: boolean }
export interface AIConfig { revision?: string; engines?: AIEngineChoice[]; selected_engine_id?: string | null; base_url: string; model: string; has_key: boolean; configured: boolean }
export interface AISuggestion { action?: "edit" | "delete" | "merge_previous"; id: string; text: string; reason: string }

export function reviewRevision(segment: Segment): string {
  return JSON.stringify([segment.text, segment.start, segment.end, segment.speaker_id]);
}

export function isReviewed(segment: Segment, reviews: Record<string, string>): boolean {
  return reviews[segment.id] === reviewRevision(segment);
}

export function markReviewed(transcript: Transcript, segments: Segment[], reviewed: boolean): Record<string, string> {
  const next = Object.fromEntries(transcript.segments.filter(s => isReviewed(s, transcript.reviewedSegments ?? {}))
    .map(s => [s.id, reviewRevision(s)]));
  for (const segment of segments) {
    if (reviewed) next[segment.id] = reviewRevision(segment);
    else delete next[segment.id];
  }
  return next;
}

export async function aiRequest<T>(path: string, body?: unknown, signal?: AbortSignal, method?: string): Promise<T> {
  const response = await fetch(`/api/ai/${path}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body), signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 404 && data?.detail === "Not Found") {
      throw new Error(msg('aiEditing.m1203'));
    }
    throw new Error(apiErrorMessage(data, response.status, msg('aiEditing.m1205')));
  }
  return data as T;
}

/** Ranges use audio windows, not segment ids: merging and splitting changes ids.
 * The preview is explicitly confirmed by the user before becoming an example. */
export function exampleForRange(original: Transcript | null, segments: Segment[], source: string): AIExample {
  if (!segments.length) return { before: "", after: "", source };
  if (original?.timeAligned === false) return { before: comparisonRows(segments, original.segments).filter(r => !r.deleted).map(r => r.before ?? "").join("\n\n"), after: segments.map(s => s.text).join("\n\n"), source };
  const start = Math.min(...segments.map(s => s.start));
  const end = Math.max(...segments.map(s => s.end));
  const matches = original?.segments.filter(s => s.end > start && s.start < end) ?? [];
  const before = matches.map(s => {
    if (s.start >= start && s.end <= end) return s.text;
    if (s.words?.length && s.words.map(w => w.text).join("") === s.text && s.words.some(w => w.end > w.start)) {
      return s.words.filter(w => w.end > start && w.start < end).map(w => w.text).join("");
    }
    return s.text;
  }).join("\n\n");
  return { before, after: segments.map(s => s.text).join("\n\n"), source };
}

/** Learning cannot ask the user to repair an ambiguous original/current pairing. */
export function learningExample(original: Transcript | null, segments: Segment[], source: string): AIExample {
  if (!original) throw new Error(msg('aiEditing.m1206'));
  if (!segments.length) throw new Error(msg('aiEditing.m1207'));
  if (original.timeAligned === false) {
    if (segments.some(s => s.splitFrom)) throw new Error(msg('aiEditing.m1208'));
    const example = exampleForRange(original, segments, source);
    if (!example.before.trim() || !example.after.trim()) throw new Error(msg('aiEditing.m1209'));
    if (example.before.length > 12000 || example.after.length > 12000) throw new Error(msg('aiEditing.m1210'));
    return example;
  }
  const start = Math.min(...segments.map(s => s.start));
  const end = Math.max(...segments.map(s => s.end));
  const matches = original.segments.filter(s => s.end > start && s.start < end);
  if (!matches.length) throw new Error(msg('aiEditing.m1211'));
  for (const s of matches) {
    if (s.start >= start && s.end <= end) continue;
    const words = s.words;
    if (!words?.length || words.map(w => w.text).join("") !== s.text || !words.some(w => w.end > w.start) ||
        words.some(w => (w.start < start && w.end > start) || (w.start < end && w.end > end))) {
      throw new Error(msg('aiEditing.m1212'));
    }
  }
  const example = exampleForRange(original, segments, source);
  if (!example.before.trim() || !example.after.trim()) throw new Error(msg('aiEditing.m1213'));
  if (example.before.length > 12000 || example.after.length > 12000) throw new Error(msg('aiEditing.m1214'));
  return example;
}

export function batchSegments(segments: Segment[]): Segment[][] {
  const batches: Segment[][] = [];
  let batch: Segment[] = [];
  let length = 0;
  for (const segment of segments) {
    if (segment.text.length > 6000) throw new Error(msg('aiEditing.m1215'));
    if (batch.length && (length + segment.text.length > 3000 || batch.length === 128)) {
      batches.push(batch); batch = []; length = 0;
    }
    batch.push(segment); length += segment.text.length;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export function applyAISuggestions(current: Transcript, baseline: Transcript, suggestions: AISuggestion[]): Transcript {
  if (JSON.stringify(current) !== JSON.stringify(baseline)) {
    throw new Error(msg('aiEditing.m1216'));
  }
  const changes = new Map(suggestions.map(s => [s.id, s]));
  if (changes.size !== suggestions.length || suggestions.some(s => !current.segments.some(c => c.id === s.id) ||
    !["edit","delete","merge_previous"].includes(s.action ?? "edit") ||
    (s.action === "delete" ? Boolean(s.text.trim()) : !s.text.trim()))) {
    throw new Error(msg('aiEditing.m1217'));
  }
  let segments = current.segments.map(segment => {
    const suggestion = changes.get(segment.id);
    if (!suggestion || suggestion.action === "delete" || suggestion.text === segment.text) return segment;
    return {...segment,text:suggestion.text,
      words:reanchorCharacters(segment.words,segment.text,suggestion.text),
      highlights:segment.highlights ? reanchorRanges(segment.highlights,segment.text,suggestion.text) : undefined};
  });
  for (let i=0;i<current.segments.length;i++) {
    const original=current.segments[i];
    const suggestion=changes.get(original.id);
    if (suggestion?.action === "delete") segments=segments.filter(s=>s.id!==original.id);
    if (suggestion?.action === "merge_previous") {
      const previous=current.segments[i-1];
      if (!previous || previous.speaker_id !== original.speaker_id || changes.get(previous.id)?.action === "delete") throw new Error(msg('aiEditing.m1218'));
      const index=segments.findIndex(s=>s.id===original.id);
      if(index<1 || segments[index-1].speaker_id!==original.speaker_id) throw new Error(msg('aiEditing.m1219'));
      segments=mergeSegmentWithNext(segments,segments[index-1].id)!;
    }
  }
  return {...current,segments,lastEditedSegmentId:segments.find(s=>changes.has(s.id))?.id ?? segments[0]?.id};
}

export function diffParts(before: string, after: string, side: "before" | "after") {
  const mapping = mapCharsByDiff(before, after);
  const kept = new Set(Array.from(mapping).filter(i => i >= 0));
  const text = side === "before" ? before : after;
  const parts: { text: string; changed: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const changed = side === "before" ? !kept.has(i) : mapping[i] < 0;
    const last = parts.at(-1);
    if (last?.changed === changed) last.text += text[i];
    else parts.push({ text: text[i], changed });
  }
  return parts;
}

export const BUILTIN_EDITING_RULES: SavedAIPreference[] = [
  ["punctuation", "中文标点", "中文语句使用中文标点，保留网址、小数和英文词语内部的符号。"],
  ["spacing", "中英文空格", "中文与英文单词、阿拉伯数字之间各留一个半角空格。"],
  ["speech", "保留口语表达", "保留说话人的措辞、语气和句式，不改写为书面语。"],
  ["repetition", "精简无意义重复", "删减明显的口吃和重复起句，保留用于强调或表达情绪的重复。"],
  ["uncertainty", "保留不确定性", "保留可能、大概、我记得等限定语，不将推测或模糊记忆改为确定陈述。"],
  ["emphasis", "保留有意义的重复", "保留表达强调、情绪或思考过程的重复；仅凭文字无法判断时保留，不一概去重。"],
  ["self-correction", "保留自我修正", "保留说话人否定、补充或修正自己说法的过程，不只留下最后的结论。"],
  ["facts", "不擅自改动事实", "不擅自补全或修改人名、地名、日期和数字，不用常识改写说话人的陈述；有疑问时保留原文并在修改理由中提示人工核对。"],
  ["unclear", "保留存疑标记", "保留原稿已有的听不清、存疑及非语言事件标记，不猜填内容，不凭文字虚构停顿、笑声或语气。"],
].map(([id,name,instructions]) => ({id:`builtin:${id}`,name,instructions,examples:[],kind:"rule",updated_at:""}));


export const BUILTIN_RULE_EXAMPLES: Record<string, string> = {
  "builtin:punctuation": "例如：你好,世界 → 你好，世界。",
  "builtin:spacing": "例如：用了AI处理20段 → 用了 AI 处理 20 段。此项是排版偏好。",
  "builtin:speech": "例如：‘我觉得吧，这事还得看看’保留口语句式。",
  "builtin:repetition": "例如：‘我，我当时去了’可整理为‘我当时去了’；拿不准是否有意义时保留。",
  "builtin:uncertainty": "例如：‘大概是八月’不能改成‘是八月’。",
  "builtin:emphasis": "例如：‘真的，真的很难’保留强调。",
  "builtin:self-correction": "例如：‘去年……不，是前年’保留修正过程。",
  "builtin:facts": "例如：‘我记得是 1982 年’不能凭常识改为另一年。",
  "builtin:unclear": "例如：‘后来去了[听不清]’保留标记，不猜地名。",
};

// Number independently for each source label, without reusing gaps in saved names.
export function nextAIEditName(sourceLabel: string, existingLabels: string[]): string {
  const prefix = `${sourceLabel} · AI 辅助 `;
  const legacyPrefix = `${sourceLabel} · AI 修改稿 `;
  const numbers = existingLabels.filter(label => label.startsWith(prefix) || label.startsWith(legacyPrefix))
    .map(label => label.slice(label.startsWith(prefix) ? prefix.length : legacyPrefix.length))
    .filter(suffix => /^\d+$/.test(suffix))
    .map(Number).filter(Number.isSafeInteger);
  const next = Math.max(0, ...numbers) + 1;
  return prefix + String(next).padStart(2, "0");
}
