import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { msg, useInterfaceLanguage } from '../i18n';
import { IS_MAC } from '../lib/format';
import { type ProjectTag, type TagLibrary, type TagGroup, moveTagGroup, removeTagGroup, transferTagGroup, tagTreeRows, tagAncestors, tagPath, descendantTagIds, removeTagBranch, suggestTags } from '../lib/tags';
import { tagErrorMessage } from '../lib/tagErrors';
import { TagLibraryInput } from './TagLibraryInput';
import { TagMembershipTree } from './TagMembershipTree';
import { TagLibraryPill } from './TagLibraryPill';
import { TagDeleteControl } from './TagDeleteControl';
import { GroupNameButton } from './GroupNameButton';
import { TagModal } from './TagModal';
import { InlineTagName } from './InlineTagName';
import { ActionIcon } from './ActionIcon';
import { TagTreeGuides } from './TagTreeGuides';
import { tagTreeGuides, type TagGuide } from '../lib/tagTreeGuides';
import { showActionHint } from '../lib/actionHint';
import { TagPill } from './TagPill';
import { FilterActionHint } from './FilterActionHint';
import './tags.css';

export function TagChevron() {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={5 / 3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 4 9 5 9-5M3 12h18m-18 8 9-5 9 5"/></svg>;
}
interface Props {
    loadError?: string; library: TagLibrary; currentTagIds: readonly string[];
    onChange: (library: TagLibrary) => Promise<void>;
    onCreateTag?: (name: string, id?: string) => Promise<void>;
    onRenameTag?: (id: string, name: string) => Promise<void>;
    onReparentTag?: (id: string, parentId: string | null) => Promise<void>;
    onRemoveCurrent?: (id: string) => Promise<void>;
    readOnly: boolean; filter: readonly string[]; filterMode: 'and' | 'or';
    onFilterModeChange: (mode: 'and' | 'or') => void;
    filterEnabled: boolean; onFilterEnabledChange: (enabled: boolean) => void; onFilter: (id: string | null) => void;
    currentCount: (id: string) => number;
    onDropTagToSegment?: (tagId: string, segmentId: string) => Promise<void>;
    onTagDropTarget?: (segmentId: string | null) => void;
}
type Modal = { type: 'group'; id: string } | { type: 'dissolve'; id: string } | { type: 'delete'; id: string; scope: 'current' | 'project' };
type Target = { kind: 'group'; id: string } | { kind: 'tree'; parentId: string | null; anchorId: string | null; depth: number } | { kind: 'segment'; id: string } | { kind: 'order'; id: string | null; after: boolean };
interface Gesture { kind: 'tag' | 'group'; id: string; source: string | null; copy: boolean; level: boolean; pointer: number; x: number; y: number; lastX: number; lastY: number; active: boolean; target: Target | null }

export function TagsPanel(p: Props) {
    useInterfaceLanguage();
    const [view, setView] = useState<'level' | 'groups'>('level'), [scope, setScope] = useState<'current' | 'project'>('current');
    const [query, setQuery] = useState(''), [direction, setDirection] = useState<1 | -1>(1);
    const [foldedGroups, setFoldedGroups] = useState(new Set<string>()), [foldedTags, setFoldedTags] = useState(new Set<string>());
    const [modal, setModal] = useState<Modal | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const [drag, setDrag] = useState<Gesture | null>(null), [modifier, setModifier] = useState(false);
    const list = useRef<HTMLDivElement>(null), gesture = useRef<Gesture | null>(null), frame = useRef<number | null>(null), suppress = useRef(0);
    const confirming = useRef(false);
    const clicks = useRef(new Map<string, ReturnType<typeof setTimeout>>()), description = useId();
    const latest = useRef(p); useLayoutEffect(() => { latest.current = p; });
    const locked = p.readOnly || busy || !!p.loadError, dragEnabled = !locked && !p.filterEnabled;
    const admitted = new Set(p.currentTagIds), allRows = useMemo(() => tagTreeRows(p.library, undefined, 'name', direction), [p.library, direction]);
    const tree = useMemo(() => new Map(p.library.tags.map(tag => [tag.id, {
        ancestors: tagAncestors(p.library, tag.id), descendants: descendantTagIds(p.library, tag.id),
    }])), [p.library]);
    const matches = useMemo(() => query.trim() ? new Set(suggestTags(p.library.tags, query)
        .flatMap(tag => [tag.id, ...tree.get(tag.id)!.ancestors.map(parent => parent.id)])) : null, [p.library, query, tree]);
    const levelMembers = scope === 'project' ? undefined : admitted;
    const showCount = view === 'level' && scope === 'current';
    const scopeIds = allRows.filter(row => !levelMembers || levelMembers.has(row.tag.id)).map(row => row.tag.id);
    const tagKey = (id: string, group = 'level') => group + ':' + id;
    const cancelClick = (key: string) => { clearTimeout(clicks.current.get(key)); clicks.current.delete(key); };
    const delayed = (key: string, detail: number, action: () => void) => { cancelClick(key); if (detail === 0) action(); else if (detail === 1) clicks.current.set(key, setTimeout(action, 500)); };
    const toggleTag = (id: string, group = 'level') => setFoldedTags(old => { const next = new Set(old), key = tagKey(id, group); if (next.has(key)) next.delete(key); else next.add(key); return next; });
    const toggleGroup = (id: string) => setFoldedGroups(old => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next; });
    useLayoutEffect(() => {
        const element = list.current; if (!element) return;
        const sync = () => element.parentElement?.style.setProperty('--tag-scrollbar-width', `${element.offsetWidth - element.clientWidth}px`);
        sync(); const observer = new ResizeObserver(sync); observer.observe(element); return () => observer.disconnect();
    }, []);
    function cancelGesture() {
        gesture.current = null; if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null;
        setDrag(null); latest.current.onTagDropTarget?.(null);
    }
    useEffect(() => {
        const pendingClicks=clicks.current;
        const key = (event: KeyboardEvent) => {
            setModifier(IS_MAC ? event.metaKey : event.ctrlKey);
            if (latest.current.filterEnabled && event.key === (IS_MAC ? 'Meta' : 'Control')) {
                const target = document.querySelector<HTMLElement>('.tag-library .library-filter:hover, .tag-library .group-toggle:hover');
                if (target) showActionHint(target, msg(target.classList.contains('group-toggle') ? 'tags.filterGroupEditNotice' : 'tags.filterEditNotice'));
            }
            if (event.key === 'Escape') { suppress.current = event.timeStamp + 500; cancelGesture(); }
        };
        const blur = () => { setModifier(false); cancelGesture(); };
        window.addEventListener('keydown', key); window.addEventListener('keyup', key); window.addEventListener('blur', blur);
        return () => { window.removeEventListener('keydown', key); window.removeEventListener('keyup', key); window.removeEventListener('blur', blur); if (frame.current !== null) cancelAnimationFrame(frame.current); for (const timer of pendingClicks.values()) clearTimeout(timer); latest.current.onTagDropTarget?.(null); };
    }, []);
    async function save(next: TagLibrary) {
        if (locked) throw Error(msg('tags.saveFailed'));
        if(JSON.stringify(next)===JSON.stringify(p.library)){setModal(null);return;}
        setBusy(true); setError('');
        try { await p.onChange(next); setModal(null); }
        catch (error) { setError(tagErrorMessage(error)); throw error; }
        finally { setBusy(false); }
    }
    async function createGroup(name: string) {
        if (p.library.groups.some(group => group.name.trim().toLowerCase() === name.trim().toLowerCase())) throw Error(msg('tags.duplicate'));
        await save({ ...p.library, groups: [...p.library.groups, { id: crypto.randomUUID(), name, parentId: null }] });
    }
    const groups = p.library.groups;
    const fullyExpanded = view === 'level' ? !scopeIds.some(id => foldedTags.has(tagKey(id)))
        : !['ungrouped', ...groups.map(group => group.id)].some(id => foldedGroups.has(id)) && ![...foldedTags].some(key => !key.startsWith('level:'));
    function toggleAll() {
        if (p.filterEnabled) return;
        if (view === 'level') setFoldedTags(old => { const next = new Set([...old].filter(key => !key.startsWith('level:'))); if (fullyExpanded) for (const id of scopeIds) next.add(tagKey(id)); return next; });
        else { setFoldedGroups(new Set(fullyExpanded ? ['ungrouped', ...groups.map(group => group.id)] : [])); setFoldedTags(old => new Set([...old].filter(key => key.startsWith('level:')))); }
    }
    function findTarget(g: Gesture): Target | null {
        const element = document.elementFromPoint(g.lastX, g.lastY), segment = element?.closest<HTMLElement>('.segment[data-tag-drop-enabled="true"]');
        if (g.kind === 'tag' && segment && p.onDropTagToSegment) return { kind: 'segment', id: segment.id.slice(8) };
        const section = element?.closest<HTMLElement>('[data-tag-group]');
        if (g.kind === 'group') {
            if (section && section.dataset.tagGroup !== g.id) { const rect = section.querySelector('.tag-group-header')!.getBoundingClientRect(); return { kind: 'order', id: section.dataset.tagGroup!, after: g.lastY >= rect.top + rect.height / 2 }; }
            return element?.closest('.root-drop') ? { kind: 'order', id: null, after: true } : null;
        }
        if (!g.level) {
            const id = section?.dataset.tagGroup;
            return id && id !== g.source && transferTagGroup(p.library,g.id,g.source==='ungrouped'?null:g.source,id,g.copy)!==p.library ? { kind: 'group', id } : null;
        }
        // Group membership drags never reach this hierarchy branch.
        if (element?.closest('.tag-tree-root-drop')) return p.library.tags.find(tag=>tag.id===g.id)?.parentId ? { kind: 'tree', parentId: null, anchorId: null, depth: 0 } : null;
        const row = element?.closest<HTMLElement>('.library-tag-row[data-tag-id]');
        if (!row || element?.closest('.library-action-slot,.tag-count,.tag-delete-control')) return null;
        const id = row.dataset.tagId!, absolute = tagAncestors(p.library, id).reverse(), depth = absolute.length;
        const base = row.getBoundingClientRect().left, desired = Math.max(0, Math.min(depth + 1, Math.floor((g.lastX - base + 8) / 16)));
        const parentId = desired > depth ? id : desired === 0 ? null : absolute[desired - 1]?.id ?? null;
        const source = p.library.tags.find(tag => tag.id === g.id)!;
        if (parentId === (source.parentId ?? null) || parentId && descendantTagIds(p.library, g.id).includes(parentId)) return null;
        return { kind: 'tree', parentId, anchorId: id, depth: desired };
    }
    function updateDrag() {
        const g = gesture.current; if (!g?.active) return;
        g.target = findTarget(g); setDrag({ ...g }); p.onTagDropTarget?.(g.target?.kind === 'segment' ? g.target.id : null);
    }
    function tick() {
        const g = gesture.current; if (!g?.active) { frame.current = null; return; }
        const element = document.elementFromPoint(g.lastX, g.lastY)?.closest<HTMLElement>('[data-tag-drop-scroll]') ?? list.current;
        if (element) { const rect = element.getBoundingClientRect(), inside = g.lastX >= rect.left && g.lastX <= rect.right;
            const speed = !inside ? 0 : g.lastY < rect.top + 24 ? -12 : g.lastY > rect.bottom - 24 ? 12 : 0;
            if (speed) { element.scrollBy(0, speed); updateDrag(); }
        }
        frame.current = requestAnimationFrame(tick);
    }
    function start(event: PointerEvent<HTMLButtonElement>, kind: 'tag' | 'group', id: string, source: string | null = null) {
        if (!dragEnabled || event.button !== 0 || !(IS_MAC ? event.metaKey : event.ctrlKey)) return;
        if (query.trim()) { setError(msg('tags.dragSearch')); return; }
        event.preventDefault(); event.stopPropagation();
        gesture.current = { kind, id, source, copy: !!source && source !== 'ungrouped' && event.shiftKey, level: kind === 'tag' && view === 'level',
            pointer: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, active: false, target: null };
        event.currentTarget.setPointerCapture(event.pointerId);
    }
    function move(event: PointerEvent<HTMLButtonElement>) {
        const g = gesture.current; if (!g) return; event.stopPropagation(); g.lastX = event.clientX; g.lastY = event.clientY;
        if (!g.active && Math.hypot(g.lastX - g.x, g.lastY - g.y) < 5) return;
        if (!g.active) { g.active = true; frame.current = requestAnimationFrame(tick); }
        suppress.current = event.timeStamp + 500; updateDrag();
    }
    function finish(event: PointerEvent<HTMLButtonElement>, commit = true) {
        const g = gesture.current; if (!g) return;
        event.stopPropagation(); event.currentTarget.releasePointerCapture?.(g.pointer); cancelGesture();
        if (!g.active) return; suppress.current = event.timeStamp + 500;
        if (!commit || !g.target || !dragEnabled) return;
        const target = g.target;
        const operation = target.kind === 'segment' ? p.onDropTagToSegment?.(g.id, target.id)
            : target.kind === 'tree' ? p.onReparentTag?.(g.id, target.parentId)
            : target.kind === 'group' ? save(transferTagGroup(p.library, g.id, g.source === 'ungrouped' ? null : g.source, target.id, g.copy))
            : save(moveTagGroup(p.library, g.id, target.id, target.after ? 'after' : 'before'));
        void operation?.catch(error => setError(tagErrorMessage(error)));
    }
    function row(tag: ProjectTag, members?: ReadonlySet<string>, group?: string, guide?: TagGuide) {
        const depth = tree.get(tag.id)!.ancestors.length, descendants = tree.get(tag.id)!.descendants, key = tagKey(tag.id, group);
        const parent = descendants.some(id => id !== tag.id && (!members || members.has(id)));
        const selected = p.filterEnabled && p.filter.includes(tag.id), inherited = p.filterEnabled && p.filter.some(id => id !== tag.id && tree.get(id)?.descendants.includes(tag.id));
        const count = showCount ? p.currentCount(tag.id) : 0;
        const canBegin = (time: number) => time >= suppress.current && !gesture.current;
        const hint = msg(group ? 'tags.dragGroupTag' : 'tags.dragLevelTag', { key: IS_MAC ? '⌘' : 'Ctrl', copyKey:IS_MAC?'⌘⇧':'Ctrl+Shift' });
        return <div key={tag.id} className={'tag-tree-entry' + (selected || inherited ? ' is-inherited-region' : '')}>
            <div className={'library-tag-row' + (!showCount ? ' library-tag-row--no-count' : '')} data-tag-id={tag.id} data-tag-depth={depth} style={{ paddingLeft: depth * 16 }}>
                <TagTreeGuides guide={guide}/>
                <InlineTagName row name={tag.name} enabled={!p.filterEnabled && !locked} onRename={p.onRenameTag ? name => p.onRenameTag!(tag.id, name) : undefined} canBegin={canBegin} onEditingChange={() => cancelClick(key)}>
                    <span className="tag-row-main"><TagLibraryPill name={tag.name} selected={selected} inherited={inherited} filterEnabled={p.filterEnabled} locked={locked} parent={parent}
                        onToggle={() => toggleTag(tag.id, group)} onSelect={() => p.onFilter(tag.id)} canBegin={canBegin} hint={hint} dragEnabled={dragEnabled} modifier={modifier}
                        buttonProps={{ onPointerDown: event => start(event, 'tag', tag.id, group ?? null), onPointerMove: move, onPointerUp: event => finish(event), onPointerCancel: event => finish(event, false) }}
                        onRemove={group && group !== 'ungrouped' ? () => void save({ ...p.library, tags: p.library.tags.map(item => item.id === tag.id ? { ...item, groupIds: item.groupIds.filter(id => id !== group) } : item) }).catch(() => {}) : undefined}/></span>
                    {showCount && <span className="tag-count" aria-label={msg('tags.currentCount', { count })}>{count}</span>}
                    {!group ? <TagDeleteControl name={tag.name} scope={scope} count={scope === 'project' ? descendants.length : descendants.filter(id=>admitted.has(id)).length} filterEnabled={p.filterEnabled} disabled={locked || scope === 'current' && !p.onRemoveCurrent}
                        onDelete={() => setModal({ type: 'delete', id: tag.id, scope })}/>
                        : <span className="library-action-slot"/>}
                </InlineTagName>
            </div>
            {drag?.target?.kind === 'tree' && drag.target.anchorId === tag.id && <div className="tag-drop-line" style={{ marginLeft: drag.target.depth * 16 }}/ >}
        </div>;
    }
    function rowsFor(members?: ReadonlySet<string>, group?: string) {
        let rows = allRows.filter(({ tag }) => !members || members.has(tag.id));
        rows = rows.filter(({ tag }) => matches ? matches.has(tag.id) : p.filterEnabled || !tree.get(tag.id)!.ancestors.some(ancestor => (!members || members.has(ancestor.id)) && foldedTags.has(tagKey(ancestor.id, group))));
        const guides = tagTreeGuides(p.library, rows.map(row => row.tag.id), members);
        return rows.map(({ tag }) => row(tag, members, group, guides.get(tag.id)));
    }
    function groupNode(group: TagGroup) {
        const members = new Set(p.library.tags.filter(tag => admitted.has(tag.id) && tag.groupIds.includes(group.id)).map(tag => tag.id)), rows = rowsFor(members, group.id);
        if (query.trim() && !rows.length) return null;
        const open = p.filterEnabled || !!query.trim() || !foldedGroups.has(group.id), key = 'group:' + group.id;
        const target = drag?.target;
        return <section key={group.id} data-tag-group={group.id} className={'tag-group' + (target?.kind === 'group' && target.id === group.id ? ' tag-drop-target' : '') + (target?.kind === 'order' && target.id === group.id ? target.after ? ' drop-after' : ' drop-before' : '')}>
            <div className="tag-group-header">
                <InlineTagName row name={group.name} label={msg('tags.groupName')} enabled={!p.filterEnabled && !locked} canBegin={time => time >= suppress.current && !gesture.current} onEditingChange={() => cancelClick(key)}
                    onRename={async name => { if (groups.some(other => other.id !== group.id && other.name.toLowerCase() === name.toLowerCase())) throw Error(msg('tags.duplicate')); await save({ ...p.library, groups: groups.map(item => item.id === group.id ? { ...item, name } : item) }); }}>
                    <GroupNameButton className={'group-toggle' + (modifier && dragEnabled ? ' can-drag' : '')} isMac={IS_MAC} dragging={!!drag} dragEnabled={dragEnabled} aria-label={group.name} aria-expanded={open}
                        onPointerDown={event => start(event, 'group', group.id)} onPointerMove={move} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, false)}
                        onKeyDown={event => { if (p.filterEnabled || locked || !event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault(); const position = groups.findIndex(item => item.id === group.id), target = groups[position + (event.key === 'ArrowUp' ? -1 : 1)]; if (target) void save(moveTagGroup(p.library, group.id, target.id, event.key === 'ArrowUp' ? 'before' : 'after')).catch(() => {}); }}
                        onClick={event => { if (!p.filterEnabled && event.timeStamp >= suppress.current && !event.metaKey && !event.ctrlKey) delayed(key, event.detail, () => toggleGroup(group.id)); }}><span className="group-name" data-tip-anchor>{group.name}</span></GroupNameButton>
                    <span className="group-actions" onDoubleClick={event => event.stopPropagation()}>
                        <FilterActionHint blocked={p.filterEnabled} hint={msg('tags.filterManageNotice')}><button type="button" className="group-manage" aria-label={`${msg('tags.manage')}: ${group.name}`} disabled={locked || p.filterEnabled} onClick={() => setModal({ type: 'group', id: group.id })}><span aria-hidden="true">⋯</span></button></FilterActionHint>
                        <FilterActionHint blocked={p.filterEnabled} hint={msg('tags.filterDissolveNotice')}><button type="button" className="group-delete" aria-label={`${msg('tags.dissolve')}: ${group.name}`} data-tip={p.filterEnabled ? undefined : msg('tags.dissolve')} disabled={locked || p.filterEnabled} onClick={() => setModal({ type: 'dissolve', id: group.id })}><ActionIcon kind="trash"/></button></FilterActionHint>
                    </span>
                </InlineTagName>
            </div>
            {open && <div className="group-tags">{rows}</div>}
        </section>;
    }
    const modalGroup = modal && modal.type !== 'delete' ? groups.find(group => group.id === modal.id) : undefined;
    const modalTag = modal?.type === 'delete' ? p.library.tags.find(tag => tag.id === modal.id) : undefined;
    const levelRows=rowsFor(levelMembers);
    const ungrouped = new Set(p.library.tags.filter(tag => admitted.has(tag.id) && !tag.groupIds.length).map(tag => tag.id));
    const maxDepth=Math.max(0,...allRows.filter(({tag})=>view==='level'?(!levelMembers||levelMembers.has(tag.id)):admitted.has(tag.id)).map(row=>row.depth));
    function blocked(target: EventTarget | null) {
        const trigger = target instanceof Element ? target.closest<HTMLElement>('.library-filter,.group-toggle') : null;
        if (!p.filterEnabled || !trigger) return false;
        showActionHint(trigger, msg(trigger.classList.contains('group-toggle') ? 'tags.filterGroupEditNotice' : 'tags.filterEditNotice')); return true;
    }
    return <div className="tag-library" onDoubleClickCapture={event => { if (blocked(event.target)) { event.preventDefault(); event.stopPropagation(); } }}
        onPointerDownCapture={event => { if ((IS_MAC ? event.metaKey : event.ctrlKey) && blocked(event.target)) { event.preventDefault(); event.stopPropagation(); } }}
        onClickCapture={event => { if ((IS_MAC ? event.metaKey : event.ctrlKey) && blocked(event.target)) { event.preventDefault(); event.stopPropagation(); } }}
        onKeyDownCapture={event => { if (event.key === 'F2' && blocked(event.target)) { event.preventDefault(); event.stopPropagation(); } }} aria-busy={busy} data-tag-drag={drag ? drag.copy ? 'copy' : 'move' : undefined} onKeyDown={event => { if (event.key === ' ') event.stopPropagation(); }}>
        <div className="tag-view-toolbar"><div className="annotation-view-toggle"><button data-tag-view="level" className={view === 'level' ? 'is-active' : ''} onClick={() => setView('level')}>{msg('tags.all')}</button><button data-tag-view="groups" className={view === 'groups' ? 'is-active' : ''} onClick={() => setView('groups')}>{msg('tags.groups')}</button></div></div>
        <TagLibraryInput allowGroup={view === 'groups'} library={p.library} query={query} onQuery={value => { setQuery(value); setError(''); }} readOnly={locked} onCreate={p.onCreateTag} onCreateGroup={createGroup}/>
        {(p.loadError || error && !modal) && <p role="alert" className="tag-error">{p.loadError || error}</p>}
        <div className="group-tools tag-filter-tools">
            <FilterActionHint blocked={p.filterEnabled} hint={msg('tags.filterFoldNotice')}><button className="group-cycle" disabled={p.filterEnabled} aria-label={msg(p.filterEnabled || fullyExpanded ? 'tags.collapseAll' : 'tags.expandAll')} onClick={toggleAll}><TagChevron/></button></FilterActionHint>
            <div className="tag-filter-controls">
                <button className="tag-filter-toggle" aria-label={msg('tags.filterToggle')} aria-pressed={p.filterEnabled} data-tip={msg(p.filterEnabled ? 'tags.filterEnabled' : 'tags.filterDisabled')} onClick={() => p.onFilterEnabledChange(!p.filterEnabled)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={5 / 3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 4h18l-7 8v9l-4-2v-7Z"/></svg></button>
                {p.filterEnabled && <div className="tag-filter-mode" role="group" aria-label={msg('tags.filterMode')}>{(['and', 'or'] as const).map(mode => <button key={mode} aria-label={msg('tags.' + mode)} aria-pressed={p.filterMode === mode} onClick={() => p.onFilterModeChange(mode)}>{msg('tags.' + mode)}</button>)}</div>}
            </div>
            {view === 'level' && <TagScope value={scope} onChange={setScope}/>}
        </div>
        {view === 'level' && <div className={'tag-list-head'+(!showCount?' tag-list-head--no-count':'')}><button aria-label={msg('tags.sortName')} aria-sort={direction === 1 ? 'ascending' : 'descending'} onClick={() => setDirection(old => old === 1 ? -1 : 1)}>{msg('tags.name')}<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3"><path d={direction === 1 ? 'M8 13V3M4 7l4-4 4 4' : 'M8 3v10m-4-4 4 4 4-4'}/></svg></button>{showCount&&<span className="tag-count-heading">{msg('tags.count')}</span>}<span/></div>}
        <div ref={list} className={'library-list' + (view === 'level' ? ' library-list-all' : '')} style={{'--tag-row-min-width':`${maxDepth*16+180}px`} as React.CSSProperties}>
            {view === 'level' ? <>{levelRows.length?levelRows:<p className="annotation-empty tag-library-empty">{msg(query.trim()?'tags.noSearchResults':scope==='current'?'tags.noAdmitted':'tags.noTags')}</p>}{drag?.level && <div className={'tag-tree-root-drop' + (drag.target?.kind === 'tree' && drag.target.anchorId === null ? ' is-drop-target' : '')}/>}</>
                : <>{groups.map(groupNode)}{ungrouped.size > 0 && <section className="tag-ungrouped"><div className="ungrouped-divider"><span>{msg('tags.ungrouped')}</span></div>{(p.filterEnabled || !!query.trim() || !foldedGroups.has('ungrouped')) && <div className="group-tags">{rowsFor(ungrouped, 'ungrouped')}</div>}</section>}{drag?.kind === 'group' && <div className={'root-drop' + (drag.target?.kind === 'order' && drag.target.id === null ? ' is-drop-target' : '')}/>}</>}
        </div>
        {modal && <TagModal compact={modal.type !== 'group'} title={msg(modal.type === 'group' ? 'tags.manage' : modal.type === 'dissolve' ? 'tags.dissolve' : modal.scope === 'current' ? 'tags.removeCurrentBranch' : 'tags.deleteBranch')} descriptionId={modal.type === 'group' ? undefined : description} onClose={() => { if (!busy) { setModal(null); setError(''); } }}>
            {modal.type === 'group' && modalGroup ? <TagLibraryForm group={modalGroup} library={p.library} currentTagIds={p.currentTagIds} busy={busy} error={error} onCancel={() => { setModal(null); setError(''); }} onSave={async (name, ids) => {
                if (groups.some(group => group.id !== modalGroup.id && group.name.toLowerCase() === name.toLowerCase())) { setError(msg('tags.duplicate')); return; }
                await save({ ...p.library, groups: groups.map(group => group.id === modalGroup.id ? { ...group, name } : group), tags: p.library.tags.map(tag => ({ ...tag, groupIds: ids.has(tag.id) ? [...new Set([...tag.groupIds, modalGroup.id])] : tag.groupIds.filter(id => id !== modalGroup.id) })) });
            }}/> : <>
                <p className="trash-material-name">{modalGroup?.name ?? (modalTag&&<TagPill name={tagPath(p.library,modalTag.id)}/>)}</p>
                <p id={description} className="settings-hint">{msg(modal.type === 'dissolve' ? 'tags.dissolveNotice' : modal.type === 'delete' && modal.scope === 'current' ? 'tags.removeCurrentBranchNotice' : 'tags.deleteProjectBranchNotice')}</p>
                {error && <p role="alert" className="tag-error">{error}</p>}
                <div className="project-actions audio-project-footer"><button type="button" data-cancel className="button button--secondary" disabled={busy} onClick={() => { setModal(null); setError(''); }}>{msg('tags.cancel')}</button><button type="button" className="button button--danger" disabled={busy} onClick={() => {
                    if (confirming.current) return; confirming.current = true; setBusy(true);
                    const operation = Promise.resolve().then(()=>modal.type === 'dissolve' ? save(removeTagGroup(p.library, modal.id))
                        : modal.type === 'delete' && modal.scope === 'project' ? save(removeTagBranch(p.library, modal.id))
                        : modal.type === 'delete' ? p.onRemoveCurrent?.(modal.id) : undefined);
                    void operation.then(() => setModal(null), error => setError(tagErrorMessage(error))).finally(() => { confirming.current = false; setBusy(false); });
                }}>{msg(modal.type === 'dissolve' ? 'tags.dissolve' : modal.type==='delete'&&modal.scope==='current'?'tags.removeCurrent':'tags.delete')}</button></div>
            </>}
        </TagModal>}
    </div>;
}
export function TagScope({ value, onChange }: { value: 'current' | 'project'; onChange: (value: 'current' | 'project') => void }) {
    return <div className="tag-scope" role="group" aria-label={msg('tags.libraryScope')}>{(['current', 'project'] as const).map(scope => <button type="button" key={scope} aria-pressed={value === scope} onClick={() => onChange(scope)}>{msg(scope === 'current' ? 'tags.currentLibrary' : 'tags.projectLibrary')}</button>)}</div>;
}
function TagLibraryForm({ group, library, currentTagIds, busy, error, onSave, onCancel }: { group: TagGroup; library: TagLibrary; currentTagIds: readonly string[]; busy: boolean; error: string; onSave: (name: string, ids: Set<string>) => Promise<void>; onCancel: () => void }) {
    const [name, setName] = useState(group.name), [query, setQuery] = useState(''), [scope, setScope] = useState<'current' | 'project'>('current');
    const [checked, setChecked] = useState(new Set(library.tags.filter(tag => tag.groupIds.includes(group.id)).map(tag => tag.id)));
    const failure = useRef<HTMLParagraphElement>(null);
    useLayoutEffect(() => { if (error && !busy) failure.current?.focus(); }, [error, busy]);
    return <form onSubmit={event => { event.preventDefault(); if (name.trim()) void onSave(name.trim(), checked).catch(() => {}); }}>
        <label className="field"><span>{msg('tags.groupName')}</span><input data-dialog-initial-focus maxLength={120} value={name} onChange={event => setName(event.target.value)} disabled={busy}/></label>
        <label className="field"><input aria-label={msg('tags.search')} placeholder={msg('tags.search')} value={query} onChange={event => setQuery(event.target.value)}/></label>
        <div className="tag-form-scope"><TagScope value={scope} onChange={setScope}/></div>
        <TagMembershipTree library={library} memberIds={scope === 'current' ? new Set(currentTagIds) : undefined} query={query} checked={checked} disabled={busy} onToggle={(id, enabled) => setChecked(old => { const next = new Set(old); if (enabled) next.add(id); else next.delete(id); return next; })}/>
        {error && <p ref={failure} tabIndex={-1} role="alert" className="tag-error">{error}</p>}
        <div className="project-actions audio-project-footer"><button type="button" data-cancel disabled={busy} className="button button--secondary" onClick={onCancel}>{msg('tags.cancel')}</button><button className="button button--primary" disabled={busy || !name.trim()}>{msg('tags.save')}</button></div>
    </form>;
}
