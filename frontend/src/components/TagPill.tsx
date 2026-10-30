/** Shared display and remove geometry; absence of onRemove is an explicit read-only/display context. */
export function TagPill({ name, onRemove, removeLabel, disabled = false, stopPropagation = false }: {
    name: string;
    onRemove?: () => void;
    removeLabel?: string;
    disabled?: boolean;
    stopPropagation?: boolean;
}) {
    return <span className={'tag-pill' + (onRemove ? ' tag-pill--removable' : '')} onClick={stopPropagation ? event => event.stopPropagation() : undefined}>
        <span className="tag-pill-label">{name}</span>
        {onRemove && <button type="button" className="tag-pill-remove" disabled={disabled} aria-label={removeLabel} onKeyDown={event => { if (event.key === ' ') event.stopPropagation(); }} onClick={event => { event.stopPropagation(); onRemove(); }}>×</button>}
    </span>;
}
