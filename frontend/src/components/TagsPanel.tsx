import { useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { msg, useInterfaceLanguage } from '../i18n';
import { IS_MAC } from '../lib/format';
import { type ProjectTag, type TagLibrary, type TagGroup, moveTagGroup, removeTagGroup, transferTagGroup, sortTags } from '../lib/tags';
import { ActionIcon } from './ActionIcon';
import { GroupNameButton } from './GroupNameButton';
import { TagModal } from './TagModal';
import { GroupDeleteMenu } from './GroupDeleteMenu';
import { NewGroupInput } from './NewGroupInput';
import { TagPill } from './TagPill';
import { InlineTagName } from './InlineTagName';
import './tags.css';
export function TagChevron({ open }: {
    open: boolean;
}) { return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={open ? 'M3 10 8 5 13 10' : 'M3 6 8 11 13 6'}/></svg>; }
function SortIcon({ direction }: {
    direction: number;
}) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={direction === 1 ? 'M12 19V5m-4 4 4-4 4 4' : direction === -1 ? 'M12 5v14m-4-4 4 4 4-4' : 'M8 19V5l-3 3m3-3 3 3M16 5v14l-3-3m3 3 3-3'}/></svg>; }
interface Props {
    library: TagLibrary;
    onChange: (library: TagLibrary) => Promise<void>;
    onRenameTag?: (id: string, name: string) => Promise<void>;
    readOnly: boolean;
    filter: readonly string[];
    filterMode: 'and' | 'or';
    onFilterModeChange: (mode: 'and' | 'or') => void;
    filterEnabled: boolean;
    onFilterEnabledChange: (enabled: boolean) => void;
    onFilter: (id: string | null) => void;
    currentCount: (id: string) => number;
    projectCounts: Map<string, number> | null;
    countError: boolean;
    retryCounts: () => void;
}
type Modal = {
    type: 'group';
    id: string;
} | {
    type: 'delete-group';
    id: string;
    scope: 'tree' | 'level';
} | {
    type: 'delete-tag';
    id: string;
};
type Drop = {
    target: string | null;
    mode: 'before' | 'after' | 'inside';
};
export function TagsPanel(p: Props) {
    useInterfaceLanguage();
    const confirmationDescription = useId();
    const [newGroup, setNewGroup] = useState(false), newGroupTrigger = useRef<HTMLButtonElement>(null), returnToNewGroup = useRef(false);
    const [draggedTag, setDraggedTag] = useState<'move' | 'copy' | null>(null), [tagDrop, setTagDrop] = useState<string | null>(null);
    const tagGesture = useRef<{ id: string; source: string | null; copy: boolean; pointer: number; x: number; y: number; lastX: number; lastY: number; active: boolean; target: string | null } | null>(null), tagFrame = useRef<number | null>(null);
    const [view, setView] = useState<'all' | 'groups'>('all'), [query, setQuery] = useState(''), [sort, setSort] = useState<{
        key: 'name' | 'count';
        dir: 1 | -1;
    }>({ key: 'name', dir: 1 });
    const [collapsed, setCollapsed] = useState(new Set<string>()), [hiddenTags, setHiddenTags] = useState(new Set<string>()), [cycle, setCycle] = useState(-1), [modal, setModal] = useState<Modal | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [dragged, setDragged] = useState<string | null>(null), [drop, setDrop] = useState<Drop | null>(null);
    const list = useRef<HTMLDivElement>(null), gesture = useRef<{
        id: string;
        pointer: number;
        x: number;
        y: number;
        active: boolean;
        drop: Drop | null;
    } | null>(null), suppressClick = useRef(0);
    useLayoutEffect(() => { const el = list.current; if (!el)
        return; const sync = () => el.parentElement?.style.setProperty('--tag-scrollbar-width', `${el.offsetWidth - el.clientWidth}px`); sync(); const observer = new ResizeObserver(sync); observer.observe(el); return () => observer.disconnect(); }, []);
    useEffect(() => { const cancel = (e: KeyboardEvent | Event) => { if ('key' in e && e.key !== 'Escape')
        return; if (!gesture.current && !tagGesture.current)
        return; gesture.current = null; tagGesture.current = null; if (tagFrame.current !== null) cancelAnimationFrame(tagFrame.current); tagFrame.current = null; suppressClick.current = e.timeStamp + 500; setDragged(null); setDrop(null); setDraggedTag(null); setTagDrop(null); }; window.addEventListener('keydown', cancel); window.addEventListener('blur', cancel); return () => { gesture.current = null; tagGesture.current = null; if (tagFrame.current !== null) cancelAnimationFrame(tagFrame.current); window.removeEventListener('keydown', cancel); window.removeEventListener('blur', cancel); }; }, []);
    const locked = p.readOnly || busy;
    useLayoutEffect(() => { if (returnToNewGroup.current && !newGroup && !busy) { returnToNewGroup.current = false; newGroupTrigger.current?.focus(); } }, [newGroup, busy]);
    async function createGroup(name: string) {
        if (locked) throw new Error(msg('tags.saveFailed'));
        if (p.library.groups.some(group => !group.parentId && group.name === name)) throw new Error(msg('tags.duplicate'));
        setBusy(true); setError('');
        try {
            await p.onChange({ ...p.library, groups: [...p.library.groups, { id: crypto.randomUUID(), name, parentId: null }] });
            returnToNewGroup.current = true; setQuery(''); setNewGroup(false); setCycle(-1);
        } catch { throw new Error(msg('tags.saveFailed')); }
        finally { setBusy(false); }
    }
    async function save(next: TagLibrary) { if (locked)
        return; setBusy(true); setError(''); try {
        await p.onChange(next);
        setModal(null);
    }
    catch {
        setError(msg('tags.saveFailed'));
    }
    finally {
        setBusy(false);
    } }
    function toggle(id: string) { const shut = collapsed.has(id) || (hiddenTags.has(id) && !p.library.groups.some(g => g.parentId === id)); setCycle(-1); setCollapsed(old => { const next = new Set(old); if (shut)
        next.delete(id);
    else
        next.add(id); return next; }); if (shut)
        setHiddenTags(old => { const next = new Set(old); next.delete(id); return next; }); }
    const nextCycle = cycle < 0 ? 0 : (cycle + 1) % 3, cycleLabels = ['tags.cycleAll', 'tags.cycleHeadings', 'tags.cycleRoots'];
    function cycleGroups() { const ids = p.library.groups.map(g => g.id).concat('ungrouped'); setCycle(nextCycle); setCollapsed(new Set(nextCycle === 2 ? ids : [])); setHiddenTags(new Set(nextCycle === 0 ? [] : ids)); }
    function finishDrag(e?: PointerEvent<HTMLButtonElement>, commit = true) { const g = gesture.current; gesture.current = null; setDragged(null); setDrop(null); if (!g)
        return; suppressClick.current = (e?.timeStamp ?? 0) + 500; if (e)
        e.currentTarget.releasePointerCapture?.(g.pointer); if (commit && e && g.active && g.drop)
        void save(moveTagGroup(p.library, g.id, g.drop.target, g.drop.mode)); }
    function startDrag(e: PointerEvent<HTMLButtonElement>, id: string) { if (locked || e.button !== 0 || !(IS_MAC ? e.metaKey : e.ctrlKey))
        return; e.preventDefault(); gesture.current = { id, pointer: e.pointerId, x: e.clientX, y: e.clientY, active: false, drop: null }; e.currentTarget.setPointerCapture(e.pointerId); }
    function moveDrag(e: PointerEvent<HTMLButtonElement>) {
        const g = gesture.current;
        if (!g)
            return;
        if (!g.active && Math.hypot(e.clientX - g.x, e.clientY - g.y) < 5)
            return;
        g.active = true;
        setDragged(g.id);
        suppressClick.current = (e?.timeStamp ?? 0) + 500;
        let section = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-tag-group]'), next: Drop | null = null;
        if (section) {
            let rect = section!.querySelector<HTMLElement>(':scope > .tag-group-header')!.getBoundingClientRect(), out = false;
            while (e.clientX < rect.left + 16) {
                const parent: HTMLElement | null | undefined = section!.parentElement?.closest<HTMLElement>('[data-tag-group]');
                if (!parent)
                    break;
                section = parent;
                rect = section!.querySelector<HTMLElement>(':scope > .tag-group-header')!.getBoundingClientRect();
                out = true;
            }
            const target = section!.dataset.tagGroup!, ratio = (e.clientY - rect.top) / rect.height, mode = out || ratio > .75 ? 'after' : ratio < .25 ? 'before' : 'inside';
            const candidate = moveTagGroup(p.library, g.id, target, mode);
            if (candidate !== p.library)
                next = { target, mode };
        }
        else if (document.elementFromPoint(e.clientX, e.clientY)?.closest('.root-drop'))
            next = { target: null, mode: 'after' };
        g.drop = next;
        setDrop(next);
    }
    function findTagTarget() {
        const gesture = tagGesture.current;
        if (!gesture?.active) return;
        const id = document.elementFromPoint(gesture.lastX, gesture.lastY)?.closest<HTMLElement>('[data-tag-group]')?.dataset.tagGroup;
        gesture.target = id && transferTagGroup(p.library, gesture.id, gesture.source, id, gesture.copy) !== p.library ? id : null;
        setTagDrop(gesture.target);
    }
    function tagScrollTick() {
        const gesture = tagGesture.current, element = list.current;
        if (!gesture?.active || !element) { tagFrame.current = null; return; }
        const rect = element.getBoundingClientRect();
        const speed = gesture.lastY < rect.top + 24 ? -12 : gesture.lastY > rect.bottom - 24 ? 12 : 0;
        if (speed) { element.scrollTop += speed; findTagTarget(); }
        tagFrame.current = requestAnimationFrame(tagScrollTick);
    }
    function startTagDrag(e: PointerEvent<HTMLButtonElement>, id: string, source: string) {
        if (locked || e.button !== 0 || !(IS_MAC ? e.metaKey : e.ctrlKey)) return;
        e.preventDefault(); e.stopPropagation();
        tagGesture.current = { id, source: source === 'ungrouped' ? null : source, copy: source !== 'ungrouped' && e.shiftKey, pointer: e.pointerId, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, active: false, target: null };
        e.currentTarget.setPointerCapture(e.pointerId);
    }
    function moveTagDrag(e: PointerEvent<HTMLButtonElement>) {
        const gesture = tagGesture.current;
        if (!gesture) return;
        e.stopPropagation(); gesture.lastX = e.clientX; gesture.lastY = e.clientY;
        if (!gesture.active && Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) < 5) return;
        if (!gesture.active) {
            gesture.active = true; setDraggedTag(gesture.copy ? 'copy' : 'move');
            if (typeof requestAnimationFrame === 'function') tagFrame.current = requestAnimationFrame(tagScrollTick);
        }
        suppressClick.current = e.timeStamp + 500; findTagTarget();
    }
    function finishTagDrag(e: PointerEvent<HTMLButtonElement>, commit = true) {
        const gesture = tagGesture.current; tagGesture.current = null;
        if (!gesture) return;
        e.stopPropagation(); e.currentTarget.releasePointerCapture?.(gesture.pointer);
        if (tagFrame.current !== null) cancelAnimationFrame(tagFrame.current); tagFrame.current = null;
        setDraggedTag(null); setTagDrop(null);
        if (gesture.active) suppressClick.current = e.timeStamp + 500;
        if (commit && gesture.active && gesture.target) void save(transferTagGroup(p.library, gesture.id, gesture.source, gesture.target, gesture.copy));
    }
    function row(tag: ProjectTag, gid?: string) {
        const current = p.currentCount(tag.id), project = p.projectCounts?.get(tag.id) ?? 0;
        return <div className="library-tag-row" key={tag.id} data-tag-id={tag.id}>
  <span className={'tag-pill library-pill' + (gid && gid !== 'ungrouped' ? ' tag-pill--removable' : '') + (p.filterEnabled && p.filter.includes(tag.id) ? ' is-filtered' : '')}><InlineTagName name={tag.name} enabled={!p.filterEnabled && !locked} onRename={p.onRenameTag ? name=>p.onRenameTag!(tag.id,name) : undefined} canBegin={time=>time >= suppressClick.current && !tagGesture.current && !gesture.current}><button className="library-filter" aria-label={`${msg('tags.title')}: ${tag.name}`} aria-pressed={p.filterEnabled && p.filter.includes(tag.id)} onPointerDown={e => { if (gid) startTagDrag(e, tag.id, gid); }} onPointerMove={moveTagDrag} onPointerUp={e => finishTagDrag(e)} onPointerCancel={e => finishTagDrag(e, false)} onClick={e => { if (p.filterEnabled && e.detail < 2 && e.timeStamp >= suppressClick.current && !e.metaKey && !e.ctrlKey) p.onFilter(tag.id); }}>{tag.name}</button></InlineTagName>{gid && gid !== 'ungrouped' && <button className="group-tag-remove tag-pill-remove" onDoubleClick={e=>e.stopPropagation()} disabled={locked} aria-label={`${msg('tags.remove')}: ${tag.name}`} onClick={e => { e.stopPropagation(); if(e.detail >= 2) return; void save({ ...p.library, tags: p.library.tags.map(t => t.id === tag.id ? { ...t, groupIds: t.groupIds.filter(id => id !== gid) } : t) }); }}>×</button>}</span>
  <span className="tag-count" aria-label={p.projectCounts ? msg('tags.countDescription', { current, project }) : msg(p.countError ? 'tags.countFailed' : 'tags.countLoading')} data-action-tip={p.projectCounts ? msg('tags.countDescription', { current, project }) : undefined}>{current}/{p.projectCounts ? project : '–'}</span>
  <span className="library-action-slot">{!gid && <button className="library-delete" disabled={locked} aria-label={`${msg('tags.deleteTag')}: ${tag.name}`} data-tip={msg('tags.deleteTag')} onClick={() => setModal({ type: 'delete-tag', id: tag.id })}><ActionIcon kind="trash"/></button>}</span></div>;
    }
    function groupNode(group: TagGroup, inherited = false): React.ReactNode {
        const match = inherited || group.name.toLowerCase().includes(query.toLowerCase()), tags = sortTags(p.library.tags.filter(t => t.groupIds.includes(group.id) && (match || t.name.toLowerCase().includes(query.toLowerCase()))), 'name', 1, p.currentCount), children = p.library.groups.filter(g => g.parentId === group.id).map(g => groupNode(g, match)).filter(Boolean);
        if (query && !match && !tags.length && !children.length)
            return null;
        const shut = collapsed.has(group.id) || (hiddenTags.has(group.id) && !children.length);
        return <section className={'tag-group' + (drop?.target === group.id ? ' drop-' + drop.mode : '') + (tagDrop === group.id ? ' tag-drop-target' : '')} data-tag-group={group.id} key={group.id}><div className="tag-group-header"><button className="group-collapse" aria-label={group.name} aria-expanded={!shut} onClick={() => toggle(group.id)}><TagChevron open={!shut}/></button><GroupNameButton className={'group-toggle' + (dragged === group.id ? ' is-dragging' : '')} isMac={IS_MAC} dragEnabled={!locked} dragging={!!dragged || !!draggedTag} aria-label={group.name} aria-expanded={!shut} onPointerDown={e => startDrag(e, group.id)} onPointerMove={moveDrag} onPointerUp={e => finishDrag(e)} onPointerCancel={e => finishDrag(e, false)} onKeyDown={e => { if (e.key === 'Escape') {
            finishDrag();
            return;
        } if (e.altKey && !locked) {
            const siblings = p.library.groups.filter(g => g.parentId === group.parentId), index = siblings.findIndex(g => g.id === group.id);
            let next: TagLibrary | undefined;
            if (e.key === 'ArrowLeft' && group.parentId)
                next = moveTagGroup(p.library, group.id, group.parentId, 'after');
            if (e.key === 'ArrowRight' && index > 0)
                next = moveTagGroup(p.library, group.id, siblings[index - 1].id, 'inside');
            if (e.key === 'ArrowUp' && index > 0)
                next = moveTagGroup(p.library, group.id, siblings[index - 1].id, 'before');
            if (e.key === 'ArrowDown' && index < siblings.length - 1)
                next = moveTagGroup(p.library, group.id, siblings[index + 1].id, 'after');
            if (next) {
                e.preventDefault();
                void save(next);
            }
        } }} onClick={e => { if (e.timeStamp < suppressClick.current || e.metaKey || e.ctrlKey)
            return; toggle(group.id); }}><span className="group-name" data-tip-anchor>{group.name}</span></GroupNameButton><span className="group-actions"><button className="group-manage" aria-label={`${msg('tags.manage')}: ${group.name}`} disabled={locked} onClick={() => setModal({ type: 'group', id: group.id })}><span aria-hidden="true">⋯</span></button><GroupDeleteMenu name={group.name} disabled={locked} onChoose={scope => setModal({ type: 'delete-group', id: group.id, scope })}/></span></div>{!shut && <div className="tag-group-content">{!hiddenTags.has(group.id) && <div className="group-tags">{tags.map(t => row(t, group.id))}</div>}{children}</div>}</section>;
    }
    const modalGroup = modal && 'id' in modal ? p.library.groups.find(g => g.id === modal.id) : undefined, modalTag = modal && 'id' in modal ? p.library.tags.find(t => t.id === modal.id) : undefined;
    const ungrouped = sortTags(p.library.tags.filter(tag => !tag.groupIds.length && tag.name.toLowerCase().includes(query.toLowerCase())), 'name', 1, p.currentCount);
    return <div className="tag-library" aria-busy={busy} data-tag-drag={draggedTag ?? undefined} onKeyDown={e => { if (e.key === ' ') e.stopPropagation(); }}>
  <div className="tag-view-toolbar"><div className="annotation-view-toggle"><button className={view === 'all' ? 'is-active' : ''} onClick={() => setView('all')}>{msg('tags.all')}</button><button className={view === 'groups' ? 'is-active' : ''} onClick={() => setView('groups')}>{msg('tags.groups')}</button></div></div>
  <div className="tag-search"><input aria-label={msg('tags.search')} placeholder={msg('tags.search')} value={query} onChange={e => setQuery(e.target.value)}/></div>
  {p.countError && <p role="alert" className="tag-error">{msg('tags.countFailed')} <button onClick={p.retryCounts}>{msg('tags.retry')}</button></p>}
  {error && !modal && <p role="alert" className="tag-error">{error}</p>}

  <div className="group-tools tag-filter-tools"><div className="tag-filter-controls">{view === 'groups' ? <button className="group-cycle" aria-label={msg(cycleLabels[nextCycle])} onClick={cycleGroups}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 2 4 3 4-3M4 14l4-3 4 3M3 8h10"/></svg></button> : <span className="group-cycle-placeholder" aria-hidden="true"/>}<button className="tag-filter-toggle" aria-label={msg('tags.filterToggle')} aria-pressed={p.filterEnabled} data-tip={msg(p.filterEnabled ? 'tags.filterEnabled' : 'tags.filterDisabled')} onClick={() => p.onFilterEnabledChange(!p.filterEnabled)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 4h18l-7 8v9l-4-2v-7Z"/></svg></button>{p.filterEnabled && <div className="tag-filter-mode" role="group" aria-label={msg('tags.filterMode')}><button aria-label={msg('tags.and')} aria-pressed={p.filterMode === 'and'} data-action-tip={msg('tags.andHint')} onClick={() => p.onFilterModeChange('and')}>{msg('tags.and')}</button><button aria-label={msg('tags.or')} aria-pressed={p.filterMode === 'or'} data-action-tip={msg('tags.orHint')} onClick={() => p.onFilterModeChange('or')}>{msg('tags.or')}</button></div>}</div>{view === 'groups' && <><button ref={newGroupTrigger} hidden={newGroup} disabled={locked} onClick={() => setNewGroup(true)}>＋ {msg('tags.newGroup')}</button>{newGroup && <NewGroupInput busy={locked} onCreate={createGroup} onCancel={reason => { returnToNewGroup.current = reason === 'escape'; setNewGroup(false); }}/>}</>}</div>
  {view === 'all' ? <div className="tag-list-head"><button aria-label={msg('tags.sortName')} aria-sort={sort.key === 'name' ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined} onClick={() => setSort({ key: 'name', dir: sort.key === 'name' && sort.dir === 1 ? -1 : 1 })}>{msg('tags.name')}<SortIcon direction={sort.key === 'name' ? sort.dir : 0}/></button><button aria-label={msg('tags.sortCount')} onClick={() => setSort({ key: 'count', dir: sort.key === 'count' && sort.dir === -1 ? 1 : -1 })}>{msg('tags.count')}<SortIcon direction={sort.key === 'count' ? sort.dir : 0}/></button><span className="delete-column"/></div> : null}
  <div ref={list} className={'library-list' + (view === 'all' ? ' library-list-all' : '')}>{view === 'all' ? sortTags(p.library.tags.filter(t => t.name.toLowerCase().includes(query.toLowerCase())), sort.key, sort.dir, p.currentCount).map(t => row(t)) : <>{p.library.groups.filter(g => !g.parentId).map(g => groupNode(g))}{ungrouped.length > 0 && !hiddenTags.has('ungrouped') && <section className="tag-ungrouped"><div className="ungrouped-divider"><span>{msg('tags.ungrouped')}</span></div><div className="group-tags">{ungrouped.map(tag => row(tag, 'ungrouped'))}</div></section>}{dragged && <div className={'root-drop' + (drop?.target === null ? ' is-drop-target' : '')}/>}</>}</div>
  {modal && <TagModal descriptionId={modal.type === 'delete-group' || modal.type === 'delete-tag' ? confirmationDescription : undefined} title={msg(modal.type === 'group' ? 'tags.manage' : modal.type === 'delete-group' ? (modal.scope === 'tree' ? 'tags.deleteGroupTree' : 'tags.deleteGroupLevel') : 'tags.deleteTag')} onClose={() => { if (!busy) {
            setModal(null);
            setError('');
        } }}>
   {modal.type === 'group' ? <TagLibraryForm key={JSON.stringify(modal)} group={modal.type === 'group' ? modalGroup : undefined} library={p.library} busy={busy} error={error} onCancel={() => { setModal(null); setError(''); }} onSave={(name, ids) => {
                        if (p.library.groups.some(g => g.id !== modalGroup?.id && g.parentId === (modalGroup?.parentId ?? null) && g.name === name)) {
                            setError(msg('tags.duplicate'));
                            return;
                        }
                        const id = modalGroup?.id ?? crypto.randomUUID();
                        void save({ ...p.library, groups: modalGroup ? p.library.groups.map(g => g.id === id ? { ...g, name } : g) : [...p.library.groups, { id, name, parentId: null }], tags: modalGroup ? p.library.tags.map(t => ({ ...t, groupIds: ids.has(t.id) ? [...new Set([...t.groupIds, id])] : t.groupIds.filter(g => g !== id) })) : p.library.tags });
                }}/> : <><p className="trash-material-name">{modalTag ? <TagPill name={modalTag.name}/> : modalGroup?.name}</p><p id={confirmationDescription} className="settings-hint">{msg(modal.type === 'delete-tag' ? 'tags.deleteTagNotice' : modal.scope === 'tree' ? 'tags.deleteGroupTreeNotice' : 'tags.deleteGroupLevelNotice')}</p>{error && <p role="alert" className="tag-error">{error}</p>}<div className="project-actions audio-project-footer"><button data-cancel className="button button--secondary" disabled={busy} onClick={() => setModal(null)}>{msg('tags.cancel')}</button><button className="button button--danger" disabled={busy} onClick={() => { if (modal.type === 'delete-tag')
                void save({ ...p.library, tags: p.library.tags.filter(t => t.id !== modal.id) });
            else if (modal.type === 'delete-group')
                void save(removeTagGroup(p.library, modal.id, modal.scope)); }}>{msg('tags.delete')}</button></div></>}
  </TagModal>}
 </div>;
}
function TagLibraryForm({ group, library, busy, error, onSave, onCancel }: {
    group?: TagGroup;
    library: TagLibrary;
    busy: boolean;
    error: string;
    onSave: (name: string, ids: Set<string>) => void;
    onCancel: () => void;
}) {
    const [name, setName] = useState(group?.name ?? ''), [query, setQuery] = useState(''), [checked, setChecked] = useState(new Set(library.tags.filter(t => group && t.groupIds.includes(group.id)).map(t => t.id)));
    return <form onSubmit={e => { e.preventDefault(); if (name.trim())
        onSave(name.trim(), checked); }}><label className="field"><span>{msg('tags.groupName')}</span><input data-dialog-initial-focus maxLength={120} value={name} onChange={e => setName(e.target.value)} disabled={busy}/></label>{group && <><p className="settings-hint">{msg('tags.members')}</p><label className="field"><input aria-label={msg('tags.search')} placeholder={msg('tags.search')} value={query} onChange={e => setQuery(e.target.value)}/></label><div className="tag-check-list">{sortTags(library.tags.filter(t => t.name.toLowerCase().includes(query.toLowerCase())), 'name', 1, () => 0).map(t => <label className="tag-check" key={t.id}><input type="checkbox" className="ripple-checkbox" disabled={busy} checked={checked.has(t.id)} onChange={e => setChecked(old => { const next = new Set(old); if (e.target.checked)
        next.add(t.id);
    else
        next.delete(t.id); return next; })}/><TagPill name={t.name}/></label>)}</div></>}{error && <p role="alert" className="tag-error">{error}</p>}<div className="project-actions audio-project-footer"><button data-cancel type="button" disabled={busy} className="button button--secondary" onClick={onCancel}>{msg('tags.cancel')}</button><button className="button button--primary" disabled={busy || !name.trim()}>{msg('tags.save')}</button></div></form>;
}
