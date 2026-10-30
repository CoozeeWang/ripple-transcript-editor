/** Shared display and remove geometry; absence of onRemove is an explicit read-only/display context. */
export function TagPill({ name, onRemove, removeLabel, disabled = false, stopPropagation = false, renameEnabled = false, onRename }: {
    name: string;
    onRemove?: () => void;
    removeLabel?: string;
    disabled?: boolean;
    stopPropagation?: boolean;
    renameEnabled?: boolean;
    onRename?: (name: string) => Promise<void>;
}) {
    const [editing, setEditing] = useState(false);
    return <span tabIndex={onRename ? -1 : undefined} className={'tag-pill' + (onRemove ? ' tag-pill--removable' : '')} onClick={stopPropagation ? event => event.stopPropagation() : undefined}>
        <InlineTagName name={name} enabled={renameEnabled && !disabled} onRename={onRename} onEditingChange={setEditing} focusable><span className="tag-pill-label">{name}</span></InlineTagName>
        {onRemove && <button type="button" className="tag-pill-remove" disabled={disabled || editing} aria-label={removeLabel} onDoubleClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === ' ') event.stopPropagation(); }} onClick={event => { event.stopPropagation(); if (event.detail < 2) onRemove(); }}>×</button>}
    </span>;
}
import { useState } from 'react';
import { InlineTagName } from './InlineTagName';
