import type { ReactNode } from 'react';

/** A real hover/focus target around a disabled control, without enabling its action. */
export function FilterActionHint({ blocked, hint, children }: { blocked: boolean; hint: string; children: ReactNode }) {
    return <span className="filter-action-hint" data-action-tip={blocked ? hint : undefined} tabIndex={blocked ? 0 : undefined}>
        {children}
    </span>;
}
