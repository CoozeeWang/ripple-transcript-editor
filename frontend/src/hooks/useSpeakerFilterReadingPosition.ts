import { useLayoutEffect, useRef } from 'react';
import type { Segment } from '../types';

/** Preserve what is being read, independently of the selected or playing segment. */
export function useSpeakerFilterReadingPosition(
  panelRef: { current: HTMLElement | null }, hidden: ReadonlySet<string>, context: unknown,
) {
  const anchor = useRef<{ context: unknown; id: string; paragraph: number; offset: number } | null>(null);
  const pending = useRef(false);
  const capture = (segments: Segment[], nextHidden: ReadonlySet<string>) => {
    const panel = panelRef.current;
    if (!panel) return;
    const bounds = panel.getBoundingClientRect(), center = (bounds.top + bounds.bottom) / 2;
    const surviving = new Set(segments.filter(s => !nextHidden.has(s.speaker_id)).map(s => `segment-${s.id}`));
    const rows = Array.from(panel.querySelectorAll<HTMLElement>('.segment[id]'));
    const saved = anchor.current;
    if (!rows.length && saved && saved.context === context) {
      const index = segments.findIndex(s => `segment-${s.id}` === saved.id);
      let nearest = index, distance = Infinity;
      segments.forEach((s, i) => {
        if (surviving.has(`segment-${s.id}`) && Math.abs(i - index) < distance) {
          nearest = i; distance = Math.abs(i - index);
        }
      });
      if (distance < Infinity) anchor.current = { ...saved, id: `segment-${segments[nearest].id}`, paragraph: -1 };
      pending.current = true;
      return;
    }
    // Prefer the center row if it survives; otherwise the nearest surviving neighbour.
    const candidates = rows.filter(row => surviving.has(row.id));
    const pool = candidates.length ? candidates : rows;
    let best: HTMLElement | undefined, distance = Infinity;
    for (const row of pool) {
      const rect = row.getBoundingClientRect();
      const delta = Math.max(rect.top - center, center - rect.bottom, 0);
      if (rect.height > 0 && delta < distance) { best = row; distance = delta; }
    }
    if (best) {
      const paragraphs = Array.from(best.querySelectorAll<HTMLElement>('.rt-para'));
      const paragraph = paragraphs.findIndex(p => { const r = p.getBoundingClientRect(); return r.top <= center && r.bottom > center; });
      const rect = (paragraphs[paragraph] ?? best).getBoundingClientRect();
      const offset = rect.top - bounds.top;
      anchor.current = { context, id: best.id, paragraph,
        offset: distance === 0 ? offset : Math.max(0, Math.min(bounds.height / 2, offset)) };
    }
    pending.current = true;
  };
  useLayoutEffect(() => {
    if (!pending.current) return;
    pending.current = false;
    const saved = anchor.current, panel = panelRef.current;
    if (!saved || !panel || saved.context !== context) { anchor.current = null; return; }
    const row = Array.from(panel.querySelectorAll<HTMLElement>('.segment[id]')).find(node => node.id === saved.id);
    if (!row) return; // Keep the last anchor while all speakers are hidden.
    const node = row.querySelectorAll<HTMLElement>('.rt-para')[saved.paragraph] ?? row;
    panel.scrollTo({ top: Math.max(0, panel.scrollTop + node.getBoundingClientRect().top
      - panel.getBoundingClientRect().top - saved.offset), behavior: 'instant' });
  }, [panelRef, hidden, context]);
  return capture;
}
