import { editSourcedWords } from "./wordOrigins";
import type { Segment, Word } from "../types";

// 转录编辑的核心纯逻辑（时间戳跟随字符、段落拆分、说话人合并等）。
// 全部是无副作用的纯函数，独立成模块以便单元测试，也为拆分 App.tsx 铺路。

// words 是否「可用」：至少有一个词有正宽度（end > start）。
// 讯飞大模型版等接口可能不返回词级起止（wb/we 全 0），此时所有词的窗口都是
// 零宽、落在段开头——按词追时间戳会退化成段级（播放从段开头、高亮不跟随）。
// 判定为不可用时，timeForCharacter / activeWordRange 回退到段内线性插值。
function wordsUsable(words: Word[] | undefined): boolean {
  return Boolean(words?.length && words.some((word) => word.end > word.start));
}

/** Align legacy/malformed word text to the actual transcript without stretching audio time. */
export function alignTimestampWords(words: Word[], text: string): Word[] {
  const source = words.map(word => word.text).join("");
  if (source === text) return words;
  const mapping = mapCharsByDiff(source, text);
  const owners: number[] = [];
  words.forEach((word, index) => {
    for (let i = 0; i < word.text.length; i++) owners.push(index);
  });
  const result: Word[] = [];
  let previousOwner = -2;
  let anchor = words.find(word => word.end > word.start)?.start ?? 0;
  for (let i = 0; i < text.length; i++) {
    const owner = mapping[i] >= 0 ? owners[mapping[i]] : -1;
    const word = owner >= 0 ? words[owner] : undefined;
    if (owner === previousOwner) result[result.length - 1].text += text[i];
    else result.push(word ? { ...word, text: text[i] } : { text: text[i], start: anchor, end: anchor });
    if (word && word.end > word.start) anchor = word.end;
    previousOwner = owner;
  }
  return result;
}

const alignedWordsCache = new WeakMap<Word[], { text: string; words: Word[] }>();
function wordsForText(segment: Segment): Word[] | undefined {
  if (!segment.words?.length) return segment.words;
  const cached = alignedWordsCache.get(segment.words);
  if (cached?.text === segment.text) return cached.words;
  const words = alignTimestampWords(segment.words, segment.text);
  alignedWordsCache.set(segment.words, { text: segment.text, words });
  return words;
}

export function timeForCharacter(segment: Segment, charIndex: number): number {
  const span = Math.max(0, segment.end - segment.start);
  const words = wordsForText(segment);
  const wordCharacters = words?.reduce((total, word) => total + word.text.length, 0) ?? 0;

  if (
    wordsUsable(words) &&
    wordCharacters === segment.text.length &&
    segment.text.length > 0
  ) {
    let consumed = 0;
    let previous: Word | undefined;
    for (const word of words!) {
      const nextBoundary = consumed + word.text.length;
      if (charIndex < nextBoundary) {
        if (word.end <= word.start) {
          return previous?.start ?? words!.find(item => item.end > item.start)?.start ?? segment.start;
        }
        // A position inside a multi-character chunk (text typed next to a
        // timestamped character) is interpolated across that chunk's own window.
        const inner = word.text.length > 0 ? (charIndex - consumed) / word.text.length : 0;
        return word.start + Math.max(0, word.end - word.start) * inner;
      }
      consumed = nextBoundary;
      if (word.end > word.start) previous = word;
    }
    return segment.end;
  }

  const ratio = segment.text.length > 0 ? charIndex / segment.text.length : 0;
  return segment.start + span * Math.min(1, Math.max(0, ratio));
}

