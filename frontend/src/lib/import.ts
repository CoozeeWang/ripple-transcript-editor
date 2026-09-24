import { msg } from '../i18n';
import type { Segment, Speaker, Transcript } from "../types";

// 导入转录 JSON 的校验与修复逻辑（纯函数，无副作用）。

// 导入的转录里没标说话人的段落，先归到这个占位说话人名下，用户可在说话人卡片上改派。
export const UNLABELED_SPEAKER_ID = "未标注说话人";

export type TranscriptCheck =
  | { ok: true; transcript: Transcript; repairs: string[]; engine?: string }
  | { ok: false; message: string };

/**
 * 读一份导入的 JSON：能补的就地补好并记一笔（缺说话人名单、段落没编号等），
 * 补不了的才报错。报错文案不说内部结构名——用户不知道 speakers 是什么，
 * 更不该被要求去改 JSON 字段。
 */
export function inspectTranscript(value: unknown): TranscriptCheck {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      message:
        msg('import.m1341'),
    };
  }
  const candidate = value as Partial<Transcript>;
  if (!Array.isArray(candidate.segments)) {
    return {
      ok: false,
      message:
        msg('import.m1342'),
    };
  }
  if (candidate.segments.length === 0) {
    return { ok: false, message: msg('import.m1343') };
  }

  const repairs: string[] = [];
  const audioName = typeof candidate.audio?.filename === "string" ? candidate.audio.filename : "";
  if (!audioName) repairs.push(msg('import.m1344'));

  const idStamp = Date.now().toString(36);
  const segments: Segment[] = [];
  const usedIds = new Set<string>();
  let missingId = 0;
  let missingText = 0;
  let missingSpeaker = 0;
  for (let index = 0; index < candidate.segments.length; index += 1) {
    const raw = candidate.segments[index] as Partial<Segment> | undefined;
    if (!raw || typeof raw.start !== "number" || typeof raw.end !== "number") {
      return {
        ok: false,
        message: msg('import.m1345', { v0: index + 1 }),
      };
    }
    if (!Number.isFinite(raw.start) || !Number.isFinite(raw.end) || raw.start < 0 || raw.end < raw.start) {
      return { ok: false, message: msg('import.m1346', { v0: index + 1 }) };
    }
    // Optional detail fields are still untrusted input. Reject corruption before
    // rendering or editing can dereference them; never silently discard content.
    if (raw.words !== undefined && (!Array.isArray(raw.words) || !raw.words.every(word =>
      word && typeof word.text === "string" && Number.isFinite(word.start) && Number.isFinite(word.end) &&
      word.start >= 0 && word.end >= word.start &&
      (word.speaker_id === undefined || typeof word.speaker_id === "string") &&
      (word.origins === undefined || (Array.isArray(word.origins) && word.origins.every(origin =>
        origin && typeof origin.model === "string" && typeof origin.segment === "string" &&
        Number.isInteger(origin.from) && Number.isInteger(origin.to) && origin.from >= 0 && origin.to >= origin.from &&
        Number.isFinite(origin.start) && Number.isFinite(origin.end) && origin.start >= 0 && origin.end >= origin.start)))))) {
      return { ok: false, message: msg('import.m1347', { v0: index + 1 }) };
    }
    if (raw.annotations !== undefined && (!Array.isArray(raw.annotations) || !raw.annotations.every(note =>
      note && typeof note.id === "string" && typeof note.text === "string" && typeof note.createdAt === "string"))) {
      return { ok: false, message: msg('import.m1348', { v0: index + 1 }) };
    }
    let id = typeof raw.id === "string" && raw.id ? raw.id : "";
    if (!id || usedIds.has(id)) {
      missingId += 1;
      id = `seg_${idStamp}_${index + 1}`;
      while (usedIds.has(id)) id += "_";
    }
    usedIds.add(id);
    let speakerId = typeof raw.speaker_id === "string" && raw.speaker_id ? raw.speaker_id : "";
    if (!speakerId) {
      missingSpeaker += 1;
      speakerId = UNLABELED_SPEAKER_ID;
    }
    const text = typeof raw.text === "string" ? raw.text : "";
    if (typeof raw.text !== "string") missingText += 1;
    segments.push({
      id,
      speaker_id: speakerId,
      start: raw.start,
      end: raw.end,
      text,
      ...(raw.words ? { words: raw.words } : {}),
      ...(Array.isArray(raw.mergedFrom) && raw.mergedFrom.every(id => typeof id === "string" && id) ? { mergedFrom: [...new Set(raw.mergedFrom)] } : {}),
      ...(raw.annotations ? { annotations: raw.annotations } : {}),
    });
  }

  const usedOrder: string[] = [];
  for (const segment of segments) {
    if (!usedOrder.includes(segment.speaker_id)) usedOrder.push(segment.speaker_id);
  }
  const provided = Array.isArray(candidate.speakers)
    ? candidate.speakers.filter(
        (speaker): speaker is Speaker =>
          Boolean(speaker) && typeof speaker.id === "string" && typeof speaker.name === "string",
      )
    : [];
  const speakers: Speaker[] = [...provided].map((speaker, index) => {
    // 把旧版本「Speaker N」英文模板名统一规范为「说话人 N」。
    if (/^Speaker (\d+)$/.test(speaker.name.trim())) {
      return { ...speaker, name: `说话人 ${index + 1}` };
    }
    return speaker;
  });
  const known = new Set(speakers.map((speaker) => speaker.id));
  let addedSpeakers = 0;
  for (const id of usedOrder) {
    if (known.has(id)) continue;
    speakers.push({ id, name: id === UNLABELED_SPEAKER_ID ? "未标注" : `说话人 ${speakers.length + 1}` });
    known.add(id);
    addedSpeakers += 1;
  }

  if (!Array.isArray(candidate.speakers)) {
    repairs.push(msg('import.m1352', { v0: speakers.length }));
  } else if (addedSpeakers > 0) {
    repairs.push(msg('import.m1353', { v0: addedSpeakers }));
  }
  if (missingSpeaker > 0) {
    repairs.push(msg('import.m1354', { v0: missingSpeaker }));
  }
  if (missingId > 0) repairs.push(msg('import.m1355', { v0: missingId }));
  if (missingText > 0) repairs.push(msg('import.m1356', { v0: missingText }));

  // 识别导出工具的引擎：顶层 engine 字段（若导出方写了）。本应用导出 JSON 时会带上它，
  // 其它工具没写就保持 undefined，由导入方回退为「外部导入」。
  const rawEngine = (value as { engine?: unknown }).engine;
  const engine = typeof rawEngine === "string" && rawEngine.trim() ? rawEngine.trim() : undefined;

  return {
    ok: true,
    repairs,
    engine,
    transcript: {
      ...(candidate.timeAligned === false ? { timeAligned: false } : {}),
      audio: { filename: audioName, duration: candidate.audio?.duration ?? 0 },
      speakers,
      segments,
    },
  };
}
