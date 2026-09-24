import type { Highlight, Segment, Transcript } from "../types";

// 高亮清单的纯逻辑：合并范围、按片段分组、生成上下文示意。
// 无 React / 存储依赖，便于单元测试。

/** 面板上下文示意：高亮文字前后各带的字符数。 */
export const HIGHLIGHT_CONTEXT_CHARS = 8;

/** 一处高亮的上下文示意，供面板按三段渲染（前 / 高亮 / 后）。 */
export interface HighlightSnippet {
  before: string;
  marked: string;
  after: string;
  /** 前面还有文字被截掉了。 */
  leadingEllipsis: boolean;
  /** 后面还有文字被截掉了。 */
  trailingEllipsis: boolean;
}

/** 一个片段内的所有高亮，按位置排序，附带各自的上下文示意。 */
export interface HighlightGroup {
  segment: Segment;
  /** 片段在 transcript 中的序号（0 起，界面显示时 +1）。 */
  index: number;
  items: { highlight: Highlight; snippet: HighlightSnippet }[];
}

export function newHighlightId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * 高亮快捷键：⌘⇧H / Ctrl+Shift+H。
 *
 * 不用 ⌘H（macOS 是「隐藏应用」），也不用 ⌘⇧M（Chrome 用它切换用户资料）。
 * textarea 与编辑器都要判断这一个组合——前者据此先提交草稿，后者据此执行动作，
 * 所以提取成共享的纯函数，避免两边各写一份而悄悄走偏。
 */
export function isHighlightShortcut(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}): boolean {
  return (event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "h";
}

/** 取高亮范围的上下文示意：前后各 context 个字符，贴边时不画省略号。 */
export function snippetAround(
  text: string,
  range: { start: number; end: number },
  context: number = HIGHLIGHT_CONTEXT_CHARS,
): HighlightSnippet {
  const start = Math.max(0, Math.min(range.start, text.length));
  const end = Math.max(start, Math.min(range.end, text.length));
  const from = Math.max(0, start - context);
  const to = Math.min(text.length, end + context);
  return {
    before: text.slice(from, start),
    marked: text.slice(start, end),
    after: text.slice(end, to),
    leadingEllipsis: from > 0,
    trailingEllipsis: to < text.length,
  };
}

/**
 * 把一处新范围并入已有高亮：重叠或紧邻的合并成一条，避免同一句话被反复
 * 叠加出多条互相覆盖的记录。合并后沿用位置最靠前那条的 id，面板上看到的
 * 始终是「一整条」，删掉就是整条。
 */
export function mergeHighlights(
  existing: readonly Highlight[],
  incoming: Highlight,
): Highlight[] {
  const sorted = [...existing, incoming]
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const merged: Highlight[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      if (range.end > last.end) last.end = range.end;
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}

/** 全文高亮条数（面板计数徽标用）。空范围（start ≥ end）不计数。 */
export function countHighlights(transcript: Transcript | null): number {
  if (!transcript) return 0;
  return transcript.segments.reduce(
    (total, segment) =>
      total + (segment.highlights ?? []).filter((range) => range.end > range.start).length,
    0,
  );
}

/**
 * 按片段分组的高亮清单：跳过隐藏说话人与无高亮的片段，组内按位置排序。
 * 顺序即文档顺序，面板直接照此渲染。
 */
export function collectHighlightGroups(
  transcript: Transcript | null,
  hiddenSpeakerIds?: ReadonlySet<string>,
  context: number = HIGHLIGHT_CONTEXT_CHARS,
): HighlightGroup[] {
  if (!transcript) return [];
  const groups: HighlightGroup[] = [];
  transcript.segments.forEach((segment, index) => {
    if (hiddenSpeakerIds?.has(segment.speaker_id)) return;
    const items = (segment.highlights ?? [])
      .filter((highlight) => highlight.end > highlight.start)
      .sort((a, b) => a.start - b.start)
      .map((highlight) => ({
        highlight,
        snippet: snippetAround(segment.text, highlight, context),
      }));
    if (items.length === 0) return;
    groups.push({ segment, index, items });
  });
  return groups;
}
