import { useLayoutEffect, useRef } from "react";

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
    offset: number; fraction: number;
  } | null>(null);

  const capture = () => {
    pending.current = null;
    const panel = panelRef?.current;
    if (!panel) return;
    const bounds = panel.getBoundingClientRect();
    // Use a surviving current segment, never the selected ID or a deleted ghost.
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
    if (segment) {
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
    const cancel = () => { pending.current = null; };
    panel.addEventListener("wheel", cancel, { passive: true });
    panel.addEventListener("touchstart", cancel, { passive: true });
    panel.addEventListener("pointerdown", cancel);
    panel.addEventListener("keydown", cancel);
    return () => {
      panel.removeEventListener("wheel", cancel);
      panel.removeEventListener("touchstart", cancel);
      panel.removeEventListener("pointerdown", cancel);
      panel.removeEventListener("keydown", cancel);
    };
  }, [panelRef, directory, context]);

  return capture;
}
