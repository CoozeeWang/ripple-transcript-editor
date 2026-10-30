import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { Transcript } from "../types";
import { IS_MAC } from "../lib/format";
import { flushEditorDrafts, isEditorComposing } from "../lib/editorDrafts";

/** 全局键盘快捷键（编辑器操作在输入控件内由各组件自行处理）。
 *  所有动作通过回调注入，本 hook 只负责监听 window keydown 与分发。 */
export interface UseShortcutsDeps {
  visibleSegmentIds?:ReadonlySet<string>;
  disabled?: boolean;
  copySegment?: (id: string) => void;
  addTag?: (id: string) => void;
  nativeTagShortcut?: boolean;
  tagWriteDisabled?: boolean;
  transcript: Transcript | null;
  viewingOriginal: boolean;
  removeSegment: (segmentId: string) => void;
  findOpen: boolean;
  effectiveSelectedSegmentId: string;
  audioUrl: string;
  skipSeconds: number;
  audioRef: { current: HTMLAudioElement | null };
  performUndo: () => void;
  performRedo: () => void;
  setFindOpen: (open: boolean) => void;
  setShowReplace: (open: boolean) => void;
  setExportMenuOpen: Dispatch<SetStateAction<boolean>>;
  togglePlayFromCursor: () => void;
  handleOpenFolder: () => void;
  togglePlayback: () => void;
  seekTo: (time: number, playing?: boolean) => void;
  mergeWithNext: (segmentId: string) => void;
  setSelectedSegmentId: (id: string) => void;
}

