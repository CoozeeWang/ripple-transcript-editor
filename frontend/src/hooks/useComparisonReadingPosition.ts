import { useLayoutEffect, useRef } from "react";
import { editorSnapshot } from "../lib/paragraphEditor";
import { isEditorComposing } from "../lib/editorDrafts";

type EditPosition = { editor: HTMLElement; id: string; offset: number };
function editPosition(panel: HTMLElement): EditPosition | null {
  const selection = window.getSelection();
  const node = selection?.focusNode;
  const editor = (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>('[data-transcript-editor="true"]');
  if (!editor || !panel.contains(editor) || !selection?.anchorNode || !editor.contains(selection.anchorNode)) return null;
  const segment = editor.closest<HTMLElement>('.segment[id]');
  if (!segment) return null;
  const offset = editorSnapshot(editor).offsets.get(node!)?.[selection!.focusOffset];
  return offset === undefined ? null : { editor, id: segment.id, offset };
}
function cursorRect(editor: HTMLElement, offset: number): DOMRect {
  const {points, text} = editorSnapshot(editor);
  const index = Math.max(0, Math.min(offset, text.length));
  const point = points[index];
  if (!point) return editor.getBoundingClientRect();
  const range = document.createRange();
  range.setStart(point.node, point.offset); range.collapse(true);
  let rect = range.getBoundingClientRect();
  if (rect.height > 0) return rect;
  // Empty caret rectangles occur at line boundaries; measure an adjacent character.
  const next = points[index + 1], previous = points[index - 1];
  if (next) range.setEnd(next.node, next.offset);
  else if (previous) range.setStart(previous.node, previous.offset);
  rect = range.getBoundingClientRect();
  if (rect.height > 0) return rect;
  return (point.node instanceof Element ? point.node : point.node.parentElement)?.getBoundingClientRect() ?? editor.getBoundingClientRect();
}

/** Snapshot the visible text before comparison reflows, including its async load. */
export function useComparisonReadingPosition(
  panelRef: { current: HTMLElement | null } | undefined,
  directory: unknown,
  context: string,
  shown: boolean,
  loading: boolean,
  baseline: unknown,
) {
  const pending = useRef<{
    directory: unknown; context: string; id: string; paragraph: number;
    offset: number; fraction: number; editOffset?: number;
  } | null>(null);

  const lastEdit = useRef<EditPosition | null>(null);
  const capture = () => {
    pending.current = null;
    const panel = panelRef?.current;
    if (!panel || isEditorComposing()) return;
    const focused = document.activeElement;
    const comparisonControl = focused instanceof Element && focused.closest('.comparison-toggle, .comparison-source');
    const selected = editPosition(panel);
    const edit = selected && (focused === selected.editor || comparisonControl) ? selected
      : comparisonControl && lastEdit.current && panel.contains(lastEdit.current.editor) ? lastEdit.current : null;
    if (edit) {
      pending.current = {directory, context, id:edit.id, paragraph:-1, offset:0, fraction:0, editOffset:edit.offset};
      return;
    }
    const bounds = panel.getBoundingClientRect();
    // Without an active editor, retain the visible reading position, not playback selection.
    const segment = Array.from(panel.querySelectorAll<HTMLElement>(".segment[id]")).find(node => {
      const rect = node.getBoundingClientRect();
      return rect.height > 0 && rect.bottom > bounds.top && rect.top < bounds.bottom;
    });
    if (!segment) return;
    const paragraphs = Array.from(segment.querySelectorAll<HTMLElement>(".rt-para"));
    const paragraph = paragraphs.findIndex(node => {
      const rect = node.getBoundingClientRect();
      return rect.height > 0 && rect.bottom > bounds.top && rect.top < bounds.bottom;
    });
    const rect = (paragraphs[paragraph] ?? segment).getBoundingClientRect();
    const offset = rect.top - bounds.top;
    pending.current = { directory, context, id: segment.id, paragraph,
      offset: Math.max(0, offset), fraction: Math.max(0, -offset) / rect.height };
  };

  useLayoutEffect(() => {
    const anchor = pending.current;
    if (!anchor) return;
    const panel = panelRef?.current;
    if (!panel || anchor.directory !== directory || anchor.context !== context) {
      pending.current = null;
      return;
    }
    const segment = Array.from(panel.querySelectorAll<HTMLElement>(".segment[id]"))
      .find(node => node.id === anchor.id);
    if (segment && anchor.editOffset !== undefined) {
      const editor = segment.querySelector<HTMLElement>('[data-transcript-editor="true"]');
      const bounds = panel.getBoundingClientRect(), row = segment.getBoundingClientRect();
      const rect = row.height <= bounds.height || !editor ? row : cursorRect(editor, anchor.editOffset);
      panel.scrollTo({top:Math.max(0,panel.scrollTop + rect.top - bounds.top - (bounds.height-rect.height)/2),behavior:"instant"});
    } else if (segment) {
      const node = segment.querySelectorAll<HTMLElement>(".rt-para")[anchor.paragraph] ?? segment;
      const rect = node.getBoundingClientRect();
      panel.scrollTo({ top: Math.max(0, panel.scrollTop + rect.top - panel.getBoundingClientRect().top
        + anchor.fraction * rect.height - anchor.offset), behavior: "instant" });
    }
    if (!loading) pending.current = null;
  }, [panelRef, directory, context, shown, loading, baseline]);

  useLayoutEffect(() => {
    const panel = panelRef?.current;
    if (!panel) return;
    // A user who moves while the baseline loads owns the new reading position.
    const cancel = () => { pending.current = null; lastEdit.current = null; };
    const remember = () => { lastEdit.current = editPosition(panel); };
    const focus = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof Element && !target.closest('[data-transcript-editor="true"], .comparison-toggle, .comparison-source')) cancel();
    };
    panel.addEventListener("focusout", remember);
    panel.addEventListener("compositionstart", cancel);
    document.addEventListener("focusin", focus);
    panel.addEventListener("wheel", cancel, { passive: true });
    panel.addEventListener("touchstart", cancel, { passive: true });
    panel.addEventListener("pointerdown", cancel);
    panel.addEventListener("keydown", cancel);
    return () => {
      pending.current = null; lastEdit.current = null;
      panel.removeEventListener("focusout", remember);
      panel.removeEventListener("compositionstart", cancel);
      document.removeEventListener("focusin", focus);
      panel.removeEventListener("wheel", cancel);
      panel.removeEventListener("touchstart", cancel);
      panel.removeEventListener("pointerdown", cancel);
      panel.removeEventListener("keydown", cancel);
    };
  }, [panelRef, directory, context]);

  return capture;
}
