import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { msg, useInterfaceLanguage } from '../i18n';
import { IS_MAC } from '../lib/format';
import { type ProjectTag, type TagLibrary, type TagGroup, moveTagGroup, removeTagGroup, sortTags } from '../lib/tags';
import { ActionIcon } from './ActionIcon';
import { GroupNameButton } from './GroupNameButton';
import { TagModal } from './TagModal';
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
    readOnly: boolean;
    filter: string | null;
    onFilter: (id: string | null) => void;
    currentCount: (id: string) => number;
    projectCounts: Map<string, number> | null;
    countError: boolean;
    retryCounts: () => void;
}
type Modal = {
    type: 'new';
} | {
    type: 'group';
    id: string;
} | {
    type: 'delete-group';
    id: string;
} | {
    type: 'delete-tag';
    id: string;
} | {
    type: 'rename';
    id: string;
};
type Drop = {
    target: string | null;
    mode: 'before' | 'after' | 'inside';
};
export function TagsPanel(p: Props) {
    useInterfaceLanguage();
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
        return; if (!gesture.current)
        return; gesture.current = null; suppressClick.current = e.timeStamp + 500; setDragged(null); setDrop(null); }; window.addEventListener('keydown', cancel); window.addEventListener('blur', cancel); return () => { gesture.current = null; window.removeEventListener('keydown', cancel); window.removeEventListener('blur', cancel); }; }, []);
    const locked = p.readOnly || busy;
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
    function row(tag: ProjectTag, gid?: string) {
        const current = p.currentCount(tag.id), project = p.projectCounts?.get(tag.id) ?? 0;
        return <div className="library-tag-row" key={tag.id} data-tag-id={tag.id}>
  <span className={'tag-pill library-pill' + (p.filter === tag.id ? ' is-filtered' : '')}><button className="library-filter" aria-label={`${msg('tags.title')}: ${tag.name}`} aria-pressed={p.filter === tag.id} onClick={() => p.onFilter(p.filter === tag.id ? null : tag.id)} onContextMenu={e => { if (!locked) {
            e.preventDefault();
            setModal({ type: 'rename', id: tag.id });
        } }} onKeyDown={e => { if (e.key === 'F2' && !locked) {
            e.preventDefault();
            setModal({ type: 'rename', id: tag.id });
        } }}>{tag.name}</button>{gid && gid !== 'ungrouped' && <button className="group-tag-remove" disabled={locked} aria-label={`${msg('tags.remove')}: ${tag.name}`} onClick={e => { e.stopPropagation(); void save({ ...p.library, tags: p.library.tags.map(t => t.id === tag.id ? { ...t, groupIds: t.groupIds.filter(id => id !== gid) } : t) }); }}>×</button>}</span>
  <span className="tag-count" aria-label={p.projectCounts ? msg('tags.countDescription', { current, project }) : msg(p.countError ? 'tags.countFailed' : 'tags.countLoading')} title={p.projectCounts ? msg('tags.countDescription', { current, project }) : undefined}>{current}/{p.projectCounts ? project : '–'}</span>
  {!gid && <button className="library-delete" disabled={locked} aria-label={`${msg('tags.deleteTag')}: ${tag.name}`} data-tip={msg('tags.deleteTag')} onClick={() => setModal({ type: 'delete-tag', id: tag.id })}><ActionIcon kind="trash"/></button>}</div>;
    }
    function groupNode(group: TagGroup, inherited = false): React.ReactNode {
        const match = inherited || group.name.toLowerCase().includes(query.toLowerCase()), tags = sortTags(p.library.tags.filter(t => t.groupIds.includes(group.id) && (match || t.name.toLowerCase().includes(query.toLowerCase()))), 'name', 1, p.currentCount), children = p.library.groups.filter(g => g.parentId === group.id).map(g => groupNode(g, match)).filter(Boolean);
        if (query && !match && !tags.length && !children.length)
            return null;
        const shut = collapsed.has(group.id) || (hiddenTags.has(group.id) && !children.length);
        return <section className={'tag-group' + (drop?.target === group.id ? ' drop-' + drop.mode : '')} data-tag-group={group.id} key={group.id}><div className="tag-group-header"><button className="group-collapse" aria-label={group.name} aria-expanded={!shut} onClick={() => toggle(group.id)}><TagChevron open={!shut}/></button><GroupNameButton className={'group-toggle' + (dragged === group.id ? ' is-dragging' : '')} isMac={IS_MAC} dragging={!!dragged} aria-label={group.name} aria-expanded={!shut} onPointerDown={e => startDrag(e, group.id)} onPointerMove={moveDrag} onPointerUp={e => finishDrag(e)} onPointerCancel={e => finishDrag(e, false)} onKeyDown={e => { if (e.key === 'Escape') {
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
            return; toggle(group.id); }}><span className="group-name">{group.name}</span></GroupNameButton><button className="group-manage" aria-label={`${msg('tags.manage')}: ${group.name}`} disabled={locked} onClick={() => setModal({ type: 'group', id: group.id })}><span aria-hidden="true">⋯</span></button></div>{!shut && <div className="tag-group-content">{!hiddenTags.has(group.id) && <div className="group-tags">{tags.map(t => row(t, group.id))}</div>}{children}</div>}</section>;
    }
    const modalGroup = modal && 'id' in modal ? p.library.groups.find(g => g.id === modal.id) : undefined, modalTag = modal && 'id' in modal ? p.library.tags.find(t => t.id === modal.id) : undefined;
    return <div className="tag-library" aria-busy={busy}>
  <div className="annotation-view-toggle"><button className={view === 'all' ? 'is-active' : ''} onClick={() => setView('all')}>{msg('tags.all')}</button><button className={view === 'groups' ? 'is-active' : ''} onClick={() => setView('groups')}>{msg('tags.groups')}</button></div>
  <div className="tag-search"><input aria-label={msg('tags.search')} placeholder={msg('tags.search')} value={query} onChange={e => setQuery(e.target.value)}/></div>
  {p.filter && <button className="tag-clear-compact" onClick={() => p.onFilter(null)}>{msg('tags.clear')}</button>}
  {p.countError && <p role="alert" className="tag-error">{msg('tags.countFailed')} <button onClick={p.retryCounts}>{msg('tags.retry')}</button></p>}
  {error && !modal && <p role="alert" className="tag-error">{error}</p>}
  {view === 'all' ? <div className="tag-list-head"><button aria-label={msg('tags.sortName')} aria-sort={sort.key === 'name' ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined} onClick={() => setSort({ key: 'name', dir: sort.key === 'name' && sort.dir === 1 ? -1 : 1 })}>{msg('tags.name')}<SortIcon direction={sort.key === 'name' ? sort.dir : 0}/></button><button aria-label={msg('tags.sortCount')} onClick={() => setSort({ key: 'count', dir: sort.key === 'count' && sort.dir === -1 ? 1 : -1 })}>{msg('tags.count')}<SortIcon direction={sort.key === 'count' ? sort.dir : 0}/></button><span className="delete-column"/></div> : <div className="group-tools"><button className="group-cycle" aria-label={msg(cycleLabels[nextCycle])} onClick={cycleGroups}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 2 4 3 4-3M4 14l4-3 4 3M3 8h10"/></svg></button><button disabled={locked} onClick={() => setModal({ type: 'new' })}>＋ {msg('tags.newGroup')}</button></div>}
  <div ref={list} className={'library-list' + (view === 'all' ? ' library-list-all' : '')}>{view === 'all' ? sortTags(p.library.tags.filter(t => t.name.toLowerCase().includes(query.toLowerCase())), sort.key, sort.dir, p.currentCount).map(t => row(t)) : <>{p.library.groups.filter(g => !g.parentId).map(g => groupNode(g))}<section className="tag-group"><div className="tag-group-header"><button className="group-collapse" aria-label={msg('tags.ungrouped')} aria-expanded={!collapsed.has('ungrouped') && !hiddenTags.has('ungrouped')} onClick={() => toggle('ungrouped')}><TagChevron open={!collapsed.has('ungrouped') && !hiddenTags.has('ungrouped')}/></button><button className="group-toggle" onClick={() => toggle('ungrouped')}>{msg('tags.ungrouped')}</button></div>{!collapsed.has('ungrouped') && !hiddenTags.has('ungrouped') && <div className="group-tags">{sortTags(p.library.tags.filter(t => !t.groupIds.length && t.name.toLowerCase().includes(query.toLowerCase())), 'name', 1, p.currentCount).map(t => row(t, 'ungrouped'))}</div>}</section>{dragged && <div className={'root-drop' + (drop?.target === null ? ' is-drop-target' : '')}/>}</>}</div>
  {modal && <TagModal title={msg(modal.type === 'new' ? 'tags.newGroup' : modal.type === 'group' ? 'tags.manage' : modal.type === 'delete-group' ? 'tags.deleteGroup' : modal.type === 'rename' ? 'tags.renameTag' : 'tags.deleteTag')} onClose={() => { if (!busy) {
            setModal(null);
            setError('');
        } }}>
   {modal.type === 'new' || modal.type === 'group' || modal.type === 'rename' ? <TagLibraryForm key={JSON.stringify(modal)} group={modal.type === 'group' ? modalGroup : undefined} tag={modal.type === 'rename' ? modalTag : undefined} library={p.library} busy={busy} error={error} onCancel={() => { setModal(null); setError(''); }} onDelete={modalGroup ? () => setModal({ type: 'delete-group', id: modalGroup.id }) : undefined} onSave={(name, ids) => {
                    if (modal.type === 'rename' && modalTag) {
                        if (p.library.tags.some(t => t.id !== modalTag.id && t.name.toLowerCase() === name.toLowerCase())) {
                            setError(msg('tags.duplicate'));
                            return;
                        }
                        void save({ ...p.library, tags: p.library.tags.map(t => t.id === modalTag.id ? { ...t, name } : t) });
                    }
                    else {
                        if (p.library.groups.some(g => g.id !== modalGroup?.id && g.parentId === (modalGroup?.parentId ?? null) && g.name === name)) {
                            setError(msg('tags.duplicate'));
                            return;
                        }
                        const id = modalGroup?.id ?? crypto.randomUUID();
                        void save({ ...p.library, groups: modalGroup ? p.library.groups.map(g => g.id === id ? { ...g, name } : g) : [...p.library.groups, { id, name, parentId: null }], tags: modalGroup ? p.library.tags.map(t => ({ ...t, groupIds: ids.has(t.id) ? [...new Set([...t.groupIds, id])] : t.groupIds.filter(g => g !== id) })) : p.library.tags });
                    }
                }}/> : <><p>{msg(modal.type === 'delete-tag' ? 'tags.deleteTagNotice' : 'tags.deleteGroupNotice')}</p><p>{modalTag?.name ?? modalGroup?.name}</p>{error && <p role="alert" className="tag-error">{error}</p>}<div className="project-actions audio-project-footer"><button data-cancel className="button button--secondary" disabled={busy} onClick={() => setModal(null)}>{msg('tags.cancel')}</button><button className="button button--danger" disabled={busy} onClick={() => { if (modal.type === 'delete-tag')
                void save({ ...p.library, tags: p.library.tags.filter(t => t.id !== modal.id) });
            else if (modal.type === 'delete-group')
                void save(removeTagGroup(p.library, modal.id)); }}>{msg('tags.delete')}</button></div></>}
  </TagModal>}
 </div>;
}
function TagLibraryForm({ group, tag, library, busy, error, onSave, onCancel, onDelete }: {
    group?: TagGroup;
    tag?: ProjectTag;
    library: TagLibrary;
    busy: boolean;
    error: string;
    onSave: (name: string, ids: Set<string>) => void;
    onCancel: () => void;
    onDelete?: () => void;
}) {
    const [name, setName] = useState(group?.name ?? tag?.name ?? ''), [query, setQuery] = useState(''), [checked, setChecked] = useState(new Set(library.tags.filter(t => group && t.groupIds.includes(group.id)).map(t => t.id)));
    return <form onSubmit={e => { e.preventDefault(); if (name.trim())
        onSave(name.trim(), checked); }}><label className="field"><span>{msg(tag ? 'tags.name' : 'tags.groupName')}</span><input maxLength={120} value={name} onChange={e => setName(e.target.value)} disabled={busy}/></label>{group && <><p className="settings-hint">{msg('tags.members')}</p><label className="field"><input aria-label={msg('tags.search')} placeholder={msg('tags.search')} value={query} onChange={e => setQuery(e.target.value)}/></label><div className="tag-check-list">{sortTags(library.tags.filter(t => t.name.toLowerCase().includes(query.toLowerCase())), 'name', 1, () => 0).map(t => <label className="tag-check" key={t.id}><input type="checkbox" className="ripple-checkbox" disabled={busy} checked={checked.has(t.id)} onChange={e => setChecked(old => { const next = new Set(old); if (e.target.checked)
        next.add(t.id);
    else
        next.delete(t.id); return next; })}/><span className="tag-pill">{t.name}</span></label>)}</div></>}{error && <p role="alert" className="tag-error">{error}</p>}<div className="project-actions audio-project-footer">{onDelete && <button type="button" disabled={busy} className="button button--danger" onClick={onDelete}>{msg('tags.deleteGroup')}</button>}<button data-cancel type="button" disabled={busy} className="button button--secondary" onClick={onCancel}>{msg('tags.cancel')}</button><button className="button button--primary" disabled={busy || !name.trim()}>{msg('tags.save')}</button></div></form>;
}
