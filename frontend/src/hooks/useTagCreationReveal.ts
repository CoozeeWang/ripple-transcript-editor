import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { tagAncestors, type TagLibrary } from '../lib/tags';

interface Request { id: string; context: string }
/** A successful creation locates its saved identity, never a filter selection or editor focus. */
export function useTagCreationReveal({ context, library, listRef, create, showProject, clearSearch, setFolded, folded }: {
    context: string; library: TagLibrary; listRef: RefObject<HTMLDivElement | null>;
    create?: (name: string, id?: string) => Promise<string>;
    showProject: () => void; clearSearch: () => void; setFolded: Dispatch<SetStateAction<Set<string>>>; folded: Set<string>;
}) {
    const [request, setRequest] = useState<Request | null>(null);
    const session = useRef({epoch:0,mounted:false,context}), positioned = useRef<Request | null>(null), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useLayoutEffect(() => { const state=session.current; state.context=context; return () => { state.epoch++; }; }, [context]);
    useEffect(() => {
        const state=session.current; state.mounted = true;
        const cancel = () => { state.epoch++; clearTimeout(timer.current); setRequest(previous => previous ? null : previous); };
        const key = (event: KeyboardEvent) => { if (['Tab','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown'].includes(event.key)) cancel(); };
        document.addEventListener('pointerdown', cancel, true); document.addEventListener('click', cancel, true); document.addEventListener('wheel', cancel, { passive: true, capture: true }); document.addEventListener('keydown', key, true); window.addEventListener('blur', cancel);
        return () => { state.mounted = false; state.epoch++; clearTimeout(timer.current); document.removeEventListener('pointerdown', cancel, true); document.removeEventListener('click', cancel, true); document.removeEventListener('wheel', cancel, true); document.removeEventListener('keydown', key, true); window.removeEventListener('blur', cancel); };
    }, []);
    const submit = useCallback(async (name: string, id?: string) => {
        if (!create) return;
        const state=session.current, token = ++state.epoch;
        const savedId = await create(name, id);
        if (!state.mounted || state.epoch !== token || state.context !== context) return;
        showProject(); clearSearch(); setRequest({ id: savedId, context });
    }, [create, context, showProject, clearSearch]);
    // Discard a previous context immediately, including a quick switch away and back.
    if (request && request.context !== context) setRequest(null);
    const active = request?.context === context ? request : null;
    useLayoutEffect(() => {
        if (!active || !library.tags.some(tag => tag.id === active.id)) return;
        const ancestorKeys = new Set(tagAncestors(library, active.id).map(tag => 'level:' + tag.id));
        // This also handles a save promise resolving before the new catalog is rendered.
        if ([...folded].some(key => ancestorKeys.has(key))) setFolded(previous => [...previous].some(key => ancestorKeys.has(key)) ? new Set([...previous].filter(key => !ancestorKeys.has(key))) : previous);
        const panel = listRef.current, row = panel && [...panel.querySelectorAll<HTMLElement>('[data-tag-id]')].find(node => node.dataset.tagId === active.id);
        if (!panel || !row || positioned.current === active) return;
        const view = panel.getBoundingClientRect(), bounds = row.getBoundingClientRect();
        if (bounds.top < view.top) panel.scrollTop += bounds.top - view.top;
        else if (bounds.bottom > view.bottom) panel.scrollTop += Math.min(bounds.top - view.top, bounds.bottom - view.bottom);
        const label = row.querySelector('.library-filter')?.getBoundingClientRect();
        if (label) {
            // Sticky count/actions must not cover a newly revealed deep-tree label.
            const columns = ['.tag-count','.tag-delete-control'].map(selector => row.querySelector(selector)?.getBoundingClientRect());
            const right = Math.min(view.right, ...columns.filter(bounds => bounds && bounds.width > 0 && bounds.left > view.left).map(bounds => bounds!.left - 8));
            if (label.left < view.left || label.width > right - view.left) panel.scrollLeft += label.left - view.left;
            else if (label.right > right) panel.scrollLeft += label.right - right;
        }
        positioned.current = active;
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setRequest(previous => previous === active ? null : previous), 2400);
    }, [active, library, listRef, setFolded, folded]);
    return { submit: create ? submit : undefined, locatedId: active?.id };
}
