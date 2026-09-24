import { editorSnapshot } from "./paragraphEditor";

// CSS Highlights paints DOM ranges without inserting spans or changing the user's selection.
const ranges = new Map<HTMLElement, Range>();
export function setPlaybackHighlight(root: HTMLElement, span: {start: number; end: number} | null) {
  if (typeof CSS === "undefined" || !CSS.highlights || typeof Highlight === "undefined") return;
  ranges.delete(root);
  if (span) {
    const snapshot = editorSnapshot(root);
    const start = snapshot.points[span.start];
    const end = snapshot.points[span.end];
    if (start && end) {
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      ranges.set(root, range);
    }
  }
  if (ranges.size) CSS.highlights.set("transcript-playback", new Highlight(...ranges.values()));
  else CSS.highlights.delete("transcript-playback");
}
