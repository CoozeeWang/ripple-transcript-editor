import { useContext, useState } from 'react';
import { TagWritingContext } from '../lib/tagCandidates';
import { showActionHint } from '../lib/actionHint';
import { msg } from '../i18n';
import { InlineTagName } from './InlineTagName';
/** Segment labels have no single-click action; double click edits the shared full path. */
export function TagPill({ name, fullPath, onRemove, removeLabel, disabled: suppliedDisabled = false, stopPropagation = false, renameEnabled = false, onRename, editingBlockedByFilter = false }: {
    name: string; fullPath?:string;
    onRemove?: () => void; removeLabel?: string; disabled?: boolean; stopPropagation?: boolean;
    editingBlockedByFilter?: boolean;
    renameEnabled?: boolean; onRename?: (name: string) => Promise<void>;
}) {
    const disabled = useContext(TagWritingContext) || suppliedDisabled;
    const [editing,setEditing]=useState(false);
    const label=<span className="tag-pill-label">{name}</span>;
    return <span onDoubleClickCapture={event => { if (editingBlockedByFilter && !disabled && onRename && !(event.target instanceof Element && event.target.closest('.tag-pill-remove'))) { event.preventDefault(); event.stopPropagation(); showActionHint(event.currentTarget, msg('tags.filterEditNotice')); } }} tabIndex={onRename ? -1 : undefined} className={'tag-pill' + (onRemove ? ' tag-pill--removable' : '')+(editing?' is-editing':'')} onClick={stopPropagation ? event=>event.stopPropagation():undefined}>
        <InlineTagName name={fullPath??name} maxLength={fullPath?1024:120} focusable={!!onRename} enabled={renameEnabled&&!disabled} onRename={onRename} onEditingChange={setEditing}>
            {label}
        </InlineTagName>
        {onRemove&&!editing&&<button type="button" className="tag-pill-remove" disabled={disabled} aria-label={removeLabel} onDoubleClick={event=>event.stopPropagation()} onKeyDown={event=>{if(event.key===' ')event.stopPropagation()}} onClick={event=>{event.stopPropagation();if(event.detail<2)onRemove()}}>×</button>}
    </span>;
}
