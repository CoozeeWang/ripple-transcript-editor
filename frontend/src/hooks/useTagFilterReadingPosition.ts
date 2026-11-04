import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import type { Segment } from '../types';
import type { ReadingAnchor } from '../lib/readingPosition';
import { readingViewport } from '../lib/readingViewport';

type Hover = { row: HTMLElement; anchor: ReadingAnchor; top: number; width: number };
type Pointer = { row: HTMLElement; x: number; y: number; top: number };
const paragraphs = (row: HTMLElement) => Array.from(row.querySelectorAll<HTMLElement>('.rt-para, .segment-text-readonly p'));

/** Restore only an explicit tag-filter exit; navigation/seek keep their own targets. */
export function useTagFilterReadingPosition(panelRef: { current: HTMLElement | null }, context: unknown,
    ready: boolean, active: boolean, segments: readonly Segment[], projection: readonly Segment[]) {
    const indices = useMemo(() => new Map(segments.map((segment, index) => [segment.id, index])), [segments]);
    const intent = useRef(0), reading = useRef<ReadingAnchor | null>(null);
    const pointer = useRef<Pointer | null>(null), hover = useRef<Hover | null>(null), inside = useRef(false);
    const pending = useRef<{ context: unknown; anchor: ReadingAnchor; projection: readonly Segment[]; exitOnly: boolean } | null>(null);
    useLayoutEffect(() => {
        pending.current = null; reading.current = null; hover.current = null; pointer.current = null; inside.current = false;
    }, [context, ready]);
    useLayoutEffect(() => {
        const panel = panelRef.current; if (!panel || !ready) return;
        return readingViewport(panel).subscribe(sample => {
            const position = sample.reading, index = position && indices.get(position.row.id.slice('segment-'.length));
            if (position && index !== undefined && index !== null) reading.current = {
                id: position.row.id.slice('segment-'.length), index, paragraph: position.paragraph,
                offset: position.offset, fraction: position.fraction,
            };
        });
    }, [panelRef, context, ready, indices]);

    const captureRow = useCallback((panel: HTMLElement, row: HTMLElement, y?: number, savedParagraph?: number): Hover | null => {
        const id = row.id.slice('segment-'.length), index = indices.get(id);
        if (!panel.contains(row) || index === undefined) return null;
        const bounds = panel.getBoundingClientRect(), box = row.getBoundingClientRect();
        if (box.height <= 0 || box.bottom <= bounds.top || box.top >= bounds.bottom) return null;
        const parts = paragraphs(row);
        let paragraph = savedParagraph ?? (y === undefined ? -1 : parts.findIndex(node => { const rect = node.getBoundingClientRect(); return rect.top <= y && rect.bottom > y; }));
        if (paragraph < 0 && y === undefined && savedParagraph === undefined) paragraph = parts.findIndex(node => { const rect = node.getBoundingClientRect(); return rect.height > 0 && rect.bottom > bounds.top && rect.top < bounds.bottom; });
        const rect = (parts[paragraph] ?? row).getBoundingClientRect();
        return { row, top: panel.scrollTop, width: bounds.width, anchor: { id, index, paragraph,
            offset: Math.max(0, rect.top - bounds.top), fraction: rect.height > 0 ? Math.min(1, Math.max(0, bounds.top - rect.top) / rect.height) : 0 } };
    }, [indices]);
    const atPointer = useCallback((panel: HTMLElement): Hover | null => {
        const point = pointer.current; if (!point) return null;
        const hit = document.elementFromPoint?.(point.x, point.y)?.closest<HTMLElement>('.segment[id]');
        const row = hit && panel.contains(hit) ? hit : point.top === panel.scrollTop ? point.row : null;
        return row ? captureRow(panel, row, point.y) : null;
    }, [captureRow]);
    // Pointer movement records identity/coordinates only: no geometry queries per move.
    useLayoutEffect(() => {
        const panel = panelRef.current; if (!panel || !ready || !active) return;
        const move = (event: PointerEvent) => {
            inside.current = true; hover.current = null;
            const row = event.target instanceof Element ? event.target.closest<HTMLElement>('.segment[id]') : null;
            pointer.current = row && panel.contains(row) ? { row, x: event.clientX, y: event.clientY, top: panel.scrollTop } : null;
        };
        const leave = () => { hover.current = atPointer(panel); inside.current = false; };
        panel.addEventListener('pointermove', move, { passive: true }); panel.addEventListener('pointerleave', leave, { passive: true });
        return () => {
            panel.removeEventListener('pointermove', move); panel.removeEventListener('pointerleave', leave);
            pointer.current = null; hover.current = null; inside.current = false;
        };
    }, [panelRef, context, ready, active, atPointer]);

    const preserve = (exitOnly = true) => {
        const panel = panelRef.current; if (!active || !ready || !panel) return;
        readingViewport(panel).capture();
        const previous = hover.current;
        let candidate = inside.current ? atPointer(panel) : previous && previous.top === panel.scrollTop
            && previous.width === panel.getBoundingClientRect().width ? captureRow(panel, previous.row, undefined, previous.anchor.paragraph) : null;
        if (!inside.current && previous && candidate && (candidate.anchor.offset !== previous.anchor.offset
            || candidate.anchor.fraction !== previous.anchor.fraction)) candidate = null;
        const anchor = candidate?.anchor ?? reading.current;
        // Also invalidate delayed opening/resize restoration when the result is empty.
        intent.current++;
        pending.current = anchor ? { context, anchor, projection, exitOnly } : null;
    };
    useLayoutEffect(() => {
        const saved = pending.current, panel = panelRef.current;
        if (!saved || (saved.exitOnly ? active : saved.projection === projection)) return;
        pending.current = null;
        if (!ready || !panel || saved.context !== context) return;
        const anchor = saved.anchor;
        let target = segments.find(segment => segment.id === anchor.id)
            ?? segments.find(segment => segment.mergedFrom?.includes(anchor.id));
        let row = target && document.getElementById(`segment-${target.id}`);
        if (!row || !panel.contains(row)) {
            // Deleted/otherwise hidden target: choose the nearest rendered document neighbour.
            let distance = Infinity;
            for (const candidate of panel.querySelectorAll<HTMLElement>('.segment[id]')) {
                const index = indices.get(candidate.id.slice('segment-'.length));
                if (index !== undefined && Math.abs(index - anchor.index) < distance) {
                    row = candidate; target = segments[index]; distance = Math.abs(index - anchor.index);
                }
            }
        }
        if (!row || !panel.contains(row)) return;
        const same = target?.id === anchor.id || target?.mergedFrom?.includes(anchor.id);
        const node = same ? paragraphs(row)[anchor.paragraph] ?? row : row;
        const rect = node.getBoundingClientRect(), bounds = panel.getBoundingClientRect();
        panel.scrollTo({ top: Math.max(0, panel.scrollTop + rect.top - bounds.top
            + (same ? anchor.fraction * rect.height : 0) - Math.min(anchor.offset, Math.max(0, bounds.height - 1))), behavior: 'instant' });
        readingViewport(panel).capture();
    }, [panelRef, context, ready, active, segments, indices, projection]);
    return { preserve, intent };
}
