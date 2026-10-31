import {useEffect,useLayoutEffect,useRef,useState,type ButtonHTMLAttributes} from 'react';
import {InlineTagName} from './InlineTagName';
import {msg} from '../i18n';
import {FilterActionHint} from './FilterActionHint';
export function TagLibraryPill({name,selected,inherited,filterEnabled,locked,parent,onToggle,onSelect,onRename,onRemove,canBegin,buttonProps,hint,dragEnabled=false,modifier=false}: {
 hint?:string;dragEnabled?:boolean;modifier?:boolean;
 name:string;selected:boolean;inherited:boolean;filterEnabled:boolean;locked:boolean;parent:boolean;
 onToggle:()=>void;onSelect:()=>void;onRename?:(name:string)=>Promise<void>;onRemove?:()=>void;canBegin:(time:number)=>boolean;
 buttonProps:ButtonHTMLAttributes<HTMLButtonElement>;
}){
 const [editing,setEditing]=useState(false),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const text=useRef<HTMLSpanElement>(null),[clipped,setClipped]=useState(false);
 useLayoutEffect(()=>{const element=text.current;if(!element)return;const sync=()=>setClipped(element.scrollHeight>element.clientHeight+1||element.scrollWidth>element.clientWidth+1);sync();const observer=new ResizeObserver(sync);observer.observe(element);return()=>observer.disconnect()},[name,editing]);
 const clear=()=>{if(timer.current)clearTimeout(timer.current);timer.current=null};useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current)},[]);
 return <span className={'tag-pill library-pill'+(onRemove?' tag-pill--removable':'')+(selected?' is-filtered':'')}>
  <InlineTagName name={name} enabled={!filterEnabled&&!locked} onRename={onRename} canBegin={canBegin} onEditingChange={value=>{clear();setEditing(value)}}><button {...buttonProps} onPointerDown={event=>{clear();buttonProps.onPointerDown?.(event)}} className={'library-filter'+(dragEnabled&&modifier?' can-drag':'')} aria-label={`${msg('tags.title')}: ${name}`} aria-pressed={selected} data-action-tip={dragEnabled?(clipped?name+'\n'+hint:hint):undefined} data-tip={!dragEnabled&&clipped?name:undefined} onClick={event=>{
   if(event.detail>=2||event.metaKey||event.ctrlKey||!canBegin(event.timeStamp))return;
   if(filterEnabled){if(!inherited||selected)onSelect();return}
   if(parent){clear();timer.current=setTimeout(onToggle,500)}
  }}><span ref={text} className="library-label-text">{name}</span></button></InlineTagName>
  {onRemove&&<FilterActionHint blocked={filterEnabled} hint={msg('tags.filterMembershipNotice')}><button className="group-tag-remove tag-pill-remove" disabled={locked||editing||filterEnabled} aria-label={`${msg('tags.remove')}: ${name}`} onDoubleClick={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();clear();if(e.detail<2)onRemove()}}>×</button></FilterActionHint>}
 </span>;
}