export function useShortcuts(deps: UseShortcutsDeps) {
  const {
    disabled = false,
    transcript,
    viewingOriginal,
    removeSegment,
    findOpen,
    effectiveSelectedSegmentId,
    audioUrl,
    skipSeconds,
    audioRef,
    performUndo,
    performRedo,
    setFindOpen,
    setShowReplace,
    setExportMenuOpen,
    togglePlayFromCursor,
    handleOpenFolder,
    togglePlayback,
    seekTo,
    mergeWithNext,
    setSelectedSegmentId,
  } = deps;

  useEffect(() => {
    // Desktop only: browsers own Ctrl/⌘T. Capture just this command so a focused
    // tag input can be refocused without reconstructing its draft.
    const handleTagKeydown = (event: globalThis.KeyboardEvent) => {
      if (!deps.nativeTagShortcut || !deps.addTag || disabled || viewingOriginal || deps.tagWriteDisabled || event.isComposing || event.keyCode === 229 || isEditorComposing()) return;
      if ((event.code !== 'KeyT' && event.key.toLowerCase() !== 't') || event.altKey || event.shiftKey || !(IS_MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)) return;
      if (document.querySelector('[role="dialog"],dialog[open]')) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const editor = target?.closest<HTMLElement>('[data-transcript-editor]');
      const tagInput = target?.closest('.tag-entry input');
      if (!editor && !tagInput && target?.closest('input,textarea,select,[contenteditable]')) return;
      const id = editor?.dataset.segmentId ?? (tagInput?.closest('.segment')?.id.slice('segment-'.length)) ?? effectiveSelectedSegmentId;
      if (!id || !transcript?.segments.some(segment => segment.id === id) || (deps.visibleSegmentIds && !deps.visibleSegmentIds.has(id))) return;
      event.preventDefault(); event.stopPropagation();
      flushEditorDrafts(); deps.addTag(id);
    };
    const handleKeydown = (event: globalThis.KeyboardEvent) => {
      if (disabled) return;
      if (event.isComposing || event.keyCode === 229) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      // 弹窗拥有键盘操作，避免撤销、查找和播放作用到背后的文稿。
      if (target?.closest("[role='dialog'], dialog") || document.querySelector("dialog[open]")) return;
      if (event.code === 'KeyC' && event.shiftKey && !event.altKey &&
        (IS_MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) && deps.copySegment) {
        const editor = target?.closest<HTMLElement>('[data-transcript-editor]');
        if (!editor && target?.closest('input, textarea, select, [contenteditable]')) return;
        const id = editor?.dataset.segmentId ?? effectiveSelectedSegmentId;
        if (!transcript?.segments.some(segment => segment.id === id)) return;
        event.preventDefault();
        if (!event.repeat) deps.copySegment(id);
        return;
      }
      const modifier = event.metaKey || event.ctrlKey;

      if (event.key === "Backspace" && event.shiftKey && !event.altKey &&
        (IS_MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)) {
        const editor = target?.closest<HTMLElement>("[data-transcript-editor]");
        // 批注、说话人名称、查找框与弹窗中的操作不应删除正文片段。
        if (target?.closest("[role='dialog'], dialog") ||
          (!editor && target?.closest("input, textarea, select, [contenteditable]"))) return;
        if (viewingOriginal) return;
        const segmentId = editor?.dataset.segmentId ?? effectiveSelectedSegmentId;
        if (!transcript?.segments.some(segment => segment.id === segmentId)) return;
        event.preventDefault();
        // 按住组合键只删除一次，防止选中项变化后连续删除。
        if (event.repeat) return;
        flushEditorDrafts();
        removeSegment(segmentId);
        return;
      }

      if (modifier && event.key.toLowerCase() === "z") {
        if (target?.closest("input, textarea, select, [contenteditable='true']") && !target.matches("[data-transcript-editor]")) return;
        event.preventDefault();
        if (event.shiftKey) performRedo();
        else performUndo();
        return;
      }
      if (modifier && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setFindOpen(true);
        window.requestAnimationFrame(() => document.getElementById("find-input")?.focus());
        return;
      }
      if (modifier && event.key.toLowerCase() === "e") {
        // Windows 需要 Ctrl+Shift+E（纯 Ctrl+E 被浏览器地址栏占用），Mac 用 ⌘E。
        if (!IS_MAC && !event.shiftKey) return;
        event.preventDefault();
        setExportMenuOpen((open) => !open);
        return;
      }
      if (event.key === "Escape" && findOpen) {
        setFindOpen(false);
        setShowReplace(false);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "0") {
        event.preventDefault();
        togglePlayFromCursor();
        return;
      }
      // ⌘O / Ctrl+O：打开音频文件夹。
      if ((event.metaKey || event.ctrlKey) && (event.key === "o" || event.key === "O")) {
        event.preventDefault();
        void handleOpenFolder();
        return;
      }
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (event.code === "Space") {
        event.preventDefault();
        togglePlayback();
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const audio = audioRef.current;
        if (!audioUrl || !audio) return;
        const delta = event.key === "ArrowLeft" ? -skipSeconds : skipSeconds;
        seekTo(audio.currentTime + delta, false);
        return;
      }
      // ⌘↓ / Ctrl+↓ = 合并下一段（焦点不在输入控件时）。
      if (modifier && event.key === "ArrowDown") {
        event.preventDefault();
        if (transcript && effectiveSelectedSegmentId) {
          mergeWithNext(effectiveSelectedSegmentId);
        }
        return;
      }
      if ((event.key === "ArrowUp" || event.key === "ArrowDown") && transcript) {
        event.preventDefault();
        const currentIndex = Math.max(
          0,
          transcript.segments.findIndex((segment) => segment.id === effectiveSelectedSegmentId),
        );
        const delta = event.key === "ArrowUp" ? -1 : 1;
        let nextIndex=currentIndex+delta;
        while(transcript.segments[nextIndex]&&deps.visibleSegmentIds&&!deps.visibleSegmentIds.has(transcript.segments[nextIndex].id))nextIndex+=delta;
        const nextSegment = transcript.segments[nextIndex];
        if (nextSegment) {
          setSelectedSegmentId(nextSegment.id);
          document.getElementById(`segment-${nextSegment.id}`)?.scrollIntoView({ block: "center" });
        }
      }
    };
    window.addEventListener("keydown", handleKeydown);
    window.addEventListener('keydown', handleTagKeydown, true);
    return () => { window.removeEventListener("keydown", handleKeydown); window.removeEventListener('keydown', handleTagKeydown, true); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    deps.copySegment,
    deps.addTag,
    deps.nativeTagShortcut,
    deps.tagWriteDisabled,
    deps.visibleSegmentIds,
    disabled,
    transcript,
    viewingOriginal,
    removeSegment,
    findOpen,
    effectiveSelectedSegmentId,
    audioUrl,
    skipSeconds,
    performUndo,
    performRedo,
    togglePlayback,
    togglePlayFromCursor,
  ]);
}
