import { useRef, useState } from 'react';
import { msg } from '../i18n';
import { tagTreeRows, tagAncestors, suggestTags, type TagLibrary } from '../lib/tags';
import { tagTreeGuides } from '../lib/tagTreeGuides';
import { TagPill } from './TagPill';
import { TagTreeGuides } from './TagTreeGuides';
import { useTagTreeLayout } from './useTagTreeLayout';
/** Checkbox toggles only membership; the separate name button folds, without selecting. */
export function TagMembershipTree({ library, memberIds, checked, onToggle, disabled, query }: {
    library: TagLibrary; memberIds?: ReadonlySet<string>; checked: ReadonlySet<string>;
    onToggle: (id: string, enabled: boolean) => void; disabled: boolean; query: string;
}) {
    const [collapsed, setCollapsed] = useState(new Set<string>()), allRows = tagTreeRows(library, memberIds);
    const root = useRef<HTMLDivElement>(null);
    useTagTreeLayout(root, [library, memberIds, collapsed, query]);
    const matches = query.trim() ? new Set(suggestTags(library.tags, query).flatMap(tag => [tag.id, ...tagAncestors(library, tag.id).map(tag => tag.id)])) : null;
    const rows = allRows.filter(({ tag }) => matches ? matches.has(tag.id) : !tagAncestors(library, tag.id).some(tag => collapsed.has(tag.id)));
    const guides = tagTreeGuides(library, rows.map(row => row.tag.id), memberIds);
    return <div ref={root} className="tag-check-list tag-membership-tree">{rows.map(({ tag, depth }) => {
        const parent = allRows.some(row => tagAncestors(library, row.tag.id).some(ancestor => ancestor.id === tag.id)), open = !!matches || !collapsed.has(tag.id);
        const fold = () => { if (!matches && !disabled) setCollapsed(old => { const next = new Set(old); if (next.has(tag.id)) next.delete(tag.id); else next.add(tag.id); return next; }); };
        return <div className="tag-membership-row" data-tag-id={tag.id} key={tag.id} style={{ paddingLeft: depth * 21 }}>
            <TagTreeGuides guide={guides.get(tag.id)} step={21} origin={6.5}/>
            <input className="ripple-checkbox" type="checkbox" disabled={disabled} checked={checked.has(tag.id)} aria-label={tag.name} onChange={event => onToggle(tag.id, event.target.checked)}/>
            {parent ? <button type="button" className="tag-membership-name" aria-label={msg('tags.foldTag', { name: tag.name })} aria-expanded={open} disabled={disabled} onClick={fold}><TagPill name={tag.name}/></button>
                : <span className="tag-membership-name"><TagPill name={tag.name}/></span>}
        </div>;
    })}</div>;
}
