import { useEffect, useRef, useState } from 'react';
import { InlineTagName } from './InlineTagName';
/** Segment labels reveal their path on a deliberate single click; double click edits that path. */
export function TagPill({ name, fullPath, onRemove, removeLabel, disabled = false, stopPropagation = false, renameEnabled = false, onRename }: {
    name: string; fullPath?:string;
    onRemove?: () => void; removeLabel?: string; disabled?: boolean; stopPropagation?: boolean;
    renameEnabled?: boolean; onRename?: (name: string) => Promise<void>;
}) {
    const [editing,setEditing]=useState(false),[expanded,setExpanded]=useState(false),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
    const cancel=()=>{if(timer.current)clearTimeout(timer.current);timer.current=null};
    useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current)},[]);
    const label=<span className="tag-pill-label">{expanded&&fullPath?fullPath:name}</span>;
    return <span tabIndex={onRename ? -1 : undefined} className={'tag-pill' + (onRemove ? ' tag-pill--removable' : '')} onClick={stopPropagation ? event=>event.stopPropagation():undefined}>
        <InlineTagName name={fullPath??name} maxLength={fullPath?1024:120} focusable={!fullPath} enabled={renameEnabled&&!disabled} onRename={onRename} onEditingChange={value=>{cancel();setEditing(value)}}>
            {fullPath?<button type="button" className="tag-path-trigger" aria-expanded={expanded} onKeyDown={event=>{if(event.key!=='F2')event.stopPropagation()}} onClick={event=>{event.stopPropagation();cancel();if(event.detail<2)timer.current=setTimeout(()=>setExpanded(value=>!value),500)}}>{label}</button>:label}
        </InlineTagName>
        {onRemove&&<button type="button" className="tag-pill-remove" disabled={disabled||editing} aria-label={removeLabel} onDoubleClick={event=>event.stopPropagation()} onKeyDown={event=>{if(event.key===' ')event.stopPropagation()}} onClick={event=>{event.stopPropagation();cancel();if(event.detail<2)onRemove()}}>×</button>}
    </span>;
}
