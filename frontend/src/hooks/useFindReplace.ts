import { msg } from '../i18n';
import type { ParagraphEditorElement } from "../lib/paragraphEditor";
import { useMemo, useState } from "react";
import type { MutableRefObject } from "react";

import type { Segment, Transcript } from "../types";
import { findMatches, replaceAt } from "../lib/search";
import { reanchorCharacters, reanchorRanges } from "../lib/transcriptOps";

export interface FindReplaceDeps {
  transcript: Transcript | null;
  viewingOriginal: boolean;
  mutateTranscript: (updater: (current: Transcript) => Transcript, groupKey?: string) => void;
  setSelectedSegmentId: (id: string) => void;
  textareaRefs: MutableRefObject<Map<string, ParagraphEditorElement>>;
}

/** 查找与替换的完整状态与操作（Word 风格：默认只有查找，点「替换」才展开）。 */
export function useFindReplace(deps: FindReplaceDeps) {
  const { transcript, viewingOriginal, mutateTranscript, setSelectedSegmentId, textareaRefs } = deps;

  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replaceValue, setReplaceValue] = useState("");
  // 是否展开「替换为」输入框。
  const [showReplace, setShowReplace] = useState(false);
  // 当前定位到的匹配在 matches 数组中的索引；-1 表示尚未定位。
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
  const matches = useMemo(() => findMatches(transcript, findQuery), [transcript, findQuery]);
  const matchCount = matches.length;

  const focusMatch = (segmentId: string, start: number) => {
    setSelectedSegmentId(segmentId);
    // 双层 rAF：替换后文本变化要等 SegmentTextArea 同步 draft 并完成渲染，
    // 单层 rAF 可能读到旧文本，选区落在错误位置（看起来「没有高亮」）。
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (!viewingOriginal) {
          const textarea = textareaRefs.current.get(segmentId);
          textarea?.focus();
          textarea?.setSelectionRange(start, start + findQuery.length);
        }
        document.getElementById(`segment-${segmentId}`)?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      });
    });
  };

  const findNext = () => {
    if (matches.length === 0) return;
    const nextIndex = (currentMatchIndex + 1) % matches.length;
    setCurrentMatchIndex(nextIndex);
    const match = matches[nextIndex];
    focusMatch(match.segmentId, match.start);
  };

  const findPrev = () => {
    if (matches.length === 0) return;
    // 加 length 防 currentMatchIndex=0 时取负；循环到文末。
    const prevIndex = (currentMatchIndex - 1 + matches.length) % matches.length;
    setCurrentMatchIndex(prevIndex);
    const match = matches[prevIndex];
    focusMatch(match.segmentId, match.start);
  };

  const replaceCurrent = (direction: "next" | "prev" = "next") => {
    if (viewingOriginal) return; // 只读模式下不允许替换
    if (!transcript || !findQuery) return;
    // 替换当前定位到的匹配；尚未定位时先定位到第一个。
    const index = currentMatchIndex >= 0 ? currentMatchIndex : 0;
    const match = matches[index];
    if (!match) return;
    const segment = transcript.segments.find((item) => item.id === match.segmentId);
    if (!segment) return;
    const newText = replaceAt(segment.text, match.start, findQuery, replaceValue);
    const update = (current: Transcript): Transcript => ({
      ...current,
      segments: current.segments.map((seg) => {
        if (seg.id !== match.segmentId) return seg;
        const next: Segment = { ...seg, text: newText, highlights: reanchorRanges(seg.highlights ?? [], seg.text, newText) };
        // 文本变化时重新锚定词级时间戳，保持时间戳跟随字符。
        if (seg.words?.length) {
          next.words = reanchorCharacters(seg.words, seg.text, newText, {start:match.start,end:match.start+findQuery.length});
        }
        return next;
      }),
    });
    mutateTranscript(update);
    const nextMatches = findMatches(update(transcript), findQuery);
    // 替换后匹配列表重算：被替换的匹配从数组删除，下一个匹配前移到 index 位置。
    // 文末/文首时循环到另一端（与 findNext/findPrev 行为一致）。
    const oldLen = matches.length;
    let nextIndex: number;
    if (direction === "next") {
      const isLast = index === oldLen - 1;
      nextIndex = isLast ? 0 : index;
    } else {
      const isFirst = index === 0;
      // prev 指向当前匹配的前一个；isFirst 时循环到文末（替换后旧文末前移 = oldLen-2）。
      nextIndex = isFirst ? oldLen - 2 : index - 1;
    }
    if (!nextMatches.length) {
      setCurrentMatchIndex(-1);
      return;
    }
    let idx = Math.max(0, Math.min(nextIndex, nextMatches.length - 1));
    const initialIndex = idx;
    // 保持连续替换的前进边界，避免再次处理本段已替换区域。
    while (nextMatches[idx].segmentId === match.segmentId &&
      nextMatches[idx].start < match.start + replaceValue.length) {
      idx = (idx + 1) % nextMatches.length;
      if (idx === initialIndex) {
        setCurrentMatchIndex(-1);
        return;
      }
    }
    setCurrentMatchIndex(idx);
    focusMatch(nextMatches[idx].segmentId, nextMatches[idx].start);
  };

  const replaceAll = () => {
    if (viewingOriginal) return; // 只读模式下不允许替换
    if (!transcript || !findQuery || matchCount === 0) return;
    if (!window.confirm(msg('useFindReplace.m1115', { v0: matchCount }))) return;
    mutateTranscript((current) => ({
      ...current,
      segments: current.segments.map((segment) => {
        let text=segment.text,words=segment.words;
        const offsets:number[]=[];
        for(let index=text.indexOf(findQuery);index>=0;index=text.indexOf(findQuery,index+findQuery.length))offsets.push(index);
        for(const start of offsets.reverse()){
          const next=replaceAt(text,start,findQuery,replaceValue);
          words=reanchorCharacters(words,text,next,{start,end:start+findQuery.length});text=next;
        }
        return { ...segment, text, words,
          highlights: reanchorRanges(segment.highlights ?? [], segment.text, text),
        };
      }),
    }));
  };

  return {
    findOpen,
    setFindOpen,
    findQuery,
    setFindQuery,
    replaceValue,
    setReplaceValue,
    showReplace,
    setShowReplace,
    currentMatchIndex,
    setCurrentMatchIndex,
    matches,
    matchCount,
    focusMatch,
    findNext,
    findPrev,
    replaceCurrent,
    replaceAll,
  };
}
