import { useResizeReadingPosition } from "./useResizeReadingPosition";
import { useLayoutEffect } from "react";
import { RESTORE_EDIT_POSITION_KEY } from "../lib/editPosition";
import { loadBooleanPreference } from "../lib/preferences";

/** Schedule only after the loaded document has committed its DOM, not inside its async loader. */
export function useOpeningPosition(
  request: { id: string } | null,
  panelRef: { current: HTMLElement | null },
  ready: boolean,
) {
  useResizeReadingPosition(panelRef,request,ready);
  useLayoutEffect(() => {
    if (!request || !ready) return;
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      if (!loadBooleanPreference(RESTORE_EDIT_POSITION_KEY, false)) {
        panel.scrollTo({ top: 0, behavior: "instant" });
        return;
      }
      const item = document.getElementById(`segment-${request.id}`);
      if (!item || !panel.contains(item)) {
        panel.scrollTo({ top: 0, behavior: "instant" });
        return;
      }
      panel.scrollTo({
        top: Math.max(0, panel.scrollTop + item.getBoundingClientRect().top - panel.getBoundingClientRect().top - 16),
        behavior: "instant",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [request, ready, panelRef]);
}
