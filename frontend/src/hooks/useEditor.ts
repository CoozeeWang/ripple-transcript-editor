import { msg } from '../i18n';
import type { ParagraphEditorElement } from "../lib/paragraphEditor";
import { useCallback, useRef, useState } from "react";
import type { Dispatch, KeyboardEvent as ReactKeyboardEvent, SetStateAction } from "react";

import type { InterviewDraft, InterviewMetadata, Segment, Speaker, Transcript } from "../types";
import { useDismissable } from "../useDismissable";
import { reanchorTextEdits, reanchorRanges, type TextEdit } from "../lib/transcriptOps";
import { removeSegmentAndMerge, mergeSegmentWithNext, splitSegmentAt } from "../lib/segmentOps";
import { nextSpeakerColorIndex, SPEAKER_PALETTE } from "../lib/speakers";
import { isHighlightShortcut, mergeHighlights, newHighlightId } from "../lib/highlights";

/** 编辑器跨领域依赖：本 hook 只拥有编辑操作与合并确认弹窗，
 *  transcript 核心、选中/活跃片段、隐藏说话人、textarea 引用等共享状态
 *  通过回调注入解耦（与 useFolder/useVersions 同一模式）。 */
export interface UseEditorDeps {
  transcript: Transcript | null;
  mutateTranscript: (
    updater: (current: Transcript) => Transcript,
    groupKey?: string,
  ) => void;
  metadata: InterviewMetadata | null;
  setMetadata: Dispatch<SetStateAction<InterviewMetadata | null>>;
  setSelectedSegmentId: Dispatch<SetStateAction<string>>;
  setActiveSegmentId: Dispatch<SetStateAction<string>>;
  setHiddenSpeakerIds: Dispatch<SetStateAction<Set<string>>>;
  textareaRefs: { current: Map<string, ParagraphEditorElement> };
  editingRef: { current: boolean };
  // 查找/替换域（避免与 useFindReplace 循环依赖，由 App 注入）。
  findOpen: boolean;
  showReplace: boolean;
  setShowReplace: (v: boolean) => void;
  replaceCurrent: () => void;
  findNext: () => void;
}

/** 合并说话人的确认对话框状态：{ 源说话人, 目标说话人, 源名, 目标名 }。
 *  trigger 区分触发来源：rename=重命名撞名自动提示，merge=用户主动点「合并到…」。 */
export interface MergePrompt {
  sourceId: string;
  targetId: string;
  sourceName: string;
  targetName: string;
  trigger: "rename" | "merge";
}

