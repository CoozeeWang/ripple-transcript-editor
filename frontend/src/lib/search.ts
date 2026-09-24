import type { Transcript } from "../types";

// 查找替换的纯逻辑（无 DOM、无状态），独立成模块以便单元测试。

export interface Match {
  segmentId: string;
  start: number;
}

/** 在整份转录里找出 query 的所有匹配位置（按段落顺序、段落内按字符位置顺序）。 */
export function findMatches(transcript: Transcript | null | undefined, query: string): Match[] {
  if (!transcript || !query) return [];
  const result: Match[] = [];
  for (const segment of transcript.segments) {
    let start = segment.text.indexOf(query);
    while (start >= 0) {
      result.push({ segmentId: segment.id, start });
      start = segment.text.indexOf(query, start + query.length);
    }
  }
  return result;
}

/** 把 text 中 [index, index+query.length) 的一段替换为 replacement（单处替换）。 */
export function replaceAt(text: string, index: number, query: string, replacement: string): string {
  return `${text.slice(0, index)}${replacement}${text.slice(index + query.length)}`;
}