// Returns the [start, end) character range being spoken at `time`. Chunks are
// per character, so this follows the audio character by character. Falls back to
// a single interpolated character when there are no usable timestamps.
export function activeWordRange(
  segment: Segment,
  time: number,
): { start: number; end: number } | null {
  const text = segment.text;
  if (!text) return null;
  const words = wordsForText(segment);
  const wordCharacters = words?.reduce((total, word) => total + word.text.length, 0) ?? 0;

  if (wordsUsable(words) && wordCharacters === text.length) {
    let consumed = 0;
    let previous: { start: number; end: number } | null = null;
    for (const word of words!) {
      const range = { start: consumed, end: consumed + word.text.length };
      if (word.end > word.start && word.text.length > 0) {
        if (time >= word.start && time < word.end) return range;
        if (word.end <= time) previous = range;
      }
      consumed += word.text.length;
    }
    // 时间戳之间的空档保留之前的高亮，不跳到全文末尾；首词之前不预先高亮。
    return previous;
  }

  const span = Math.max(0, segment.end - segment.start);
  const ratio = span > 0 ? Math.max(0, Math.min(1, (time - segment.start) / span)) : 0;
  const index = Math.max(0, Math.min(text.length - 1, Math.floor(ratio * text.length)));
  return { start: index, end: index + 1 };
}

export function joinText(first: string, second: string): string {
  const needsSpace = /[A-Za-z0-9]$/.test(first.trimEnd()) && /^[A-Za-z0-9]/.test(second.trimStart());
  return `${first.trimEnd()}${needsSpace ? " " : ""}${second.trimStart()}`;
}

// Map every character of newText back to the character of oldText it came from,
// or -1 when it was typed and has no counterpart in the recording.
//
// A timestamp belongs to the moment a character was spoken, not to its position
// in the string, so deleting earlier characters must not move the timestamps of
// the characters that follow. Recovering that identity is a diff: the common
// prefix and suffix are matched first, which settles ordinary typing instantly.
// When one event changes the text in several scattered places — a large paste or
// a replace spanning the segment — the changed middle is aligned with an LCS so
// that untouched regions keep their original characters instead of being
// interpolated from whatever happens to sit next to them.
export function mapCharsByDiff(oldText: string, newText: string): Int32Array {
  const oldLen = oldText.length;
  const newLen = newText.length;
  const mapping = new Int32Array(newLen).fill(-1);
  const minLen = Math.min(oldLen, newLen);

  let prefix = 0;
  while (prefix < minLen && oldText[prefix] === newText[prefix]) {
    mapping[prefix] = prefix;
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    oldText[oldLen - 1 - suffix] === newText[newLen - 1 - suffix]
  ) {
    mapping[newLen - 1 - suffix] = oldLen - 1 - suffix;
    suffix += 1;
  }

  const oldMid = oldText.slice(prefix, oldLen - suffix);
  const newMid = newText.slice(prefix, newLen - suffix);
  if (oldMid.length > 0 && newMid.length > 0) {
    const middle = lcsAlignment(oldMid, newMid);
    for (let i = 0; i < newMid.length; i++) {
      if (middle[i] >= 0) mapping[prefix + i] = prefix + middle[i];
    }
  }
  return mapping;
}

