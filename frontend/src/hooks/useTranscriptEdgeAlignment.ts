import { useLayoutEffect, type RefObject } from 'react';

/** Match the fixed heading to the card border when either region has a scrollbar. */
export function useTranscriptEdgeAlignment(panelRef: RefObject<HTMLElement | null>, enabled: boolean) {
    useLayoutEffect(() => {
        const panel = panelRef.current, column = panel?.closest<HTMLElement>('.transcript-column'), header = column?.querySelector<HTMLElement>('.transcript-header-fixed');
        if (!enabled || !panel || !column || !header) return;
        const sync = () => {
            const offset = panel.offsetWidth - panel.clientWidth - (header.offsetWidth - header.clientWidth);
            column.style.setProperty('--transcript-scrollbar-offset', `${offset}px`);
        };
        sync(); const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(sync); observer?.observe(panel); observer?.observe(header);
        window.addEventListener('resize', sync);
        return () => { observer?.disconnect(); window.removeEventListener('resize', sync); column.style.removeProperty('--transcript-scrollbar-offset'); };
    }, [panelRef, enabled]);
}
