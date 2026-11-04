import { createContext, useLayoutEffect, useMemo, useRef } from 'react';
import type { ProjectTag } from './tags';

/** Only an open input consumes suggestions; closed segment rows need no catalog-wide prop. */
export const TagCandidatesContext = createContext<readonly ProjectTag[]>([]);
export interface TagWritingGuard { isWriting: () => boolean }
/** A stable event-time guard avoids a DOM update for every closed paragraph control. */
export const TagWritingContext = createContext<boolean | TagWritingGuard>(false);
export function useTagWritingGuard(writing: boolean): TagWritingGuard {
    const current = useRef(writing);
    useLayoutEffect(() => { current.current = writing; }, [writing]);
    return useMemo(() => ({ isWriting: () => current.current }), []);
}
export const isTagWriting = (guard: boolean | TagWritingGuard) => typeof guard === 'boolean' ? guard : guard.isWriting();
export function blockTagWrite(guard: boolean | TagWritingGuard, event: { preventDefault: () => void; stopPropagation: () => void }): boolean {
    if (!isTagWriting(guard)) return false;
    event.preventDefault(); event.stopPropagation(); return true;
}
