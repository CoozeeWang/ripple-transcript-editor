import type { Segment, Word } from "../types";
import { alignTimestampWords } from "./transcriptOps";

/** Slice by character position, never by matching repeated text. Partial word
 * windows use the same linear interpolation as timeForCharacter. */
export function sliceTimestampWords(words: Word[], start: number, end: number): Word[] {
  let offset = 0;
  return words.flatMap(word => {
    const from = Math.max(0, start - offset), to = Math.min(word.text.length, end - offset);
    offset += word.text.length;
    if (to <= from) return [];
    const span = word.end - word.start;
    return [{...word, text:word.text.slice(from,to),
      start:word.start + span * from / word.text.length,
      end:word.start + span * to / word.text.length}];
  });
}

export function segmentTimestampWords(segment: Segment): Word[] {
  return segment.words?.length ? alignTimestampWords(segment.words,segment.text) :
    [{text:segment.text,start:segment.start,end:segment.start}];
}

export function joinedTimestampWords(segments: Segment[]): Word[] {
  if (!segments.length) return [];
  let result = segmentTimestampWords(segments[0]);
  let text = segments[0].text;
  for (const segment of segments.slice(1)) {
    const left = text.trimEnd(), right = segment.text.trimStart();
    result = sliceTimestampWords(result,0,left.length);
    if (left && right) {
      const anchor = result.at(-1)?.end ?? segment.start;
      result.push({text:"\n",start:anchor,end:anchor,...(segments.some(s=>s.words?.some(w=>w.timing))?{timing:"approximate" as const,origins:[]}: {})});
    }
    result.push(...sliceTimestampWords(segmentTimestampWords(segment),segment.text.length-right.length,segment.text.length));
    text = [left,right].filter(Boolean).join("\n");
  }
  return result;
}
