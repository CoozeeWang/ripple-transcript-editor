import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { IS_MAC } from '../lib/format';
import { isEditorComposing } from '../lib/editorDrafts';
export function segmentDragModifier(event: {metaKey:boolean;ctrlKey:boolean;altKey:boolean}, mac = IS_MAC) {
  return !event.altKey && (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);
}
// One document listener, and at most one ready row. A modifier must not rerender
// every paragraph or repeat document-wide modal queries in a long manuscript.
const rows = new Map<HTMLElement, (ready: boolean) => void>();
let hovered: HTMLElement | null = null;
let active: HTMLElement | null = null;
let dragging = false;
let nativeDragging = false;
function activate(row: HTMLElement | null) {
  if (active === row) return;
  if (active) rows.get(active)?.(false);
  active = row;
  if (active) rows.get(active)?.(true);
}
function update(raw: Event) {
  const event = raw as KeyboardEvent | PointerEvent;
  if (dragging) return;
  if (event.type === 'pointermove') hovered = event.target instanceof Element ? event.target.closest<HTMLElement>('.segment') : null;
  else hovered = document.querySelector<HTMLElement>('.segment:hover') ?? hovered;
  const allowed = segmentDragModifier(event) && !isEditorComposing() && !document.querySelector('[role="dialog"], dialog[open]');
  activate(allowed && hovered && rows.has(hovered) ? hovered : null);
}
function reset() { if (!dragging) activate(null); }
function finish() { dragging = false; nativeDragging = false; activate(null); }
function domEnd() { if (!nativeDragging) finish(); }
function listen(add: boolean) {
  const method = add ? 'addEventListener' : 'removeEventListener';
  window[method]('keydown', update); window[method]('keyup', update);
  window[method]('pointermove', update); window[method]('blur', reset);
  window[method]('compositionstart', reset); window[method]('dragend', domEnd);
  document[method]('visibilitychange', reset);
}
export function useSegmentDrag(enabled: boolean, element: RefObject<HTMLElement | null>) {
  const [ready, setReady] = useState(false);
  const current = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!enabled || !element.current) return;
    const row = element.current; current.current = row;
    if (!rows.size) listen(true);
    rows.set(row, setReady);
    return () => {
      if (active === row) { dragging = false; active = null; }
      if (hovered === row) hovered = null;
      rows.delete(row); current.current = null;
      if (!rows.size) listen(false);
    };
  }, [enabled, element]);
  return { ready: enabled && ready,
    start: (native = false) => { dragging = true; nativeDragging = native; activate(current.current); },
    end: finish,
  };
}
