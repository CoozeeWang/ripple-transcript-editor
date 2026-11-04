import { useCallback, useLayoutEffect, useRef } from 'react';
import type { Segment } from '../types';
import { RESTORE_EDIT_POSITION_KEY } from '../lib/editPosition';
import { loadBooleanPreference } from '../lib/preferences';
import { readingKey, loadReadingAnchor, saveReadingAnchor, type ReadingAnchor, type ReadingScope } from '../lib/readingPosition';
import { useResizeReadingPosition } from './useResizeReadingPosition';
import { readingViewport } from '../lib/readingViewport';

/** Scroll updates only this hook's memory. Persist a small view preference on leave/normal close. */
export function useReadingPosition(scope: ReadingScope | null, panelRef: {current: HTMLElement | null}, ready: boolean,
    segments: readonly Segment[], explicitTarget = false, viewIntent?: { current: number }) {
    const latest = useRef(segments), indices = useRef(new Map<string,number>()), flush = useRef<() => Promise<void>>(async () => {});
    useLayoutEffect(() => { latest.current = segments; indices.current = new Map(segments.map((segment,index)=>[segment.id,index])); },[segments]);
    useResizeReadingPosition(panelRef, scope, ready, viewIntent);
    useLayoutEffect(() => {
        const panel = panelRef.current;
        if (!scope || !ready || !panel) return;
        let cancelled = false, frame = 0, key = '', initialized = false;
        let anchor: ReadingAnchor | null = null;
        const tracker = readingViewport(panel), initialIntent = viewIntent?.current;
        const unsubscribe = tracker.subscribe(sample => {
            if (!initialized) return;
            const position = sample.reading;
            if (!position) return; // Keep the previous anchor for an empty filter result.
            const id = position.row.id.slice('segment-'.length), index = indices.current.get(id);
            if (index === undefined) return;
            anchor = { id, index, paragraph: position.paragraph, offset: position.offset, fraction: position.fraction };
        });
        const persist = async () => { tracker.capture(); if (key && anchor) await saveReadingAnchor(key, anchor); };
        flush.current = persist;
        const leaving = () => { void persist(); };
        window.addEventListener('pagehide', leaving); window.addEventListener('beforeunload', leaving);
        void readingKey(scope).then(async value => {
            if (cancelled) return; key = value;
            const saved = loadBooleanPreference(RESTORE_EDIT_POSITION_KEY, false) ? await loadReadingAnchor(key) : null;
            if(cancelled)return;
            frame = requestAnimationFrame(() => {
                if (cancelled) return;
                if (!explicitTarget && initialIntent === viewIntent?.current) {
                    const items = latest.current;
                    const target = saved && (items.find(segment => segment.id === saved.id || segment.mergedFrom?.includes(saved.id)) ?? items[Math.min(saved.index, items.length - 1)]);
                    const row = target && document.getElementById(`segment-${target.id}`);
                    if (saved && row && panel.contains(row)) {
                        const node = row.querySelectorAll<HTMLElement>('.rt-para, .segment-text-readonly p')[saved.paragraph] ?? row;
                        const r = node.getBoundingClientRect(), bounds = panel.getBoundingClientRect();
                        panel.scrollTo({ top: Math.max(0, panel.scrollTop + r.top - bounds.top + saved.fraction * r.height - Math.min(saved.offset, bounds.height / 2)), behavior: 'instant' });
                    } else panel.scrollTo({ top: 0, behavior: 'instant' });
                }
                initialized = true; tracker.capture();
            });
        }).catch(() => { initialized = true; tracker.capture(); });
        return () => {
            cancelled = true; cancelAnimationFrame(frame);
            // The DOM may already belong to the next version: persist the last scroll snapshot, never recapture here.
            if (key && anchor) void saveReadingAnchor(key, anchor);
            unsubscribe(); window.removeEventListener('pagehide', leaving); window.removeEventListener('beforeunload', leaving);
            if (flush.current === persist) flush.current = async () => {};
        };
    }, [scope, ready, panelRef, explicitTarget, viewIntent]);
    return useCallback(() => flush.current(), []);
}
