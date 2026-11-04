import {pendingWriteControl} from '../lib/pendingWriteControl';
import { useContext, useState } from 'react';
import { blockTagWrite, isTagWriting, TagWritingContext } from '../lib/tagCandidates';
import { showActionHint } from '../lib/actionHint';
import { msg } from '../i18n';
import { InlineTagName } from './InlineTagName';
import {SegmentTagDragContext} from '../hooks/useSegmentTagDrag';
import {IS_MAC} from '../lib/format';
/** Segment labels have no single-click action; double click edits the shared full path. */
export function TagPill({ name, fullPath, onRemove, removeLabel, disabled: suppliedDisabled = false, stopPropagation = false, renameEnabled = false, onRename, copyBlockedByFilter = false, dragSource, dragReady=false }: {
    name: string; fullPath?:string;
    onRemove?: () => void; removeLabel?: string; disabled?: boolean; stopPropagation?: boolean;
    copyBlockedByFilter?: boolean;
    renameEnabled?: boolean; onRename?: (name: string) => Promise<void>;
    dragSource?: {segmentId:string;tagId:string};dragReady?:boolean;
}) {
    const writing = useContext(TagWritingContext), pending = typeof writing==='boolean'&&writing, disabled = pending || suppliedDisabled;
    const drag=useContext(SegmentTagDragContext),draggable=!!dragSource&&!!drag?.enabled()&&!disabled&&!copyBlockedByFilter;
    const [editing,setEditing]=useState(false);
    const label=<span className="tag-pill-label">{name}</span>;
    return <span onClickCapture={event=>{if(blockTagWrite(writing,event))return;if(dragSource&&drag&&!drag.canClick()){event.preventDefault();event.stopPropagation()}}}
        onKeyDownCapture={event=>{if(event.key==='Enter'||event.key==='F2')blockTagWrite(writing,event)}}
        onPointerDown={event=>{if(isTagWriting(writing)||!dragSource||disabled||editing|| (event.target as Element).closest('.tag-pill-remove,input'))return;if(copyBlockedByFilter&&(IS_MAC?event.metaKey:event.ctrlKey)){event.preventDefault();event.stopPropagation();showActionHint(event.currentTarget,msg('tags.filterCopyNotice'),'restriction');return}if(draggable)drag!.start(dragSource.segmentId,dragSource.tagId,name,event)}}
        onPointerMove={dragSource?drag?.move:undefined} onPointerUp={dragSource?drag?.finish:undefined} onPointerCancel={dragSource?event=>drag?.finish(event,false):undefined} onLostPointerCapture={dragSource?event=>drag?.finish(event,false):undefined}
        data-tip-tone={copyBlockedByFilter ? 'restriction' : undefined}
        data-action-tip={!editing&&dragSource&&!disabled?(copyBlockedByFilter?msg('tags.filterCopyNotice'):draggable?msg('tags.dragSegmentTag',{key:IS_MAC?'⌘':'Ctrl'}):undefined):undefined}
        onDoubleClickCapture={event => { if(blockTagWrite(writing,event))return;if(dragSource&&drag&&!drag.canClick()){event.preventDefault();event.stopPropagation();return}}} tabIndex={onRename ? -1 : undefined} className={'tag-pill' + (onRemove ? ' tag-pill--removable' : '')+(editing?' is-editing':'')+(draggable&&dragReady?' is-tag-drag-ready':'')} onClick={stopPropagation ? event=>event.stopPropagation():undefined}>
        <InlineTagName name={fullPath??name} maxLength={fullPath?1024:120} focusable={!!onRename} enabled={renameEnabled&&!disabled} canBegin={()=>!isTagWriting(writing)} onRename={onRename} onEditingChange={setEditing}>
            {label}
        </InlineTagName>
        {onRemove&&!editing&&<button type="button" className="tag-pill-remove" {...pendingWriteControl(suppliedDisabled,pending)} aria-label={removeLabel} onDoubleClick={event=>event.stopPropagation()} onKeyDown={event=>{if(event.key===' ')event.stopPropagation()}} onClick={event=>{event.stopPropagation();if(!blockTagWrite(writing,event)&&event.detail<2)onRemove()}}>×</button>}
    </span>;
}