// Exact longest-common-subsequence alignment. Large regions use linear-space
// rows instead of dropping all interior matches when a matrix exceeds the budget.
export function lcsAlignment(a: string, b: string): Int32Array {
  const n = a.length;
  const m = b.length;
  const result = new Int32Array(m).fill(-1);
  if (n * m > 250000) {
    // Hirschberg: exact character alignment without a quadratic-size matrix.
    function scores(a0: number, a1: number, b0: number, b1: number, reverse: boolean) {
      const width = b1 - b0;
      let prev = new Int32Array(width + 1), next = new Int32Array(width + 1);
      for (let i = 0; i < a1 - a0; i++) {
        next[0] = 0;
        for (let j = 1; j <= width; j++) {
          next[j] = a[reverse ? a1 - 1 - i : a0 + i] === b[reverse ? b1 - j : b0 + j - 1]
            ? prev[j - 1] + 1 : Math.max(prev[j], next[j - 1]);
        }
        [prev, next] = [next, prev];
      }
      return prev;
    }
    function align(a0: number, a1: number, b0: number, b1: number): void {
      if (a0 === a1 || b0 === b1) return;
      if (a1 - a0 === 1) {
        for (let j = b0; j < b1; j++) if (a[a0] === b[j]) { result[j] = a0; break; }
        return;
      }
      const mid = (a0 + a1) >>> 1;
      const left = scores(a0, mid, b0, b1, false), right = scores(mid, a1, b0, b1, true);
      let split = 0, best = -1;
      for (let j = 0; j <= b1 - b0; j++) {
        const score = left[j] + right[b1 - b0 - j];
        if (score > best) { best = score; split = j; }
      }
      align(a0, mid, b0, b0 + split);
      align(mid, a1, b0 + split, b1);
    }
    align(0, n, 0, m);
    return result;
  }
  const width = m + 1;
  const lengths = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lengths[i * width + j] =
        a[i] === b[j]
          ? lengths[(i + 1) * width + (j + 1)] + 1
          : Math.max(lengths[(i + 1) * width + j], lengths[i * width + (j + 1)]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      result[j] = i;
      i += 1;
      j += 1;
    } else if (lengths[(i + 1) * width + j] >= lengths[i * width + (j + 1)]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return result;
}

// Re-anchor per-character timestamps onto edited text.
//
// A timestamp belongs to the moment a character was spoken, so it has to follow
// the character: deleting text earlier in the segment leaves every surviving
// character's timestamp untouched. mapCharsByDiff works out which characters
// survived, and each one keeps the timestamp of the character it came from —
// which is exactly why edits stop drifting. Typed characters have no audio of
// their own, so they inherit the timestamp of the nearest surviving neighbour,
// and characters that were deleted simply leave the timeline.
//
// Legacy mismatches are aligned first; existing timestamps stay attached to
// matching text, while missing text gets zero-duration placeholders.
export type TextEdit = {before:string; text:string; start:number; end:number};
export function reanchorTextEdits(words:Word[]|undefined,before:string,text:string,edits:TextEdit[]=[]):Word[]|undefined {
  let current=before,result=words;
  for(const edit of edits){
    if(edit.before!==current)return reanchorCharacters(words,before,text);
    result=reanchorCharacters(result,current,edit.text,edit);
    current=edit.text;
  }
  return current===text?result:reanchorCharacters(words,before,text);
}

export function reanchorCharacters(
  chunks: Word[] | undefined,
  oldText: string,
  newText: string,
  edit?: Pick<TextEdit,"start"|"end">,
): Word[] | undefined {
  if (!chunks?.length) return undefined;
  if (newText.length === 0) return [];
  if (chunks.map(word => word.text).join("") !== oldText) {
    chunks = alignTimestampWords(chunks, oldText);
  }

  if (chunks.some(word=>word.timing || word.origins)) {
    if (oldText === newText) return chunks;
    const mapping=Array.from(mapCharsByDiff(oldText,newText));
    let positioned=false;
    if(edit && edit.start>=0 && edit.end>=edit.start && edit.end<=oldText.length){
      const added=newText.length-(oldText.length-(edit.end-edit.start));
      if(added>=0 && oldText.slice(0,edit.start)===newText.slice(0,edit.start) && oldText.slice(edit.end)===newText.slice(edit.start+added)){
        positioned=true;
        for(let i=0;i<newText.length;i++)mapping[i]=i<edit.start?i:i<edit.start+added?-1:i-added+edit.end-edit.start;
      }
    }
    const result=editSourcedWords(chunks,oldText,newText,mapping);
    if(!positioned && newText && oldText.indexOf(newText)!==oldText.lastIndexOf(newText))
      return result.map(word=>({...word,origins:[],timing:"unresolved"}));
    return result;
  }

  // Character range of each existing chunk within oldText.
  const oldRanges: { s: number; e: number; word: Word }[] = [];
  let cursor = 0;
  for (const word of chunks) {
    const s = cursor;
    cursor += word.text.length;
    oldRanges.push({ s, e: cursor, word });
  }
  if (cursor !== oldText.length) return chunks;

  const mapping = mapCharsByDiff(oldText, newText);
  const charToChunk = new Int32Array(oldText.length).fill(-1);
  for (let k = 0; k < oldRanges.length; k++) {
    for (let c = oldRanges[k].s; c < oldRanges[k].e; c++) charToChunk[c] = k;
  }
  const owner = new Int32Array(newText.length).fill(-1);
  for (let i = 0; i < newText.length; i++) {
    const oldIndex = mapping[i];
    if (oldIndex >= 0) owner[i] = charToChunk[oldIndex];
  }

  // Typed characters have no counterpart: attach them to the nearest neighbour.
  let previous = -1;
  for (let i = 0; i < owner.length; i++) {
    if (owner[i] === -1 && previous !== -1) owner[i] = previous;
    else if (owner[i] !== -1) previous = owner[i];
  }
  let following = -1;
  for (let i = owner.length - 1; i >= 0; i--) {
    if (owner[i] === -1 && following !== -1) owner[i] = following;
    else if (owner[i] !== -1) following = owner[i];
  }

  const result: Word[] = [];
  for (let k = 0; k < oldRanges.length; k++) {
    let text = "";
    for (let i = 0; i < owner.length; i++) {
      if (owner[i] === k) text += newText[i];
    }
    if (text.length === 0) continue; // all of its characters were deleted
    const original = oldRanges[k].word;
    const reanchored: Word = { text, start: original.start, end: original.end };
    if (original.speaker_id) reanchored.speaker_id = original.speaker_id;
    result.push(reanchored);
  }

  // Anything that would break the exact-partition invariant is refused: keep
  // the previous chunks rather than writing something inconsistent.
  if (!result.length) return chunks;
  if (result.reduce((sum, word) => sum + word.text.length, 0) !== newText.length) {
    return chunks;
  }
  return result;
}

// Re-anchor highlight ranges onto edited text.
//
// A highlight is anchored to the characters it covers, not to a position in the
// string: it spans whatever those characters became. So the new range is just
// the span from the first to the last character of the old range that survived
// the edit. That single rule produces the behaviour you would expect — typing
// inside a highlight widens it, deleting inside it shrinks it, deleting all of
// it drops the highlight — without a table of special cases.
//
// Typed characters have no counterpart in the old text, so they only fall inside
// a highlight when they land between two of its surviving characters, which is
// exactly the "typing in the middle of a highlight" case. Ranges whose
// characters were all deleted are dropped rather than collapsed to a caret, and
// any extra fields (id) are carried over untouched.
export function reanchorRanges<T extends { start: number; end: number }>(
  ranges: readonly T[],
  oldText: string,
  newText: string,
): T[] {
  if (ranges.length === 0) return [];
  if (newText.length === 0) return [];
  if (oldText === newText) return ranges.map((range) => ({ ...range }));

  // mapCharsByDiff maps new → old; invert it to ask where each old character went.
  const mapping = mapCharsByDiff(oldText, newText);
  const oldToNew = new Int32Array(oldText.length).fill(-1);
  for (let i = 0; i < mapping.length; i += 1) {
    const oldIndex = mapping[i];
    if (oldIndex >= 0 && oldToNew[oldIndex] === -1) oldToNew[oldIndex] = i;
  }

  const result: T[] = [];
  for (const range of ranges) {
    const from = Math.max(0, Math.min(range.start, oldText.length));
    const to = Math.max(from, Math.min(range.end, oldText.length));
    let first = -1;
    let last = -1;
    for (let c = from; c < to; c += 1) {
      const mapped = oldToNew[c];
      if (mapped < 0) continue;
      if (first === -1 || mapped < first) first = mapped;
      if (mapped > last) last = mapped;
    }
    if (first === -1) continue; // every character it covered is gone
    result.push({ ...range, start: first, end: last + 1 });
  }
  return result;
}
