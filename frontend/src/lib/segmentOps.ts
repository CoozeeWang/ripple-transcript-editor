import { sliceTimestampWords } from "./timestampSlices";
import type { Segment, Word } from "../types";
import { alignTimestampWords, reanchorCharacters, reanchorRanges, timeForCharacter } from "./transcriptOps";

// 段落级操作（拆分 / 合并）的纯函数。与转录无关的状态（选中片段、undo 历史等）
// 由调用方（useEditor）处理，这里只保证 segments 数组的结构正确性，便于单元测试。

export function joinParagraphs(first: string, second: string): string {
  return [first.trimEnd(), second.trimStart()].filter(Boolean).join("\n");
}

function mergeWords(current: Segment, next: Segment, mergedText: string): Word[] | undefined {
  if (!current.words?.length && !next.words?.length) return undefined;
  const sliceWords = (segment: Segment, start: number, end: number): Word[] => {
    // 没有词时间戳的正文也占据字符位置，但不伪造有效的播放时间窗。
    const words = segment.words?.length ? alignTimestampWords(segment.words, segment.text) : [
      { text: segment.text, start: segment.start, end: segment.start },
    ];
    let offset = 0;
    return words.flatMap(word => {
      const from = Math.max(0, start - offset);
      const to = Math.min(word.text.length, end - offset);
      offset += word.text.length;
      return to > from ? [{ ...word, text: word.text.slice(from, to) }] : [];
    });
  };
  const leftText = current.text.trimEnd();
  const rightText = next.text.trimStart();
  const words = [
    ...sliceWords(current, 0, leftText.length),
    ...(leftText && rightText ? [{text: "\n", start: current.end, end: current.end, ...(current.words?.some(w=>w.timing)||next.words?.some(w=>w.timing)?{timing:"approximate" as const,origins:[]}: {})}] : []),
    ...sliceWords(next, next.text.length - rightText.length, next.text.length),
  ];
  if (words.map(word => word.text).join("") === mergedText) return words;
  // 已损坏的历史映射不在这里猜测修复，保留原始时间戳供原稿对照恢复。
  return reanchorCharacters([...(current.words ?? []), ...(next.words ?? [])], current.text + next.text, mergedText);
}

/** 删除片段后，仅合并它原来上下相邻、且属于同一说话人的两个片段。 */
export function removeSegmentAndMerge(segments: Segment[], segmentId: string): Segment[] | null {
  const index = segments.findIndex(segment => segment.id === segmentId);
  if (index < 0) return null;
  const previous = segments[index - 1];
  const next = segments[index + 1];
  const remaining = segments.filter(segment => segment.id !== segmentId);
  if (previous && next && previous.speaker_id === next.speaker_id) {
    return mergeSegmentWithNext(remaining, previous.id);
  }
  return remaining;
}

/** 把 segmentId 段与紧随其后的段合并成一段：文本拼接、时间窗取下一段终点、
 * 批注拼接、词级时间戳按合并文本重新锚定；返回新数组（下一段已删除）。
 * 无下一段时返回 null（调用方自行决定是否继续）。 */
export function mergeSegmentWithNext(
  segments: Segment[],
  segmentId: string,
): Segment[] | null {
  const index = segments.findIndex((segment) => segment.id === segmentId);
  const current = segments[index];
  const next = segments[index + 1];
  if (!current || !next) return null;

  return segments
    .map((segment) => {
      if (segment.id !== current.id) return segment;
      const mergedText = joinParagraphs(current.text, next.text);
      return {
        ...segment,
        start: Math.min(current.start, next.start),
        end: Math.max(current.end, next.end),
        mergedFrom: [...new Set([current.id, ...(current.mergedFrom ?? []), next.id, ...(next.mergedFrom ?? [])])],
        text: mergedText,
        highlights: reanchorRanges([...(current.highlights ?? []), ...(next.highlights ?? []).map(h => ({ ...h, start: h.start + current.text.length, end: h.end + current.text.length }))], current.text + next.text, mergedText),
        annotations: [...(current.annotations ?? []), ...(next.annotations ?? [])],
        // 分别保留两侧的绝对时间戳与中间音频间隔；换行不占用有效时间窗。
        words: mergeWords(current, next, mergedText),
      };
    })
    .filter((segment) => segment.id !== next.id);
}

/** 把 segmentId 段拆成两段：前半段保留原 id，后半段使用新 id。
 * 光标位置不合法（0 或超出文本长度）或拆分后任一半为空时返回 null。 */
export function splitSegmentAt(
  segments: Segment[],
  segmentId: string,
  cursorPosition: number,
  currentText: string | undefined,
  newSegmentId: string,
): Segment[] | null {
  const segment = segments.find((item) => item.id === segmentId);
  if (!segment) return null;
  const text = currentText ?? segment.text;
  if (cursorPosition <= 0 || cursorPosition >= text.length) return null;

  const firstText = text.slice(0, cursorPosition).trimEnd();
  const secondText = text.slice(cursorPosition).trimStart();
  if (!firstText || !secondText) return null;

  const splitTime = timeForCharacter(
    currentText ? { ...segment, text: currentText } : segment,
    cursorPosition,
  );
  let firstWords = segment.words;
  let secondWords = segment.words;
  if (segment.words?.length) {
    const words = reanchorCharacters(segment.words,segment.text,text) ?? [];
    firstWords = sliceTimestampWords(words,0,firstText.length);
    secondWords = sliceTimestampWords(words,text.length-secondText.length,text.length);
  }

  const highlights = reanchorRanges(segment.highlights ?? [], segment.text, text);
  const secondOffset = text.length - secondText.length;
  const sliceHighlights = (start: number, end: number) => highlights
    .filter(h => h.end > start && h.start < end)
    .map(h => ({ ...h, start: Math.max(start, h.start) - start, end: Math.min(end, h.end) - start }));

  return segments.flatMap((item) =>
    item.id === segmentId
      ? [
          { ...item, ...(item.start === item.end ? { splitFrom: item.splitFrom ?? item.id } : {}), mergedFrom: undefined, end: splitTime, text: firstText, words: firstWords, highlights: sliceHighlights(0, firstText.length) },
          { ...item, ...(item.start === item.end ? { splitFrom: item.splitFrom ?? item.id } : {}), mergedFrom: undefined, id: newSegmentId, start: splitTime, text: secondText, words: secondWords, highlights: sliceHighlights(secondOffset, text.length) },
        ]
      : [item],
  );
}
