import {isSharedTagRestriction,showSharedTagRestriction} from '../lib/sharedTagGuard';
import { useTagCreationReveal } from '../hooks/useTagCreationReveal';
import { TAG_TREE_STEP } from '../lib/tagEdgeGeometry';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { msg, useInterfaceLanguage } from '../i18n';
import { IS_MAC } from '../lib/format';
import { type ProjectTag, type TagLibrary, tagTreeRows, tagAncestors, tagPath, descendantTagIds, removeTagBranch, suggestTags } from '../lib/tags';
import { type TagOrderView } from '../lib/tagOrdering';
import type { TagCollection } from '../lib/tagCollections';
import { tagErrorMessage } from '../lib/tagErrors';
import { TagLibraryInput } from './TagLibraryInput';
import { TagLibraryPill } from './TagLibraryPill';
import { TagDeleteControl } from './TagDeleteControl';
import { TagModal } from './TagModal';
import { InlineTagName } from './InlineTagName';
import { TagTreeGuides } from './TagTreeGuides';
import { useTagTreeLayout } from './useTagTreeLayout';
import { tagTreeGuides, type TagGuide } from '../lib/tagTreeGuides';
import { showActionHint } from '../lib/actionHint';
import { TagPill } from './TagPill';
import { FilterActionHint } from './FilterActionHint';
import './tags.css';

