import { useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { msg, useInterfaceLanguage } from '../i18n';
import { IS_MAC } from '../lib/format';
import { type ProjectTag, type TagLibrary, type TagGroup, moveTagGroup, removeTagGroup, transferTagGroup, sortTags, tagTreeRows, tagAncestors, descendantTagIds, reparentTag, removeTagNode, suggestTags } from '../lib/tags';
import { tagErrorMessage } from '../lib/tagErrors';
import { TagLibraryInput } from './TagLibraryInput';
import { TagMembershipTree } from './TagMembershipTree';
import { TagLibraryPill } from './TagLibraryPill';
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
    loadError?:string;
    library: TagLibrary;
    onChange: (library: TagLibrary) => Promise<void>;
    onCreateTag?: (name:string,id?:string)=>Promise<void>;
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
    onDropTagToSegment?: (tagId:string,segmentId:string)=>Promise<void>;
    onTagDropTarget?: (segmentId:string|null)=>void;
}
type Modal = {
    type: 'group';
    id: string;
} | {
    type: 'delete-group';
    id: string;
    scope: 'tree' | 'level';
} | {
    type: 'delete-tag'|'reset-tags';
    id: string;
};
type TagTarget = {kind:'group';id:string}|{kind:'tree';parentId:string|null;anchorId:string|null;depth:number}|{kind:'segment';id:string};
type Drop = {
    target: string | null;
    mode: 'before' | 'after' | 'inside';
};
export function TagsPanel(p: Props) {
    useInterfaceLanguage();
    const confirmationDescription = useId();
    const onTagDropTarget=p.onTagDropTarget;
    const [newGroup, setNewGroup] = useState(false), newGroupTrigger = useRef<HTMLButtonElement>(null), returnToNewGroup = useRef(false);
    const [draggedTag, setDraggedTag] = useState<'move' | 'copy' | null>(null), [tagDrop, setTagDrop] = useState<TagTarget | null>(null);
    const tagGesture = useRef<{ id: string; source: string | null; copy: boolean; fromLevel:boolean; pointer: number; x: number; y: number; lastX: number; lastY: number; active: boolean; target: TagTarget | null } | null>(null), tagFrame = useRef<number | null>(null);
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
        lastX: number;
        lastY: number;
        active: boolean;
        drop: Drop | null;
    } | null>(null), suppressClick = useRef(0), groupFrame = useRef<number|null>(null);
    useLayoutEffect(() => { const el = list.current; if (!el)
        return; const sync = () => el.parentElement?.style.setProperty('--tag-scrollbar-width', `${el.offsetWidth - el.clientWidth}px`); sync(); const observer = new ResizeObserver(sync); observer.observe(el); return () => observer.disconnect(); }, []);
    useEffect(() => { const cancel = (e: KeyboardEvent | Event) => { if ('key' in e && e.key !== 'Escape')
        return; if (!gesture.current && !tagGesture.current)
        return; gesture.current = null; if(groupFrame.current!==null)cancelAnimationFrame(groupFrame.current);groupFrame.current=null; tagGesture.current = null; onTagDropTarget?.(null); if (tagFrame.current !== null) cancelAnimationFrame(tagFrame.current); tagFrame.current = null; suppressClick.current = e.timeStamp + 500; setDragged(null); setDrop(null); setDraggedTag(null); setTagDrop(null); onTagDropTarget?.(null); }; window.addEventListener('keydown', cancel); window.addEventListener('blur', cancel); return () => { gesture.current = null; if(groupFrame.current!==null)cancelAnimationFrame(groupFrame.current);groupFrame.current=null; tagGesture.current = null; onTagDropTarget?.(null); if (tagFrame.current !== null) cancelAnimationFrame(tagFrame.current); window.removeEventListener('keydown', cancel); window.removeEventListener('blur', cancel); }; }, [onTagDropTarget]);
    const labelClicks=useRef(new Map<string,ReturnType<typeof setTimeout>>());
    useEffect(()=>()=>{for(const timer of labelClicks.current.values())clearTimeout(timer)},[]);
    const [tagCollapsed,setTagCollapsed]=useState(new Set<string>());
    const toggleTag=(key:string)=>{setCycle(-1);setTagCollapsed(current=>{const next=new Set(current);if(next.has(key))next.delete(key);else next.add(key);return next})};
    const locked = p.readOnly || busy || !!p.loadError;
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
    async function save(next: TagLibrary,reset=false) { if (p.readOnly||busy||p.loadError&&!reset)
        return; setBusy(true); setError(''); try {
        await p.onChange(next);
        setModal(null);
    }
    catch (error) {
        setError(tagErrorMessage(error));
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
    function cycleGroups() { if(nextCycle===0)setTagCollapsed(new Set());const ids = p.library.groups.map(g => g.id).concat('ungrouped'); setCycle(nextCycle); setCollapsed(new Set(nextCycle === 2 ? ids : [])); setHiddenTags(new Set(nextCycle === 0 ? [] : ids)); }
    function finishDrag(e?: PointerEvent<HTMLButtonElement>, commit = true) { const g = gesture.current; gesture.current = null; setDragged(null); setDrop(null); if (!g)
        return; suppressClick.current = (e?.timeStamp ?? 0) + 500; if (e)
        e.currentTarget.releasePointerCapture?.(g.pointer); if(groupFrame.current!==null)cancelAnimationFrame(groupFrame.current);groupFrame.current=null; if (commit && e && g.active && g.drop)
        void save(moveTagGroup(p.library, g.id, g.drop.target, g.drop.mode)); }
    function startDrag(e: PointerEvent<HTMLButtonElement>, id: string) { if (locked || e.button !== 0 || !(IS_MAC ? e.metaKey : e.ctrlKey))
        return; e.preventDefault(); gesture.current = { id, pointer: e.pointerId, x: e.clientX, y: e.clientY, lastX:e.clientX,lastY:e.clientY,active: false, drop: null }; e.currentTarget.setPointerCapture(e.pointerId); }
    function moveDrag(e: PointerEvent<HTMLButtonElement>) {
        const g = gesture.current;
        if (!g)
            return;
        g.lastX=e.clientX;g.lastY=e.clientY;
        if (!g.active && Math.hypot(e.clientX - g.x, e.clientY - g.y) < 5)
            return;
        if(!g.active&&typeof requestAnimationFrame==='function')groupFrame.current=requestAnimationFrame(groupScrollTick);
        g.active = true;
        setDragged(g.id);
        suppressClick.current = (e?.timeStamp ?? 0) + 500;
        findGroupTarget();
    }
    function findGroupTarget() {
        const g=gesture.current;if(!g?.active)return;
        let section = document.elementFromPoint(g.lastX,g.lastY)?.closest<HTMLElement>('[data-tag-group]'), next: Drop | null = null;
        if (section) {
            let rect = section!.querySelector<HTMLElement>(':scope > .tag-group-header')!.getBoundingClientRect(), out = false;
            while (g.lastX < rect.left + 16) {
                const parent: HTMLElement | null | undefined = section!.parentElement?.closest<HTMLElement>('[data-tag-group]');
                if (!parent)
                    break;
                section = parent;
                rect = section!.querySelector<HTMLElement>(':scope > .tag-group-header')!.getBoundingClientRect();
                out = true;
            }
            const target = section!.dataset.tagGroup!, ratio = (g.lastY - rect.top) / rect.height, mode = out || ratio > .75 ? 'after' : ratio < .25 ? 'before' : 'inside';
            const candidate = moveTagGroup(p.library, g.id, target, mode);
            if (candidate !== p.library)
                next = { target, mode };
        }
        else if (document.elementFromPoint(g.lastX,g.lastY)?.closest('.root-drop'))
            next = { target: null, mode: 'after' };
        g.drop = next;
        setDrop(next);
    }
    function groupScrollTick(){
        const g=gesture.current,element=list.current;if(!g?.active||!element)return;
        const rect=element.getBoundingClientRect(),inside=g.lastX>=rect.left&&g.lastX<=rect.right;
        const speed=!inside?0:g.lastY<rect.top+24?-12:g.lastY>rect.bottom-24?12:0;
        if(speed){element.scrollBy(0,speed);findGroupTarget()}
        groupFrame.current=requestAnimationFrame(groupScrollTick);
    }
    function findTagTarget() {
        const gesture = tagGesture.current;if(!gesture?.active)return;
        const element=document.elementFromPoint(gesture.lastX,gesture.lastY),segment=element?.closest<HTMLElement>('.segment[data-tag-drop-enabled="true"]');
        let target:TagTarget|null=null;
        if(segment&&p.onDropTagToSegment)target={kind:'segment',id:segment.id.slice(8)};
        else if(element?.closest('.tag-tree-root-drop')) {if(reparentTag(p.library,gesture.id,null)!==p.library)target={kind:'tree',parentId:null,anchorId:null,depth:0};}
        else {
            const placeholder=element?.closest<HTMLElement>('.tag-drop-placeholder');
            const row=element?.closest<HTMLElement>('.library-tag-row[data-tag-id]')??placeholder?.closest('.tag-tree-entry')?.querySelector<HTMLElement>('.library-tag-row');
            if(row&&!element?.closest('.tag-count,.library-action-slot')) {
                const id=row.dataset.tagId!,relative=Number(row.dataset.tagDepth??0),ancestors=tagAncestors(p.library,id),pill=row.querySelector('.library-pill')?.getBoundingClientRect(),base=pill&&pill.width>0?pill.left-relative*24:row.getBoundingClientRect().left;
                const desired=Math.max(0,Math.min(relative+1,Math.floor((gesture.lastX-base+8)/24)));
                const absolute=ancestors.length-relative+desired;
                const parentId=desired>relative?id:(absolute===0?null:ancestors[ancestors.length-absolute]?.id??null);
                if(reparentTag(p.library,gesture.id,parentId)!==p.library)target={kind:'tree',parentId,anchorId:id,depth:desired};
            } else {
                const header=element?.closest<HTMLElement>('.tag-group-header'),id=header?.closest<HTMLElement>('[data-tag-group]')?.dataset.tagGroup;
                if(id && transferTagGroup(p.library,gesture.id,gesture.source,id,gesture.copy,gesture.fromLevel)!==p.library)target={kind:'group',id};
            }
        }
        gesture.target=target;setTagDrop(target);onTagDropTarget?.(target?.kind==='segment'?target.id:null);
    }
    function tagScrollTick() {
        const gesture = tagGesture.current, element = gesture?document.elementFromPoint(gesture.lastX,gesture.lastY)?.closest<HTMLElement>('[data-tag-drop-scroll]')??list.current:list.current;
        if (!gesture?.active || !element) { tagFrame.current = null; return; }
        const rect = element.getBoundingClientRect();
        const inside=rect.width===0||gesture.lastX>=rect.left&&gesture.lastX<=rect.right;
        const speed = !inside?0:gesture.lastY < rect.top + 24 ? -12 : gesture.lastY > rect.bottom - 24 ? 12 : 0;
        if (speed) { element.scrollBy(0,speed); findTagTarget(); }
        tagFrame.current = requestAnimationFrame(tagScrollTick);
    }
    function startTagDrag(e: PointerEvent<HTMLButtonElement>, id: string, source?: string) {
        if (locked || e.button !== 0 || !(IS_MAC ? e.metaKey : e.ctrlKey)) return;
        if(query.trim()){setError(msg('tags.dragSearch'));return;}
        e.preventDefault(); e.stopPropagation();
        tagGesture.current = { id, source: !source||source === 'ungrouped' ? null : source, copy: !!source&&source !== 'ungrouped' && e.shiftKey, fromLevel:!source, pointer: e.pointerId, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, active: false, target: null };
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
        setDraggedTag(null); setTagDrop(null);onTagDropTarget?.(null);
        if (gesture.active) suppressClick.current = e.timeStamp + 500;
        if (commit && gesture.active && gesture.target) {const target=gesture.target;if(target.kind==='group')void save(transferTagGroup(p.library,gesture.id,gesture.source,target.id,gesture.copy,gesture.fromLevel));else if(target.kind==='tree')void save(reparentTag(p.library,gesture.id,target.parentId));else void p.onDropTagToSegment?.(gesture.id,target.id).catch(error=>setError(tagErrorMessage(error)));}
    }
    function row(tag:ProjectTag,gid?:string,depth=0,parentPath='',members?:ReadonlySet<string>) {
        const current=p.currentCount(tag.id),project=p.projectCounts?.get(tag.id)??0,key=`${gid??'level'}:${tag.id}`;
        const descendants=descendantTagIds(p.library,tag.id),parent=!query&&descendants.some(id=>id!==tag.id&&(!members||members.has(id)));
        const selected=p.filterEnabled&&p.filter.includes(tag.id),inherited=p.filterEnabled&&p.filter.some(id=>id!==tag.id&&descendantTagIds(p.library,id).includes(tag.id));
        const scope=selected||inherited;
        return <div key={tag.id} className={'tag-tree-entry'+(scope?' is-inherited-region':'')}>
          <div className="library-tag-row" data-tag-id={tag.id} data-tag-depth={depth} style={{paddingLeft:depth*24}}>
           <span className="tag-row-main">{parent?<button className="tag-node-collapse" aria-label={msg('tags.foldTag',{name:tag.name})} aria-expanded={!tagCollapsed.has(key)} onClick={()=>toggleTag(key)}><TagChevron open={!tagCollapsed.has(key)}/></button>:<span className="tag-node-spacer"/>}
            <TagLibraryPill name={tag.name} selected={selected} inherited={inherited} filterEnabled={p.filterEnabled} locked={locked} parent={parent} onToggle={()=>toggleTag(key)} onSelect={()=>p.onFilter(tag.id)} onRename={p.onRenameTag?name=>p.onRenameTag!(tag.id,name):undefined} canBegin={time=>time>=suppressClick.current&&!tagGesture.current&&!gesture.current} buttonProps={{onPointerDown:e=>startTagDrag(e,tag.id,gid),onPointerMove:moveTagDrag,onPointerUp:e=>finishTagDrag(e),onPointerCancel:e=>finishTagDrag(e,false)}} onRemove={gid&&gid!=='ungrouped'?()=>void save({...p.library,tags:p.library.tags.map(item=>item.id===tag.id?{...item,groupIds:item.groupIds.filter(id=>id!==gid)}:item)}):undefined}/>
            {parentPath&&<small className="tag-parent-path" data-action-tip={msg('tags.parentPath',{path:parentPath})}>{parentPath}</small>}
           </span>
           <span className="tag-count" aria-label={p.projectCounts?msg('tags.countDescription',{current,project}):msg(p.countError?'tags.countFailed':'tags.countLoading')} data-action-tip={p.projectCounts?msg('tags.countDescription',{current,project}):undefined}>{current}/{p.projectCounts?project:'–'}</span>
           <span className="library-action-slot">{!gid&&<button className="library-delete" disabled={locked} aria-label={`${msg('tags.deleteTag')}: ${tag.name}`} data-tip={msg('tags.deleteTag')} onClick={()=>setModal({type:'delete-tag',id:tag.id})}><ActionIcon kind="trash"/></button>}</span>
          </div>
          {tagDrop?.kind==='tree'&&tagDrop.anchorId===tag.id&&<div className="tag-drop-placeholder" style={{marginLeft:tagDrop.depth*24}}/>}
        </div>;
    }
    function rowsFor(members?:ReadonlySet<string>,gid?:string,matchAll=false) {
        const matches=query&&!matchAll?suggestTags(p.library.tags,query).filter(tag=>!members||members.has(tag.id)):null;
        const rows=matches?matches.map(tag=>({tag,depth:0,parentPath:tagAncestors(p.library,tag.id).reverse().map(t=>t.name).join('/')})):tagTreeRows(p.library,members,sort.key,sort.dir,p.currentCount);
        return rows.filter(row=>query||!tagAncestors(p.library,row.tag.id).some(ancestor=>(!members||members.has(ancestor.id))&&tagCollapsed.has(`${gid??'level'}:${ancestor.id}`))).map(item=>row(item.tag,gid,item.depth,item.parentPath,members));
    }
    function groupNode(group: TagGroup, inherited = false): React.ReactNode {
        const match = inherited || !query.trim(), members=new Set(p.library.tags.filter(tag=>tag.groupIds.includes(group.id)).map(tag=>tag.id)), tags = rowsFor(members,group.id,match), children = p.library.groups.filter(g => g.parentId === group.id).map(g => groupNode(g, match)).filter(Boolean);
        if (query && !match && !tags.length && !children.length)
            return null;
        const shut = collapsed.has(group.id) || (hiddenTags.has(group.id) && !children.length);
        return <section className={'tag-group' + (drop?.target === group.id ? ' drop-' + drop.mode : '') + (tagDrop?.kind==='group'&&tagDrop.id === group.id ? ' tag-drop-target' : '')} data-tag-group={group.id} key={group.id}><div className="tag-group-header"><button className="group-collapse" aria-label={group.name} aria-expanded={!shut} onClick={() => toggle(group.id)}><TagChevron open={!shut}/></button><InlineTagName name={group.name} label={msg('tags.groupName')} enabled={!p.filterEnabled&&!locked} canBegin={time=>time>=suppressClick.current&&!gesture.current&&!tagGesture.current} onEditingChange={()=>{clearTimeout(labelClicks.current.get('group:'+group.id))}} onRename={async name=>{if(p.library.groups.some(other=>other.id!==group.id&&other.parentId===group.parentId&&other.name===name))throw new Error(msg('tags.duplicate'));try{await p.onChange({...p.library,groups:p.library.groups.map(item=>item.id===group.id?{...item,name}:item)})}catch(error){throw new Error(tagErrorMessage(error),{cause:error})}}}><GroupNameButton className={'group-toggle' + (dragged === group.id ? ' is-dragging' : '')} isMac={IS_MAC} dragEnabled={!locked} dragging={!!dragged || !!draggedTag} aria-label={group.name} aria-expanded={!shut} onPointerDown={e => startDrag(e, group.id)} onPointerMove={moveDrag} onPointerUp={e => finishDrag(e)} onPointerCancel={e => finishDrag(e, false)} onKeyDown={e => { if (e.key === 'Escape') {
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
        } }} onClick={e => { if(p.filterEnabled||e.timeStamp<suppressClick.current||e.metaKey||e.ctrlKey)return;const key='group:'+group.id;clearTimeout(labelClicks.current.get(key));if(e.detail<2)labelClicks.current.set(key,setTimeout(()=>toggle(group.id),500)); }}><span className="group-name" data-tip-anchor>{group.name}</span></GroupNameButton></InlineTagName><span className="group-actions"><button className="group-manage" aria-label={`${msg('tags.manage')}: ${group.name}`} disabled={locked} onClick={() => setModal({ type: 'group', id: group.id })}><span aria-hidden="true">⋯</span></button><GroupDeleteMenu name={group.name} disabled={locked} onChoose={scope => setModal({ type: 'delete-group', id: group.id, scope })}/></span></div>{!shut && <div className="tag-group-content">{!hiddenTags.has(group.id) && <div className="group-tags">{tags}</div>}{children}</div>}</section>;
    }
    const modalGroup=modal&&(modal.type==='group'||modal.type==='delete-group')?p.library.groups.find(group=>group.id===modal.id):undefined,modalTag=modal?.type==='delete-tag'?p.library.tags.find(tag=>tag.id===modal.id):undefined;
    const ungrouped = sortTags(p.library.tags.filter(tag => !tag.groupIds.length && tag.name.toLowerCase().includes(query.toLowerCase())), 'name', 1, p.currentCount);
    return <div className="tag-library" aria-busy={busy} data-tag-drag={draggedTag ?? undefined} data-tag-target-kind={tagDrop?.kind} onKeyDown={e => { if (e.key === ' ') e.stopPropagation(); }}>
  <div className="tag-view-toolbar"><div className="annotation-view-toggle"><button className={view === 'all' ? 'is-active' : ''} onClick={() => setView('all')}>{msg('tags.all')}</button><button className={view === 'groups' ? 'is-active' : ''} onClick={() => setView('groups')}>{msg('tags.groups')}</button></div></div>
  <TagLibraryInput library={p.library} query={query} onQuery={value=>{setQuery(value);setError('')}} readOnly={locked} onCreate={p.onCreateTag?async(name,id)=>{await p.onCreateTag!(name,id);setHiddenTags(old=>{const next=new Set(old);next.delete('ungrouped');return next});setTagCollapsed(new Set());setCycle(-1)}:undefined}/>
  {p.loadError&&<p role="alert" className="tag-error">{p.loadError} <button disabled={p.readOnly||busy} onClick={()=>setModal({type:'reset-tags',id:'reset'})}>{msg('tags.resetTags')}</button></p>}
  {p.countError && <p role="alert" className="tag-error">{msg('tags.countFailed')} <button onClick={p.retryCounts}>{msg('tags.retry')}</button></p>}
  {error && !modal && <p role="alert" className="tag-error">{error}</p>}

  <div className="group-tools tag-filter-tools"><div className="tag-filter-controls">{view === 'groups' ? <button className="group-cycle" aria-label={msg(cycleLabels[nextCycle])} onClick={cycleGroups}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 2 4 3 4-3M4 14l4-3 4 3M3 8h10"/></svg></button> : <span className="group-cycle-placeholder" aria-hidden="true"/>}<button className="tag-filter-toggle" aria-label={msg('tags.filterToggle')} aria-pressed={p.filterEnabled} data-tip={msg(p.filterEnabled ? 'tags.filterEnabled' : 'tags.filterDisabled')} onClick={() => p.onFilterEnabledChange(!p.filterEnabled)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 4h18l-7 8v9l-4-2v-7Z"/></svg></button>{p.filterEnabled && <div className="tag-filter-mode" role="group" aria-label={msg('tags.filterMode')}><button aria-label={msg('tags.and')} aria-pressed={p.filterMode === 'and'} data-action-tip={msg('tags.andHint')} onClick={() => p.onFilterModeChange('and')}>{msg('tags.and')}</button><button aria-label={msg('tags.or')} aria-pressed={p.filterMode === 'or'} data-action-tip={msg('tags.orHint')} onClick={() => p.onFilterModeChange('or')}>{msg('tags.or')}</button></div>}</div>{view === 'groups' && <><button ref={newGroupTrigger} hidden={newGroup} disabled={locked} onClick={() => setNewGroup(true)}>＋ {msg('tags.newGroup')}</button>{newGroup && <NewGroupInput busy={locked} onCreate={createGroup} onCancel={reason => { returnToNewGroup.current = reason === 'escape'; setNewGroup(false); }}/>}</>}</div>
  {view === 'all' ? <div className="tag-list-head"><button aria-label={msg('tags.sortName')} aria-sort={sort.key === 'name' ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined} onClick={() => setSort({ key: 'name', dir: sort.key === 'name' && sort.dir === 1 ? -1 : 1 })}>{msg('tags.name')}<SortIcon direction={sort.key === 'name' ? sort.dir : 0}/></button><button aria-label={msg('tags.sortCount')} onClick={() => setSort({ key: 'count', dir: sort.key === 'count' && sort.dir === -1 ? 1 : -1 })}>{msg('tags.count')}<SortIcon direction={sort.key === 'count' ? sort.dir : 0}/></button><span className="delete-column"/></div> : null}
    <div ref={list} className={'library-list' + (view === 'all' ? ' library-list-all' : '')}>{view === 'all' ? <>{rowsFor()}{draggedTag&&<div className={'tag-tree-root-drop'+(tagDrop?.kind==='tree'&&tagDrop.anchorId===null?' is-drop-target':'')}/>}</> : <>{p.library.groups.filter(g => !g.parentId).map(g => groupNode(g))}{ungrouped.length > 0 && !hiddenTags.has('ungrouped') && <section className="tag-ungrouped"><div className="ungrouped-divider"><span>{msg('tags.ungrouped')}</span></div><div className="group-tags">{rowsFor(new Set(ungrouped.map(tag=>tag.id)),'ungrouped')}</div></section>}{draggedTag&&<div className={'tag-tree-root-drop'+(tagDrop?.kind==='tree'&&tagDrop.anchorId===null?' is-drop-target':'')}/>} {dragged && <div className={'root-drop' + (drop?.target === null ? ' is-drop-target' : '')}/>}</>}</div>
  {modal && <TagModal descriptionId={modal.type !== 'group' ? confirmationDescription : undefined} title={msg(modal.type === 'reset-tags' ? 'tags.resetTags' : modal.type === 'group' ? 'tags.manage' : modal.type === 'delete-group' ? (modal.scope === 'tree' ? 'tags.deleteGroupTree' : 'tags.deleteGroupLevel') : 'tags.deleteTag')} onClose={() => { if (!busy) {
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
                }}/> : <><p className="trash-material-name">{modal.type==='reset-tags'?msg('tags.title'):modalTag ? <TagPill name={modalTag.name}/> : modalGroup?.name}</p><p id={confirmationDescription} className="settings-hint">{msg(modal.type === 'reset-tags' ? 'tags.resetTagsNotice' : modal.type === 'delete-tag' ? 'tags.deleteTagNotice' : modal.type==='delete-group'&&modal.scope === 'tree' ? 'tags.deleteGroupTreeNotice' : 'tags.deleteGroupLevelNotice')}</p>{error && <p role="alert" className="tag-error">{error}</p>}<div className="project-actions audio-project-footer"><button data-cancel className="button button--secondary" disabled={busy} onClick={() => setModal(null)}>{msg('tags.cancel')}</button><button className="button button--danger" disabled={busy} onClick={() => { if(modal.type==='reset-tags')void save({...p.library,schemaVersion:2,tags:[]},true);else if (modal.type === 'delete-tag')
                void save(removeTagNode(p.library,modal.id));
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
        onSave(name.trim(), checked); }}><label className="field"><span>{msg('tags.groupName')}</span><input data-dialog-initial-focus maxLength={120} value={name} onChange={e => setName(e.target.value)} disabled={busy}/></label>{group && <><p className="settings-hint">{msg('tags.members')}</p><label className="field"><input aria-label={msg('tags.search')} placeholder={msg('tags.search')} value={query} onChange={e => setQuery(e.target.value)}/></label><TagMembershipTree library={library} query={query} checked={checked} disabled={busy} onToggle={(id,enabled)=>setChecked(old=>{const next=new Set(old);if(enabled)next.add(id);else next.delete(id);return next})}/></>}{error && <p role="alert" className="tag-error">{error}</p>}<div className="project-actions audio-project-footer"><button data-cancel type="button" disabled={busy} className="button button--secondary" onClick={onCancel}>{msg('tags.cancel')}</button><button className="button button--primary" disabled={busy || !name.trim()}>{msg('tags.save')}</button></div></form>;
}