export function useEditor(deps: UseEditorDeps) {
  const {
    transcript,
    mutateTranscript,
    metadata,
    setMetadata,
    setSelectedSegmentId,
    setActiveSegmentId,
    setHiddenSpeakerIds,
    textareaRefs,
    editingRef,
    findOpen,
    showReplace,
    setShowReplace,
    replaceCurrent,
    findNext,
  } = deps;

  // 合并说话人的确认对话框状态。
  const [mergePrompt, setMergePrompt] = useState<MergePrompt | null>(null);
  const mergeDialogRef = useRef<HTMLDivElement>(null);
  useDismissable(mergeDialogRef, !!mergePrompt, () => setMergePrompt(null));
  // 说话人卡片上「合并到…」小菜单：mergeMenuFor = 正在展开菜单的说话人 id。
  const [mergeMenuFor, setMergeMenuFor] = useState<string | null>(null);
  const mergeMenuRef = useRef<HTMLDivElement>(null);
  useDismissable(mergeMenuRef, !!mergeMenuFor, () => setMergeMenuFor(null));

  const updateSegment = (segmentId: string, changes: Partial<Segment>, groupKey?: string, edits?: TextEdit[]) => {
    mutateTranscript(
      (current) => ({
        ...current,
        lastEditedSegmentId: segmentId,
        segments: current.segments.map((segment) => {
          if (segment.id !== segmentId) return segment;
          const next: Segment = { ...segment, ...changes };
          // Preserve original audio coordinates through manual edits.
          if (changes.text !== undefined && segment.words?.length) {
            next.words = reanchorTextEdits(segment.words, segment.text, changes.text, edits);
          }
          // 高亮跟着它覆盖的那些字符走：改字后重锚，内部打字会外扩、删除会收缩，
          // 覆盖的字符全删光则该处高亮自己消失（reanchorRanges 会丢掉它）。
          if (changes.text !== undefined && segment.highlights?.length) {
            next.highlights = reanchorRanges(segment.highlights, segment.text, changes.text);
          }
          // 改派段级说话人时，同步更新该段所有词的说话人，保持 word/segment 一致。
          // 单段内 word 共享同一说话人，因此全段词都应跟随新的段级说话人。
          if (changes.speaker_id !== undefined && next.words?.length) {
            next.words = next.words.map((word) => ({ ...word, speaker_id: changes.speaker_id }));
          }
          return next;
        }),
      }),
      groupKey,
    );
  };

  const toggleHideSpeaker = (id: string) => {
    setHiddenSpeakerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 合并 source 说话人进 target：片段与词改派、删除源；源若被隐藏则把隐藏状态迁移到 target。
  // 合并时给所有保留说话人补齐 colorIndex（沿用当前位置色），保证合并后整体配色不重排。
  const mergeSpeaker = (sourceId: string, targetId: string) => {
    if (sourceId === targetId || !transcript) return;
    setHiddenSpeakerIds((prev) => {
      if (!prev.has(sourceId)) return prev;
      const next = new Set(prev);
      next.delete(sourceId);
      next.add(targetId);
      return next;
    });
    mutateTranscript((current) => ({
      ...current,
      speakers: current.speakers
        .map((speaker, index) => ({ ...speaker, colorIndex: speaker.colorIndex ?? index % SPEAKER_PALETTE.length }))
        .filter((speaker) => speaker.id !== sourceId),
      segments: current.segments.map((segment) =>
        segment.speaker_id === sourceId
          ? {
              ...segment,
              speaker_id: targetId,
              words: segment.words?.map((word) => ({ ...word, speaker_id: targetId })),
            }
          : segment,
      ),
    }));
  };

  // 重命名触发的合并确认：把源说话人并入目标。
  const confirmMerge = () => {
    if (mergePrompt) mergeSpeaker(mergePrompt.sourceId, mergePrompt.targetId);
    setMergePrompt(null);
  };

  // 新建一个说话人（可选：直接指派给某段）。默认名「说话人 N」，之后可在左侧面板改名。
  const addSpeaker = (assignSegmentId?: string) => {
    if (!transcript) return;
    const id = `spk_${Date.now().toString(36)}${Math.floor(Math.random() * 0xffff).toString(36)}`;
    mutateTranscript((current) => {
      const name = `说话人 ${current.speakers.length + 1}`;
      const speaker: Speaker = { id, name, colorIndex: nextSpeakerColorIndex(current.speakers) };
      const segments = assignSegmentId
        ? current.segments.map((segment) =>
            segment.id === assignSegmentId
              ? {
                  ...segment,
                  speaker_id: id,
                  words: segment.words?.map((word) => ({ ...word, speaker_id: id })),
                }
              : segment,
          )
        : current.segments;
      return { ...current, speakers: [...current.speakers, speaker], segments };
    }, `add-speaker:${id}`);
  };

  // 检测是否匹配已知的英文默认模板（早期版本的导入数据）。
  const isEnglishSpeakerTemplate = (name: string): RegExpMatchArray | null =>
    /^Speaker (\d+)$/.exec(name.trim());

  // 是否有需要规范化的英文模板 speaker。
  const hasEnglishSpeakerTemplate = transcript
    ? transcript.speakers.some((s) => isEnglishSpeakerTemplate(s.name) !== null)
    : false;

  // 批量把英文模板 speaker 改成中文默认名「说话人 N」；仅改 name，保留 id 与颜色槽位。
  const normalizeEnglishSpeakerTemplates = () => {
    if (!transcript) return;
    mutateTranscript((current) => ({
      ...current,
      speakers: current.speakers.map((speaker, index) => {
        const m = isEnglishSpeakerTemplate(speaker.name);
        return m ? { ...speaker, name: `说话人 ${index + 1}` } : speaker;
      }),
    }), "normalize-speaker-templates");
  };

  // 删除一个说话人：仅当没有任何 segment 分配给它时才允许（先弹窗确认）；
  // 若已有段在用，提示用户先改派或合并，避免留下悬空 speaker_id。
  const deleteSpeaker = (speakerId: string) => {
    if (!transcript) return;
    const speaker = transcript.speakers.find((s) => s.id === speakerId);
    if (!speaker) return;
    const segmentCount = transcript.segments.filter((s) => s.speaker_id === speakerId).length;
    if (segmentCount > 0) {
      window.alert(
        msg('useEditor.m1112', { v0: speaker.name, v1: segmentCount, v2: speaker.name }),
      );
      return;
    }
    if (!window.confirm(msg('useEditor.m1113', { v0: speaker.name }))) return;
    setHiddenSpeakerIds((prev) => {
      const next = new Set(prev);
      next.delete(speakerId);
      return next;
    });
    mutateTranscript(
      (current) => ({
        ...current,
        speakers: current.speakers.filter((s) => s.id !== speakerId),
      }),
      `delete-speaker:${speakerId}`,
    );
  };

  const addAnnotation = (segmentId: string, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    mutateTranscript(
      (current) => ({
        ...current,
        segments: current.segments.map((segment) =>
          segment.id === segmentId
            ? {
                ...segment,
                annotations: [
                  ...(segment.annotations ?? []),
                  {
                    id:
                      typeof crypto !== "undefined" && "randomUUID" in crypto
                        ? crypto.randomUUID()
                        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                    text: trimmed,
                    createdAt: new Date().toISOString(),
                  },
                ],
              }
            : segment,
        ),
      }),
      `annotation-add:${segmentId}`,
    );
  };

  const updateAnnotation = (segmentId: string, annotationId: string, text: string) => {
    mutateTranscript(
      (current) => ({
        ...current,
        segments: current.segments.map((segment) =>
          segment.id === segmentId
            ? {
                ...segment,
                annotations: (segment.annotations ?? []).map((annotation) =>
                  annotation.id === annotationId ? { ...annotation, text } : annotation,
                ),
              }
            : segment,
        ),
      }),
      `annotation-edit:${segmentId}:${annotationId}`,
    );
  };

  const deleteAnnotation = (segmentId: string, annotationId: string) => {
    mutateTranscript(
      (current) => ({
        ...current,
        segments: current.segments.map((segment) =>
          segment.id === segmentId
            ? {
                ...segment,
                annotations: (segment.annotations ?? []).filter(
                  (annotation) => annotation.id !== annotationId,
                ),
              }
            : segment,
        ),
      }),
      `annotation-del:${segmentId}:${annotationId}`,
    );
  };

  // 高亮是编辑辅助记号：选中文字按快捷键加上，再按一次取消。
  //
  // 判断与写入都放在 updater 内部完成，因为防抖窗口内 draft 与 transcript 并
  // 不同步——外面闭包里的 transcript 可能是旧文本，用它算出的重叠关系会错位。
  // mutateTranscript 的 updater 拿到的是最新状态，所以整段逻辑都写在这里面。
  const toggleHighlight = (segmentId: string, start: number, end: number) => {
    const from = Math.min(start, end);
    const to = Math.max(start, end);
    if (to <= from) return;
    mutateTranscript(
      (current) => ({
        ...current,
        segments: current.segments.map((segment) => {
          if (segment.id !== segmentId) return segment;
          const existing = segment.highlights ?? [];
          const overlapping = existing.filter((range) => range.start < to && range.end > from);
          // 压到已有高亮 = 取消：删掉所有与本次选区相交的那几条。
          if (overlapping.length > 0) {
            const drop = new Set(overlapping.map((range) => range.id));
            return { ...segment, highlights: existing.filter((range) => !drop.has(range.id)) };
          }
          return {
            ...segment,
            highlights: mergeHighlights(existing, {
              id: newHighlightId(),
              start: from,
              end: to,
            }),
          };
        }),
      }),
      `highlight-toggle:${segmentId}`,
    );
  };

  const removeHighlight = (segmentId: string, highlightId: string) => {
    mutateTranscript(
      (current) => ({
        ...current,
        segments: current.segments.map((segment) =>
          segment.id === segmentId
            ? {
                ...segment,
                highlights: (segment.highlights ?? []).filter((range) => range.id !== highlightId),
              }
            : segment,
        ),
      }),
      `highlight-del:${segmentId}:${highlightId}`,
    );
  };

  const removeSegment = (segmentId: string) => {
    if (!transcript) return;
    const index = transcript.segments.findIndex((segment) => segment.id === segmentId);
    if (index < 0) return;
    const prev = transcript.segments[index - 1];
    const next = transcript.segments[index + 1];

    const mergeNeighbors = prev && next && prev.speaker_id === next.speaker_id;
    const adjacentSegment = mergeNeighbors ? prev : next ?? prev;
    // 删除和自动合并放在同一个历史操作中，撤销一次即可恢复全部片段。
    // 从最新状态计算，保留邻段刚提交的草稿、高亮、批注和时间戳。
    mutateTranscript((current) => {
      const segments = removeSegmentAndMerge(current.segments, segmentId);
      return segments ? { ...current, segments } : current;
    });
    editingRef.current = false;
    setSelectedSegmentId(adjacentSegment?.id ?? "");
    setActiveSegmentId(activeId =>
      activeId === segmentId || (mergeNeighbors && activeId === next.id) ? "" : activeId,
    );
  };

  const splitSegment = (segmentId: string, cursorPosition: number, currentText?: string) => {
    if (!transcript) return;
    // 预检（与原来一致）：避免对非法光标也做状态变更（选中不存在的段）。
    const segment = transcript.segments.find((item) => item.id === segmentId);
    if (!segment) return;
    const text = currentText ?? segment.text;
    if (cursorPosition <= 0 || cursorPosition >= text.length) return;
    const firstText = text.slice(0, cursorPosition).trimEnd();
    const secondText = text.slice(cursorPosition).trimStart();
    if (!firstText || !secondText) return;

    const newSegmentId = `seg_split_${crypto.randomUUID()}`;
    mutateTranscript((current) => {
      const segments = splitSegmentAt(
        current.segments,
        segmentId,
        cursorPosition,
        currentText,
        newSegmentId,
      );
      if (!segments) return current;
      return { ...current, segments };
    });
    setSelectedSegmentId(newSegmentId);
    window.requestAnimationFrame(() => textareaRefs.current.get(newSegmentId)?.focus());
  };

  const mergeWithNext = (segmentId: string) => {
    if (!transcript) return;
    const index = transcript.segments.findIndex((segment) => segment.id === segmentId);
    const current = transcript.segments[index];
    const next = transcript.segments[index + 1];
    if (!current || !next) return;
    if (
      current.speaker_id !== next.speaker_id &&
      !window.confirm(msg('useEditor.m1114'))
    ) {
      return;
    }

    // 基于最新 value.segments 计算（updater 内）：current/next 不再取渲染闭包，
    // 避免「闭包旧数据 + 最新状态」不同步时把用户刚提交的改动覆盖成旧拼接结果。
    mutateTranscript((value) => {
      const segments = mergeSegmentWithNext(value.segments, segmentId);
      if (!segments) return value;
      return { ...value, segments };
    });
    setSelectedSegmentId(current.id);
  };

  const patchMetadata = useCallback(
    async (patch: Partial<InterviewDraft>) => {
      if (!metadata) return;
      setMetadata({ ...metadata, ...patch });
    },
    [metadata, setMetadata],
  );

  const handleEditorKeydown = (
    event: ReactKeyboardEvent<ParagraphEditorElement>,
    segmentId: string,
  ) => {
    // 查找模式优先：回车 = 下一个匹配，Cmd/Ctrl+回车 = 替换当前匹配。
    // 否则 findNext 会把焦点移到 textarea 并选中匹配词，用户再按回车会被浏览器
    // 默认的「选中文本替换成换行」误删匹配词。
    if (findOpen && event.key === "Enter") {
      event.preventDefault();
      if (event.metaKey || event.ctrlKey) {
        if (showReplace) replaceCurrent();
        else {
          setShowReplace(true);
          window.requestAnimationFrame(() => document.getElementById("replace-input")?.focus());
        }
      } else {
        findNext();
      }
      return;
    }
    // 高亮选区，再按一次取消。快捷键组合由 lib/highlights 共享，
    // 因为 textarea 要先用同一个判断把草稿提交上去。
    if (isHighlightShortcut(event)) {
      event.preventDefault();
      const textarea = event.currentTarget;
      toggleHighlight(segmentId, textarea.selectionStart, textarea.selectionEnd);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      splitSegment(segmentId, event.currentTarget.selectionStart, event.currentTarget.value);
      return;
    }
    // ⌘↓ / Ctrl+↓ = 合并下一段（在 textarea 里聚焦时）。
    if ((event.metaKey || event.ctrlKey) && event.key === "ArrowDown") {
      event.preventDefault();
      mergeWithNext(segmentId);
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const textarea = event.currentTarget;
      const start = textarea.selectionStart, end = textarea.selectionEnd;
      const collapsed = start === end;
      const atVeryTop = start === 0;
      const atVeryBottom = event.key === "ArrowDown" && start === textarea.value.length;
      const shouldJump =
        collapsed &&
        ((event.key === "ArrowUp" && atVeryTop) ||
          (event.key === "ArrowDown" && atVeryBottom));
      if (!shouldJump) return;

      event.preventDefault();
      const index = transcript?.segments.findIndex((segment) => segment.id === segmentId) ?? -1;
      const delta = event.key === "ArrowUp" ? -1 : 1;
      const next = transcript?.segments[index + delta];
      if (!next) return;
      setSelectedSegmentId(next.id);
      window.requestAnimationFrame(() => {
        const target = textareaRefs.current.get(next.id);
        if (target) {
          const caret = event.key === "ArrowDown" ? 0 : target.value.length;
          target.focus();
          target.setSelectionRange(caret, caret);
        }
        document.getElementById(`segment-${next.id}`)?.scrollIntoView({ block: "center" });
      });
      return;
    }
    if (event.key === " ") event.stopPropagation();
  };

  return {
    updateSegment,
    toggleHideSpeaker,
    mergeSpeaker,
    confirmMerge,
    addSpeaker,
    hasEnglishSpeakerTemplate,
    normalizeEnglishSpeakerTemplates,
    deleteSpeaker,
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
    toggleHighlight,
    removeHighlight,
    removeSegment,
    splitSegment,
    mergeWithNext,
    patchMetadata,
    handleEditorKeydown,
    mergePrompt,
    setMergePrompt,
    mergeDialogRef,
    mergeMenuFor,
    setMergeMenuFor,
    mergeMenuRef,
  };
}