export function TagChevron() {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={5 / 3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 4 9 5 9-5m-18 16 9-5 9 5"/></svg>;
}
interface Props {
    countVersionId?:string;loadProjectCounts?:(currentId?:string)=>Promise<import('../lib/tagCountCache').TagCountTotals>;projectRevision?:number;
    versionKey?: string; collection?: TagCollection;
    sharedStructureHint?:string|null;
    onSortName?: (view: 'level' | 'groups') => Promise<void>;
    onReorder?: (view: TagOrderView, id: string, anchor: string | null, after: boolean, groupId?: string) => Promise<void>;
    loadError?: string; library: TagLibrary; currentTagIds: readonly string[];
    onChange: (library: TagLibrary) => Promise<void>;
    onCreateTag?: (name: string, id?: string) => Promise<string>;
    onRenameTag?: (id: string, name: string) => Promise<void>;
    onReparentTag?: (id: string, parentId: string | null, anchor?: string | null, after?: boolean) => Promise<void>;
    onRemoveCurrent?: (id: string) => Promise<void>;
    saving?:boolean;readOnly: boolean; filter: readonly string[]; filterMode: 'and' | 'or';
    onFilterModeChange: (mode: 'and' | 'or') => void;
    filterEnabled: boolean; onFilterEnabledChange: (enabled: boolean) => void; onFilter: (id: string | null) => void;
    currentCount: (id: string) => number;currentCoverage?:(id:string)=>number;
    onDropTagToSegment?: (tagId: string, segmentId: string) => Promise<void>;
    onTagDropTarget?: (segmentId: string | null) => void;
}
type Modal = { type: 'delete'; id: string; scope: 'current' | 'project' };
type Target = { kind:'tree'; parentId:string|null; anchorId:string|null; siblingId?:string|null; after?:boolean; depth:number } | {kind:'segment';id:string};
interface Gesture { kind: 'tag' | 'group'; id: string; source: string | null; copy: boolean; level: boolean; pointer: number; x: number; y: number; lastX: number; lastY: number; active: boolean; target: Target | null }

export function TagsPanel(p: Props) {
    useInterfaceLanguage();
    const [scope, setScope] = useState<'current' | 'project'>('current');
    const [query, setQuery] = useState('');
    const [foldedTags, setFoldedTags] = useState(new Set<string>());
    const [modal, setModal] = useState<Modal | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const [drag, setDrag] = useState<Gesture | null>(null), [modifier, setModifier] = useState(false);
    const list = useRef<HTMLDivElement>(null), gesture = useRef<Gesture | null>(null), frame = useRef<number | null>(null), suppress = useRef(0);
    useTagTreeLayout(list, [p.library, p.collection, p.currentTagIds, scope, query, foldedTags, p.filterEnabled]);
    const reveal = useTagCreationReveal({ context: `${p.versionKey}:${p.countVersionId}`, library: p.library, listRef: list, create: p.onCreateTag, showProject: () => setScope('project'), clearSearch: () => setQuery(''), setFolded: setFoldedTags, folded: foldedTags });
    const confirming = useRef(false), ghost = useRef<HTMLDivElement|null>(null), shownTarget = useRef<string | null>(null);
    const hitProbe = useRef<unknown[] | null>(null), refreshDrag = useRef<(hit?:Element|null)=>void>(()=>{});
    useLayoutEffect(()=>{refreshDrag.current=updateDrag;});
    useLayoutEffect(()=>{hitProbe.current=null;},[p.library,p.collection,scope,query,foldedTags]);
    const clicks = useRef(new Map<string, ReturnType<typeof setTimeout>>()), description = useId();
    const latest = useRef(p); useLayoutEffect(() => { latest.current = p; });
    const reportError=(error:unknown)=>{if(isSharedTagRestriction(error)){showSharedTagRestriction(undefined,error);setError('');}else setError(tagErrorMessage(error));};
    const locked = p.readOnly || !!p.loadError, dragEnabled = !p.sharedStructureHint && !locked && !busy && !p.saving && !p.filterEnabled;
    const admitted = new Set(p.currentTagIds.flatMap(id=>[id,...tagAncestors(p.library,id).map(tag=>tag.id)])), allRows = useMemo(() => tagTreeRows(p.library, undefined, 'manual', 1,()=>0,p.library.schemaVersion===4?p.library.treeOrder:p.collection?.levelOrder), [p.library, p.collection?.levelOrder]);
    const tree = useMemo(() => new Map(p.library.tags.map(tag => [tag.id, {
        ancestors: tagAncestors(p.library, tag.id), descendants: descendantTagIds(p.library, tag.id),
    }])), [p.library]);
    const matches = useMemo(() => query.trim() ? new Set(suggestTags(p.library.tags, query)
        .flatMap(tag => [tag.id, ...tree.get(tag.id)!.ancestors.map(parent => parent.id)])) : null, [p.library, query, tree]);
    const levelMembers = scope === 'project' ? undefined : admitted;
    const showCount = true;
    const {loadProjectCounts:projectCounter,projectRevision:countRevision,versionKey:countVersion,countVersionId}=p;
    const [projectCounts,setProjectCounts]=useState<{revision?:number;key?:string;id?:string;values:import('../lib/tagCountCache').TagCountTotals}|null>(null),[countError,setCountError]=useState(false),[countAttempt,retryCounts]=useState(0);
    const projectCountActive=scope==='project';
    useEffect(()=>{if(!projectCountActive||!projectCounter)return;let disposed=false;void projectCounter(countVersionId).then(values=>{if(!disposed){setProjectCounts({revision:countRevision,key:countVersion,id:countVersionId,values});setCountError(false)}},()=>{if(!disposed)setCountError(true)});return()=>{disposed=true}},[projectCountActive,countRevision,countVersion,countVersionId,projectCounter,countAttempt]);
    const countReady=!!projectCounts&&projectCounts.revision===p.projectRevision&&projectCounts.key===p.versionKey&&projectCounts.id===p.countVersionId;
    const scopeIds = allRows.filter(row => !levelMembers || levelMembers.has(row.tag.id)).map(row => row.tag.id);
    const tagKey = (id: string, group = 'level') => group + ':' + id;
    const cancelClick = (key: string) => { clearTimeout(clicks.current.get(key)); clicks.current.delete(key); };
    const toggleTag = (id: string, group = 'level') => setFoldedTags(old => { const next = new Set(old), key = tagKey(id, group); if (next.has(key)) next.delete(key); else next.add(key); return next; });
    useLayoutEffect(() => {
        const element = list.current; if (!element) return;
        const sync = () => element.parentElement?.style.setProperty('--tag-scrollbar-width', `${element.offsetWidth - element.clientWidth}px`);
        sync(); const observer = new ResizeObserver(sync); observer.observe(element); return () => observer.disconnect();
    }, []);
    function cancelGesture() {
        gesture.current = null; hitProbe.current=null; if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null;
        ghost.current?.remove();ghost.current=null;shownTarget.current=null;
        setDrag(null); latest.current.onTagDropTarget?.(null);
    }
    useEffect(() => {
        const pendingClicks=clicks.current;
        const key = (event: KeyboardEvent) => {
            setModifier(IS_MAC ? event.metaKey : event.ctrlKey);
            if (latest.current.filterEnabled && event.key === (IS_MAC ? 'Meta' : 'Control')) {
                const target = document.querySelector<HTMLElement>('.tag-library .library-filter:hover');
                if (target) showActionHint(target, msg('tags.filterMoveNotice'), 'restriction');
            }
            if (event.key === 'Escape') { suppress.current = event.timeStamp + 500; cancelGesture(); }
        };
        const blur = () => { setModifier(false); cancelGesture(); };
        window.addEventListener('keydown', key); window.addEventListener('keyup', key); window.addEventListener('blur', blur);
        return () => { window.removeEventListener('keydown', key); window.removeEventListener('keyup', key); window.removeEventListener('blur', blur); if (frame.current !== null) cancelAnimationFrame(frame.current); for (const timer of pendingClicks.values()) clearTimeout(timer); ghost.current?.remove();latest.current.onTagDropTarget?.(null); };
    }, []);
    async function save(next: TagLibrary) {
        if (locked || p.saving) throw Error(msg('tags.saveFailed'));
        if(JSON.stringify(next)===JSON.stringify(p.library)){setModal(null);return;}
        setBusy(true); setError('');
        try { await p.onChange(next); setModal(null); }
        catch (error) { reportError(error); throw error; }
        finally { setBusy(false); }
    }
    const fullyExpanded = !scopeIds.some(id => foldedTags.has(tagKey(id)));
    function toggleAll() {
        if (p.filterEnabled) return;
        setFoldedTags(old => { const next = new Set(old); for (const id of scopeIds) { if (fullyExpanded) next.add(tagKey(id)); else next.delete(tagKey(id)); } return next; });
    }
    function findTarget(g: Gesture, element = document.elementFromPoint(g.lastX, g.lastY)): Target | null {
        const segment = element?.closest<HTMLElement>('.segment[data-tag-drop-enabled="true"]');
        if (g.kind === 'tag' && segment && p.onDropTagToSegment) return { kind: 'segment', id: segment.id.slice(8) };
        if (element?.closest('.tag-tree-root-drop')) return { kind: 'tree', parentId: null, anchorId: null, siblingId:null,after:true,depth: 0 };
        const row = element?.closest<HTMLElement>('.library-tag-row[data-tag-id]');
        if (!row || element?.closest('.library-action-slot,.tag-count,.tag-delete-control')) return null;
        const id = row.dataset.tagId!, absolute = tagAncestors(p.library, id).reverse(), depth = absolute.length;
        const base = row.getBoundingClientRect().left, desired = Math.max(0, Math.min(depth + 1, Math.floor((g.lastX - base + TAG_TREE_STEP/2) / TAG_TREE_STEP)));
        const parentId = desired > depth ? id : desired === 0 ? null : absolute[desired - 1]?.id ?? null;
        const source = p.library.tags.find(tag => tag.id === g.id)!;
        if (parentId && descendantTagIds(p.library, g.id).includes(parentId)) return null;
        const siblingId=desired>depth?null:desired===depth?id:absolute[desired]?.id??null;
        if(siblingId===g.id)return null;
        const after=desired>depth||g.lastY>=row.getBoundingClientRect().top+row.getBoundingClientRect().height/2;
        if(parentId===(source.parentId??null)&&!p.onReorder)return null;
        return { kind: 'tree', parentId, anchorId: siblingId??id,siblingId,after,depth: desired };
    }
    function updateDrag(hit?:Element|null) {
        const g = gesture.current; if (!g?.active) return;
        g.target = findTarget(g,hit);
        if(ghost.current)ghost.current.style.transform=`translate3d(${g.lastX+12}px,${g.lastY+12}px,0)`;
        const key=JSON.stringify(g.target);
        if(key!==shownTarget.current){shownTarget.current=key;setDrag({...g});p.onTagDropTarget?.(g.target?.kind==='segment'?g.target.id:null);}
    }
    function tick() {
        const g = gesture.current; if (!g?.active) { frame.current = null; return; }
        let hit=document.elementFromPoint(g.lastX,g.lastY);
        const element = hit?.closest<HTMLElement>('[data-tag-drop-scroll]') ?? list.current;
        if (element) { const rect = element.getBoundingClientRect(), inside = g.lastX >= rect.left && g.lastX <= rect.right;
            const speed = !inside ? 0 : g.lastY < rect.top + 24 ? -12 : g.lastY > rect.bottom - 24 ? 12 : 0;
            if (speed) {element.scrollBy(0, speed);hit=document.elementFromPoint(g.lastX,g.lastY);}
        }
        // One hit and two local bounds probes while stationary; no repeated tree calculation/render.
        // Scroll or reflow can change those bounds even without a pointermove.
        const anchor=hit?.closest('.library-tag-row,.tag-group-header,[data-tag-group],.segment,.tag-tree-root-drop,.group-tag-root-drop,.root-drop')??hit;
        const bounds=anchor?.getBoundingClientRect();
        const probe=[hit,anchor,g.lastX,g.lastY,bounds?.left,bounds?.top,bounds?.width,bounds?.height,element?.scrollTop,element?.scrollLeft,latest.current.library];
        if(!hitProbe.current||probe.some((value,index)=>value!==hitProbe.current![index])){hitProbe.current=probe;refreshDrag.current(hit);}
        frame.current = requestAnimationFrame(tick);
    }
    function start(event: PointerEvent<HTMLButtonElement>, kind: 'tag' | 'group', id: string, source: string | null = null) {
        if (!dragEnabled || event.button !== 0 || !(IS_MAC ? event.metaKey : event.ctrlKey)) return;
        if (query.trim()) { setError(msg('tags.dragSearch')); return; }
        event.preventDefault(); event.stopPropagation();for(const timer of clicks.current.values())clearTimeout(timer);clicks.current.clear();
        gesture.current = { kind, id, source, copy: false, level: true,
            pointer: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, active: false, target: null };
        event.currentTarget.setPointerCapture(event.pointerId);
    }
    function move(event: PointerEvent<HTMLButtonElement>) {
        const g = gesture.current; if (!g) return; event.stopPropagation(); g.lastX = event.clientX; g.lastY = event.clientY;
        if (!g.active && Math.hypot(g.lastX - g.x, g.lastY - g.y) < 5) return;
        if (!g.active) { g.active = true;shownTarget.current=null;
            if(g.kind==='tag'){const node=document.createElement('div');node.className='tag-pill tag-drag-ghost';node.textContent=p.library.tags.find(tag=>tag.id===g.id)?.name??'';node.setAttribute('aria-hidden','true');document.body.appendChild(node);ghost.current=node;}
            frame.current = requestAnimationFrame(tick); }
        suppress.current = event.timeStamp + 500; updateDrag();
    }
    function finish(event: PointerEvent<HTMLButtonElement>, commit = true) {
        const g = gesture.current; if (!g) return;
        if(commit&&g.active){g.lastX=event.clientX;g.lastY=event.clientY;g.target=findTarget(g);}
        event.stopPropagation(); event.currentTarget.releasePointerCapture?.(g.pointer); cancelGesture();
        if (!g.active) return; suppress.current = event.timeStamp + 500;
        if (!commit || !g.target || !dragEnabled) return;
        const target = g.target;
        const operation = target.kind === 'segment' ? p.onDropTagToSegment?.(g.id, target.id)
            : (p.library.tags.find(tag=>tag.id===g.id)?.parentId??null)===target.parentId
                ? p.onReorder?.('level',g.id,target.siblingId??null,target.after??true)
                : p.onReparentTag?.(g.id,target.parentId,target.siblingId??null,target.after??true);
        void operation?.catch(error => reportError(error));
    }
    function row(tag: ProjectTag, members?: ReadonlySet<string>, group?: string, guide?: TagGuide, insertionId?:string|null) {
        const depth = tree.get(tag.id)!.ancestors.length, descendants = tree.get(tag.id)!.descendants, key = tagKey(tag.id, group);
        const parent = descendants.some(id => id !== tag.id && (!members || members.has(id)));
        const selected = p.filterEnabled && p.filter.includes(tag.id), inherited = p.filterEnabled && p.filter.some(id => id !== tag.id && tree.get(id)?.descendants.includes(tag.id));
        const count=projectCountActive?(countReady?(projectCounts!.values.get(tag.id)??0)-(projectCounts!.values.current?.get(tag.id)??0)+(projectCounts!.values.current?p.currentCount(tag.id):0):undefined):p.currentCount(tag.id);
        const coverage=projectCountActive?(countReady?(projectCounts!.values.coverage.get(tag.id)??0)-(projectCounts!.values.current?.coverage.get(tag.id)??0)+(projectCounts!.values.current?(p.currentCoverage?.(tag.id)??p.currentCount(tag.id)):0):undefined):(p.currentCoverage?.(tag.id)??count);
        const countHint=count===undefined?msg('tags.countLoading'):msg(projectCountActive?'tags.projectCountCoverage':'tags.currentCountCoverage',{direct:count,coverage:coverage??0});
        const canBegin = (time: number) => time >= suppress.current && !gesture.current;
        const hint = msg('tags.dragLevelTag', { key: IS_MAC ? '⌘' : 'Ctrl', copyKey:IS_MAC?'⌘⇧':'Ctrl+Shift' });
        const target=drag?.target, insert=target?.kind==='tree'?target:null;
        const line=insert&&insertionId===tag.id?<div className="tag-drop-line" data-edge={insert.after?'after':'before'} style={{left:insert.depth*TAG_TREE_STEP}}/>:null;
        return <div key={tag.id} className={'tag-tree-entry' + (selected || inherited ? ' is-inherited-region' : '')}>
            {line&&!insert?.after&&line}
            <div className={'library-tag-row' + (!showCount ? ' library-tag-row--no-count' : '')} data-tag-id={tag.id} data-created-location={reveal.locatedId===tag.id||undefined} data-tag-depth={depth} style={{ paddingLeft: depth * TAG_TREE_STEP }}>
                <TagTreeGuides guide={guide}/>
                <InlineTagName row name={tagPath(p.library,tag.id)} maxLength={1024} label={msg('tags.projectTagPath')} enabled={!p.filterEnabled && !locked} onRename={p.onRenameTag ? name => p.onRenameTag!(tag.id, name) : undefined} canBegin={canBegin} onEditingChange={() => cancelClick(key)}>
                    <span className="tag-row-main"><span className="tag-fold-slot">{parent&&<FilterActionHint blocked={p.filterEnabled} hint={msg('tags.filterFoldNotice')}><button type="button" className="tag-fold-toggle" disabled={p.filterEnabled} aria-label={msg(p.filterEnabled||!!query.trim()||!foldedTags.has(key)?'tags.collapseTag':'tags.expandTag',{name:tag.name})} aria-expanded={p.filterEnabled||!!query.trim()||!foldedTags.has(key)} onDoubleClick={event=>event.stopPropagation()} onClick={event=>{event.stopPropagation();if(!p.filterEnabled&&canBegin(event.timeStamp))toggleTag(tag.id,group)}}><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={p.filterEnabled||!!query.trim()||!foldedTags.has(key)?'m2 4 4 4 4-4':'m4 2 4 4-4 4'}/></svg></button></FilterActionHint>}</span><TagLibraryPill name={tag.name} selected={selected} inherited={inherited} filterEnabled={p.filterEnabled} locked={locked} parent={parent}
                        onToggle={() => toggleTag(tag.id, group)} onSelect={() => p.onFilter(tag.id)} canBegin={canBegin} hint={hint} dragEnabled={dragEnabled} modifier={modifier}
                        buttonProps={{ onKeyDown:event=>{
                            if(locked||p.filterEnabled||!event.altKey||!['ArrowUp','ArrowDown'].includes(event.key)||!p.onReorder)return;
                            event.preventDefault();const view:TagOrderView='level';
                            const siblings=tagTreeRows(p.library,members,'manual',1,()=>0,p.library.schemaVersion===4?p.library.treeOrder:p.collection?.levelOrder).map(row=>row.tag).filter(item=>(item.parentId??null)===(tag.parentId??null));
                            const index=siblings.findIndex(item=>item.id===tag.id),anchor=siblings[index+(event.key==='ArrowUp'?-1:1)];
                            if(anchor)void p.onReorder(view,tag.id,anchor.id,event.key==='ArrowDown').catch(error=>reportError(error));
                        },onPointerDown: event => start(event, 'tag', tag.id, group ?? null), onPointerMove: move, onPointerUp: event => finish(event), onPointerCancel: event => finish(event, false) }}
/></span>
                    {showCount && <span className="tag-count" data-action-tip={countHint} aria-label={countHint}>{count===undefined?'—':descendants.length>1?`${count}/${coverage??0}`:count}</span>}
                    {<TagDeleteControl name={tag.name} scope={scope} count={scope === 'project' ? descendants.length : descendants.filter(id=>admitted.has(id)).length} filterEnabled={p.filterEnabled} disabled={locked || scope === 'current' && !p.onRemoveCurrent}
                        onDelete={() => setModal({ type: 'delete', id: tag.id, scope })}/>
                        }
                </InlineTagName>
            </div>
            {line&&insert?.after&&line}
        </div>;
    }
    function rowsFor(members?: ReadonlySet<string>, group?: string) {
        let rows = allRows.filter(({ tag }) => !members || members.has(tag.id));
        rows = rows.filter(({ tag }) => matches ? matches.has(tag.id) : p.filterEnabled || !tree.get(tag.id)!.ancestors.some(ancestor => (!members || members.has(ancestor.id)) && foldedTags.has(tagKey(ancestor.id, group))));
        const guides = tagTreeGuides(p.library, rows.map(row => row.tag.id), members);
        const target=drag?.target,insert=target?.kind==='tree'?target:null;
        let insertionId=insert?.anchorId;
        if(insert&&insertionId){const descendants=new Set(tree.get(insertionId)?.descendants),visible=rows.filter(row=>descendants.has(row.tag.id));if(insert.after)insertionId=visible.at(-1)?.tag.id??insertionId;else if(!rows.some(row=>row.tag.id===insertionId))insertionId=visible[0]?.tag.id??insertionId;}
        return rows.map(({ tag }) => row(tag, members, group, guides.get(tag.id),insertionId));
    }
    const modalTag = modal?.type === 'delete' ? p.library.tags.find(tag => tag.id === modal.id) : undefined;
    const levelRows=rowsFor(levelMembers);
    const maxDepth=Math.max(0,...allRows.filter(({tag})=>!levelMembers||levelMembers.has(tag.id)).map(row=>row.depth));
    function blocked(target: EventTarget | null, move = false) {
        const trigger = target instanceof Element ? target.closest<HTMLElement>('.library-filter') : null;
        if(p.sharedStructureHint&&target instanceof Element&&target.closest('.library-filter,.tag-name-edit')){showSharedTagRestriction(target.closest<HTMLElement>('.library-filter,.tag-name-edit'),p.sharedStructureHint);return true;}
        if (!p.filterEnabled || !trigger) return false;
        showActionHint(trigger, msg(move ? 'tags.filterMoveNotice' : 'tags.filterEditNotice'), 'restriction'); return true;
    }
    return <div className="tag-library" onDoubleClickCapture={event => { if (blocked(event.target)) { event.preventDefault(); event.stopPropagation(); } }}
        onPointerDownCapture={event => { if ((IS_MAC ? event.metaKey : event.ctrlKey) && blocked(event.target, true)) { event.preventDefault(); event.stopPropagation(); } }}
        onClickCapture={event => { if (p.sharedStructureHint&&scope==='project'&&event.target instanceof Element&&event.target.closest('.tag-delete-control')){event.preventDefault();event.stopPropagation();showSharedTagRestriction(event.target.closest<HTMLElement>('.tag-delete-control'),p.sharedStructureHint);return;} if ((IS_MAC ? event.metaKey : event.ctrlKey) && blocked(event.target, true)) { event.preventDefault(); event.stopPropagation(); } }}
        onKeyDownCapture={event => { if ((event.key === 'F2'||p.sharedStructureHint&&event.altKey&&event.key.startsWith('Arrow')) && blocked(event.target)) { event.preventDefault(); event.stopPropagation(); } }} inert={busy||p.saving} aria-busy={busy||p.saving} data-tag-drag={drag ? drag.copy ? 'copy' : 'move' : undefined} onKeyDown={event => { if (event.key === ' ') event.stopPropagation(); }}>
        <div className="tag-view-toolbar"><div className="annotation-view-toggle" role="group" aria-label={msg('tags.libraryScope')}>{(['current','project'] as const).map(value=><button key={value} data-tag-scope={value} aria-pressed={scope===value} className={scope===value?'is-active':''} onClick={()=>setScope(value)}>{msg(value==='current'?'tags.currentLibrary':'tags.projectLibrary')}</button>)}</div></div>
        <TagLibraryInput library={p.library} query={query} onQuery={value => { setQuery(value); setError(''); }} readOnly={locked} onCreate={reveal.submit}/>
        {(p.loadError || error && !modal) && <p role="alert" className="tag-error">{p.loadError || error}</p>}
        <div className="group-tools tag-filter-tools">
            <div className="tag-filter-controls">
                <button className="tag-filter-toggle" aria-label={msg('tags.filterToggle')} aria-pressed={p.filterEnabled} data-tip={msg(p.filterEnabled ? 'tags.filterEnabled' : 'tags.filterDisabled')} onClick={() => p.onFilterEnabledChange(!p.filterEnabled)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={5 / 3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 4h18l-7 8v9l-4-2v-7Z"/></svg></button>
                <div className={'tag-filter-mode' + (!p.filterEnabled ? ' tag-toolbar-placeholder' : '')} role="group" aria-label={msg('tags.filterMode')} aria-hidden={!p.filterEnabled || undefined} inert={!p.filterEnabled}>{(['and', 'or'] as const).map(mode => <button key={mode} aria-label={msg('tags.' + mode)} aria-pressed={p.filterMode === mode} onClick={() => { if (p.filterEnabled) p.onFilterModeChange(mode); }}>{msg('tags.' + mode)}</button>)}</div>
            </div>

        </div>
        <div className={'tag-list-head'+(!showCount?' tag-list-head--no-count':'')}><div className="tag-name-tools"><FilterActionHint blocked={p.filterEnabled||!!p.sharedStructureHint} hint={p.sharedStructureHint??msg('tags.filterSortNotice')}><button aria-label={msg('tags.sortName')} data-action-tip={p.filterEnabled?undefined:msg('tags.sortNameHint')} disabled={locked||p.filterEnabled||!!p.sharedStructureHint||!p.onSortName} onClick={async()=>{setBusy(true);setError('');try{await p.onSortName?.('level')}catch(error){reportError(error)}finally{setBusy(false)}}}>{msg('tags.name')}<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M8 13V3M4 7l4-4 4 4"/></svg></button></FilterActionHint><FilterActionHint blocked={p.filterEnabled} hint={msg('tags.filterFoldNotice')}><button className="group-cycle" disabled={p.filterEnabled} aria-label={msg(p.filterEnabled || fullyExpanded ? 'tags.collapseAll' : 'tags.expandAll')} onClick={toggleAll}><TagChevron/></button></FilterActionHint></div>{showCount&&<span className="tag-count-heading">{msg('tags.count')}</span>}<span/></div>
        {projectCountActive&&countError&&<p role="alert" className="tag-error">{msg('tags.countFailed')} <button type="button" onClick={()=>retryCounts(value=>value+1)}>{msg('tags.retry')}</button></p>}
        <div ref={list} className="library-list library-list-all" style={{'--tag-row-min-width':`${maxDepth*TAG_TREE_STEP+194}px`} as React.CSSProperties}>
            {levelRows.length?levelRows:<p className="annotation-empty tag-library-empty">{msg(query.trim()?'tags.noSearchResults':scope==='current'?'tags.noAdmitted':'tags.noTags')}</p>}{drag?.level && <div className={'tag-tree-root-drop' + (drag.target?.kind === 'tree' && drag.target.anchorId === null ? ' is-drop-target' : '')}/>}
        </div>
        {modal && <TagModal compact title={msg(modal.scope==='current'?'tags.removeCurrentBranch':'tags.deleteBranch')} descriptionId={description} onClose={()=>{if(!busy){setModal(null);setError('')}}}>
            <p className="trash-material-name">{modalTag&&<TagPill name={tagPath(p.library,modalTag.id)}/>}</p>
            <p id={description} className="settings-hint">{msg(modal.scope==='current'?'tags.removeCurrentBranchNotice':'tags.deleteProjectBranchNotice')}</p>
            {error&&<p role="alert" className="tag-error">{error}</p>}
            <div className="project-actions audio-project-footer"><button type="button" data-cancel className="button button--secondary" disabled={busy} onClick={()=>{setModal(null);setError('')}}>{msg('tags.cancel')}</button><button type="button" className="button button--danger" disabled={busy} onClick={()=>{
                if(confirming.current)return;confirming.current=true;setBusy(true);
                const operation=Promise.resolve().then(()=>modal.scope==='project'?save(removeTagBranch(p.library,modal.id)):p.onRemoveCurrent?.(modal.id));
                void operation.then(()=>setModal(null),error=>reportError(error)).finally(()=>{confirming.current=false;setBusy(false)});
            }}>{msg(modal.scope==='current'?'tags.removeCurrent':'tags.delete')}</button></div>
        </TagModal>}
    </div>;
}
