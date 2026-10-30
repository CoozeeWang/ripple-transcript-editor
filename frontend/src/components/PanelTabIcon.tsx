/** Equal visible extent and stroke, independent of tab width or inherited SVG rules. */
export function PanelTabIcon({ kind }: { kind: 'annotation' | 'tags' | 'highlight' }) {
    const scale = (15.5 - 1.25) / (kind === 'highlight' ? 16 : 18), viewport = 20 / scale, inset = (24 - viewport) / 2;
    return <svg className="panel-tab-icon" width="20" height="20" viewBox={`${inset} ${inset} ${viewport} ${viewport}`} fill="none" stroke="currentColor" strokeWidth={1.25 / scale} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {kind === 'annotation' ? <><path d="M21 15a2 2 0 0 1-2 2H7l-4 3.5V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h6"/></>
            : kind === 'tags' ? <><path d="M3 3h8l10 10-8 8L3 11Z"/><circle cx="7.5" cy="7.5" r="1"/></>
                : <><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 8v8m6-8v8m-6-4h6"/></>}
    </svg>;
}
