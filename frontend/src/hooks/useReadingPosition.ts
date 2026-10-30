import { useCallback, useLayoutEffect, useRef } from 'react';
import type { Segment } from '../types';
import { RESTORE_EDIT_POSITION_KEY } from '../lib/editPosition';
import { loadBooleanPreference } from '../lib/preferences';
import { readingKey, readReadingAnchor, saveReadingAnchor, type ReadingAnchor, type ReadingScope } from '../lib/readingPosition';
import { useResizeReadingPosition } from './useResizeReadingPosition';

/** Scroll updates only this hook's memory. Persist a small view preference on leave/normal close. */
export function useReadingPosition(scope: ReadingScope | null, panelRef: {current: HTMLElement | null}, ready: boolean,
    segments: readonly Segment[], explicitTarget = false) {
    const latest = useRef(segments), flush = useRef<() => void>(() => {});
    useLayoutEffect(() => { latest.current = segments; });
    useResizeReadingPosition(panelRef, scope, ready);
    useLayoutEffect(() => {
        const panel = panelRef.current;
        if (!scope || !ready || !panel) return;
        let cancelled = false, frame = 0, key = '', initialized = false;
        let anchor: ReadingAnchor | null = null;
        const capture = () => {
            if (!initialized) return;
            const bounds = panel.getBoundingClientRect(), rows = panel.querySelectorAll<HTMLElement>('.segment[id]');
            let low = 0, high = rows.length;
            while (low < high) { const middle = (low + high) >>> 1; if (rows[middle].getBoundingClientRect().bottom <= bounds.top) low = middle + 1; else high = middle; }
            const row = rows[low], rect = row?.getBoundingClientRect();
            if (!rect || rect.height <= 0 || rect.top >= bounds.bottom) return; // Keep the previous anchor for an empty filter result.
            const paragraphs = Array.from(row.querySelectorAll<HTMLElement>('.rt-para, .segment-text-readonly p'));
            const paragraph = paragraphs.findIndex(node => { const r = node.getBoundingClientRect(); return r.height > 0 && r.bottom > bounds.top && r.top < bounds.bottom; });
            const r = (paragraphs[paragraph] ?? row).getBoundingClientRect(), id = row.id.slice('segment-'.length);
            const index = latest.current.findIndex(segment => segment.id === id);
            if (index < 0) return;
            anchor = { id, index, paragraph, offset: Math.max(0, r.top - bounds.top), fraction: Math.min(1, Math.max(0, bounds.top - r.top) / r.height) };
        };
        const persist = () => { capture(); if (key && anchor) saveReadingAnchor(key, anchor); };
        flush.current = persist;
        panel.addEventListener('scroll', capture, { passive: true });
        const leaving = () => persist();
        window.addEventListener('pagehide', leaving); window.addEventListener('beforeunload', leaving);
        void readingKey(scope).then(value => {
            if (cancelled) return; key = value;
            const saved = loadBooleanPreference(RESTORE_EDIT_POSITION_KEY, false) ? readReadingAnchor(key) : null;
            frame = requestAnimationFrame(() => {
                if (cancelled) return;
                if (!explicitTarget) {
                    const items = latest.current;
                    const target = saved && (items.find(segment => segment.id === saved.id || segment.mergedFrom?.includes(saved.id)) ?? items[Math.min(saved.index, items.length - 1)]);
                    const row = target && document.getElementById(`segment-${target.id}`);
                    if (saved && row && panel.contains(row)) {
                        const node = row.querySelectorAll<HTMLElement>('.rt-para, .segment-text-readonly p')[saved.paragraph] ?? row;
                        const r = node.getBoundingClientRect(), bounds = panel.getBoundingClientRect();
                        panel.scrollTo({ top: Math.max(0, panel.scrollTop + r.top - bounds.top + saved.fraction * r.height - Math.min(saved.offset, bounds.height / 2)), behavior: 'instant' });
                    } else panel.scrollTo({ top: 0, behavior: 'instant' });
                }
                initialized = true; capture();
            });
        }).catch(() => { initialized = true; capture(); });
        return () => {
            cancelled = true; cancelAnimationFrame(frame);
            // The DOM may already belong to the next version: persist the last scroll snapshot, never recapture here.
            if (key && anchor) saveReadingAnchor(key, anchor);
            panel.removeEventListener('scroll', capture); window.removeEventListener('pagehide', leaving); window.removeEventListener('beforeunload', leaving);
            if (flush.current === persist) flush.current = () => {};
        };
    }, [scope, ready, panelRef, explicitTarget]);
    return useCallback(() => flush.current(), []);
}
