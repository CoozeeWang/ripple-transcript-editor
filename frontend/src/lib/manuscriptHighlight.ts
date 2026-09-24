import { editorSnapshot } from "./paragraphEditor";

const editors = new Map<HTMLElement, Range[]>();

/** Paint saved marks without changing editable DOM or including comparison deletions. */
export function setManuscriptHighlights(root: HTMLElement, spans: readonly {start:number; end:number}[]) {
  if (typeof CSS === "undefined" || !CSS.highlights || typeof Highlight === "undefined") return;
  editors.delete(root);
  if (spans.length) {
    const ranges: Range[] = [];
    for (const [node, offsets] of editorSnapshot(root).offsets) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      const base = offsets[0], length = node.textContent?.length ?? 0;
      for (const span of spans) {
        const start = Math.max(0, span.start - base), end = Math.min(length, span.end - base);
        if (end <= start) continue;
        const range = document.createRange();
        range.setStart(node, start); range.setEnd(node, end);
        ranges.push(range);
      }
    }
    if (ranges.length) editors.set(root, ranges);
  }
  if (editors.size) {
    const highlight = new Highlight(...Array.from(editors.values()).flat());
    highlight.priority = -1;
    CSS.highlights.set("transcript-mark", highlight);
  } else CSS.highlights.delete("transcript-mark");
}
