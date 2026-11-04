/** One row index and scroll sampler per panel, shared by persistence and resize anchoring. */
export interface ViewportAnchor {
    row: HTMLElement; node: HTMLElement; paragraph: number; rect: DOMRect;
    offset: number; fraction: number;
}
export interface ReadingViewportSample { bounds: DOMRect; viewport: ViewportAnchor | null; reading: ViewportAnchor | null }
export interface ReadingViewport {
    capture: () => ReadingViewportSample;
    subscribe: (listener: (sample: ReadingViewportSample) => void) => () => void;
}
const trackers = new WeakMap<HTMLElement, ReadingViewport>();
export function readingViewport(panel: HTMLElement): ReadingViewport {
    const existing = trackers.get(panel); if (existing) return existing;
    const listeners = new Set<(sample: ReadingViewportSample) => void>();
    let rows: HTMLElement[] = [], readingRows: HTMLElement[] = [], paragraphs = new WeakMap<HTMLElement, HTMLElement[]>();
    let dirtyRows = true, dirty = true, frame = 0, repeatedScroll = false, lastTop = panel.scrollTop;
    let snapshot: ReadingViewportSample | undefined;
    const invalidate = (records: MutationRecord[]) => {
        if (!records.length) return;
        dirty = true;
        if (records.some(record => record.type === 'childList')) { dirtyRows = true; paragraphs = new WeakMap(); }
    };
    const observer = new MutationObserver(records => { invalidate(records); schedule(); });
    function sample(): ReadingViewportSample {
        invalidate(observer.takeRecords());
        const bounds = panel.getBoundingClientRect();
        if (dirtyRows) {
            rows = Array.from(panel.querySelectorAll<HTMLElement>('.segment, .comparison-deleted-segment'));
            readingRows = rows.filter(row => row.matches('.segment[id]'));
            dirtyRows = false;
        }
        const geometry = new Map<HTMLElement, DOMRect>();
        const rect = (node: HTMLElement) => { let value = geometry.get(node); if (!value) { value = node.getBoundingClientRect(); geometry.set(node, value); } return value; };
        const anchor = (items: HTMLElement[]): ViewportAnchor | null => {
            let low = 0, high = items.length;
            while (low < high) { const middle = (low + high) >>> 1; if (rect(items[middle]).bottom <= bounds.top) low = middle + 1; else high = middle; }
            const row = items[low], box = row && rect(row);
            if (!row || !box || box.height <= 0 || box.top >= bounds.bottom) return null;
            let parts = paragraphs.get(row);
            if (!parts) { parts = Array.from(row.querySelectorAll<HTMLElement>('.rt-para, .segment-text-readonly p')); paragraphs.set(row, parts); }
            const paragraph = parts.findIndex(node => { const box = rect(node); return box.height > 0 && box.bottom > bounds.top && box.top < bounds.bottom; });
            const node = parts[paragraph] ?? row, position = rect(node);
            return { row, node, paragraph, rect: position, offset: Math.max(0, position.top - bounds.top),
                fraction: Math.min(1, Math.max(0, bounds.top - position.top) / position.height) };
        };
        const viewport = anchor(rows), reading = viewport?.row.matches('.segment[id]') ? viewport : anchor(readingRows);
        dirty = false; lastTop = panel.scrollTop;
        return { bounds, viewport, reading };
    }
    const capture = () => { snapshot = sample(); for (const listener of listeners) listener(snapshot); return snapshot; };
    function schedule() {
        if (frame) return;
        frame = requestAnimationFrame(() => {
            frame = 0;
            if (dirty || repeatedScroll || panel.scrollTop !== lastTop) capture();
            repeatedScroll = false;
        });
    }
    const scroll = () => {
        // Keep the first event synchronously: navigation can leave before the next frame.
        // Repeated events in that frame share a single trailing sample, rather than two hook scans.
        if (!frame) capture(); else repeatedScroll = true;
        schedule();
    };
    const tracker: ReadingViewport = {
        capture,
        subscribe(listener) {
            if (!listeners.size) {
                panel.addEventListener('scroll', scroll, { passive: true });
                observer.observe(panel, { childList: true, subtree: true, characterData: true });
            }
            listeners.add(listener);
            if (snapshot && !dirty) listener(snapshot); else capture();
            return () => {
                listeners.delete(listener);
                if (!listeners.size) {
                    observer.disconnect(); panel.removeEventListener('scroll', scroll); cancelAnimationFrame(frame);
                    trackers.delete(panel);
                }
            };
        },
    };
    trackers.set(panel, tracker); return tracker;
}
