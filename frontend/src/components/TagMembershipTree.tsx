import { useState } from 'react';
import {msg} from '../i18n';
import { tagTreeRows, tagAncestors, suggestTags, type TagLibrary } from '../lib/tags';
import { TagPill } from './TagPill';
import { TagTreeGuides } from './TagTreeGuides';
/** Explicit membership selection: checkbox changes never propagate to children. */
export function TagMembershipTree({ library, memberIds, checked, onToggle, disabled, query }: {
    library: TagLibrary; memberIds?: ReadonlySet<string>; checked: ReadonlySet<string>;
    onToggle: (id: string, enabled: boolean) => void; disabled: boolean; query: string;
}) {
    const [collapsed, setCollapsed] = useState(new Set<string>()), rows = tagTreeRows(library, memberIds);
    const matches = query.trim() ? new Set(suggestTags(library.tags, query).flatMap(tag => [tag.id, ...tagAncestors(library, tag.id).map(tag => tag.id)])) : null;
    return <div className="tag-check-list tag-membership-tree">{rows.filter(({ tag }) => matches ? matches.has(tag.id) : !tagAncestors(library, tag.id).some(tag => collapsed.has(tag.id))).map(({ tag, depth }) => {
        const parent = library.tags.some(child => child.parentId === tag.id), open = !!matches || !collapsed.has(tag.id);
        return <div className="tag-membership-row" key={tag.id} style={{ paddingLeft: depth * 16 }}>
            <TagTreeGuides library={library} id={tag.id} members={memberIds}/>
            {parent?<button type="button" className="tag-membership-fold" aria-label={msg('tags.foldTag',{name:tag.name})} aria-expanded={open} disabled={disabled} onClick={() => { if (!matches) setCollapsed(old => { const next = new Set(old); if (next.has(tag.id)) next.delete(tag.id); else next.add(tag.id); return next; }); }}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d={open?'M3 10 8 5 13 10':'M3 6 8 11 13 6'}/></svg></button>:<span className="tag-membership-fold"/>}
            <label className="tag-check"><input className="ripple-checkbox" type="checkbox" disabled={disabled} checked={checked.has(tag.id)} aria-label={tag.name} onChange={event => onToggle(tag.id, event.target.checked)}/><TagPill name={tag.name}/></label>
        </div>;
    })}</div>;
}
