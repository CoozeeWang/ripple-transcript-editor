/** Plain-text adapter for the paragraph editor; offsets use UTF-16 like transcript ranges. */
export interface ParagraphEditorElement extends HTMLElement {
  readonly value: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  setSelectionRange(start: number, end: number): void;
}
type Point = { node: Node; offset: number };

export function editorSnapshot(root: HTMLElement) {
  let text = "";
  const points: Point[] = [];
  const offsets = new Map<Node, number[]>();
  function visit(node: Node) {
    if (node instanceof HTMLElement && node.dataset.comparisonDeletion === "true") return;
    const positions: number[] = [];
    offsets.set(node, positions);
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent ?? "";
      for (let i = 0; i <= value.length; i++) {
        positions[i] = text.length + i;
        points[text.length + i] = { node, offset: i };
      }
      text += value;
      return;
    }
    const children = Array.from(node.childNodes);
    children.forEach((child, i) => {
      if (i > 0 && child instanceof HTMLElement && /^(DIV|P)$/.test(child.tagName)) text += "\n";
      positions[i] = text.length;
      points[text.length] ??= { node, offset: i };
      if (child.nodeName === "BR") {
        // A trailing BR is the browser's caret placeholder, not another paragraph.
        if (i < children.length - 1) text += "\n";
      } else visit(child);
    });
    positions[children.length] = text.length;
    points[text.length] ??= { node, offset: children.length };
  }
  visit(root);
  return { text, points, offsets };
}

export function writeEditorText(root: HTMLElement, value: string) {
  root.replaceChildren(...value.split("\n").map(line => {
    const paragraph = document.createElement("div");
    if (line) paragraph.textContent = line;
    else paragraph.append(document.createElement("br"));
    return paragraph;
  }));
}

export function attachEditor(element: HTMLDivElement): ParagraphEditorElement {
  const selection = () => {
    const snapshot = editorSnapshot(element);
    const range = window.getSelection();
    const anchor = range?.anchorNode ? snapshot.offsets.get(range.anchorNode)?.[range.anchorOffset] : undefined;
    const focus = range?.focusNode ? snapshot.offsets.get(range.focusNode)?.[range.focusOffset] : undefined;
    return { start: Math.min(anchor ?? 0, focus ?? 0), end: Math.max(anchor ?? 0, focus ?? 0) };
  };
  Object.defineProperties(element, {
    value: { configurable: true, get: () => editorSnapshot(element).text },
    selectionStart: { configurable: true, get: () => selection().start },
    selectionEnd: { configurable: true, get: () => selection().end },
    setSelectionRange: { configurable: true, value: (start: number, end: number) => {
      const { points, text } = editorSnapshot(element);
      const a = points[Math.max(0, Math.min(start, text.length))];
      const b = points[Math.max(0, Math.min(end, text.length))];
      if (!a || !b) return;
      const range = document.createRange();
      range.setStart(a.node, a.offset);
      range.setEnd(b.node, b.offset);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    } },
  });
  return element as unknown as ParagraphEditorElement;
}
