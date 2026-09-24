import { msg, useInterfaceLanguage } from '../i18n';
import { useEffect, useId, useRef, useState } from "react";
import type { Segment } from "../types";
import { formatTime } from "../lib/format";

export function SegmentPicker({segments,value,onChange,label,min=0,disabled=false}:{segments:Segment[];value:number;onChange:(index:number)=>void;label:string;min?:number;disabled?:boolean}) {
  useInterfaceLanguage();
  const id=useId();
  const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),input=useRef<HTMLInputElement>(null),list=useRef<HTMLDivElement>(null);
  const [open,setOpen]=useState(false),[query,setQuery]=useState(""),[active,setActive]=useState(value);
  const [position,setPosition]=useState({left:0,top:0,width:0,height:300});
  const term=query.trim().toLocaleLowerCase();
  const options=segments.map((segment,index)=>({segment,index})).filter(({segment,index})=>index>=min&&(!term||String(index+1).includes(term)||formatTime(segment.start).includes(term)||segment.text.toLocaleLowerCase().includes(term)));
  const focused=options.some(o=>o.index===active)?active:options[0]?.index;
  const selected=segments[value];
  function close(focus=false){setOpen(false);if(focus)trigger.current?.focus();}
  function show(){
    if(disabled)return;
    const rect=trigger.current!.getBoundingClientRect(),width=Math.min(Math.max(rect.width,600),window.innerWidth-32);
    const below=window.innerHeight-rect.bottom-16,above=rect.top-16;
    const height=Math.min(360,Math.max(below,above));
    setPosition({left:Math.max(16,Math.min(rect.left,window.innerWidth-width-16)),top:below>=height?rect.bottom+4:Math.max(16,rect.top-height-4),width,height});
    setQuery("");setActive(value);setOpen(true);
  }
  useEffect(()=>{
    if(!open)return;
    input.current?.focus();
    const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};
    const move=(e:Event)=>{if(e.type==="resize"||!root.current?.contains(e.target as Node))setOpen(false);};
    document.addEventListener("pointerdown",outside);document.addEventListener("scroll",move,true);window.addEventListener("resize",move);
    return()=>{document.removeEventListener("pointerdown",outside);document.removeEventListener("scroll",move,true);window.removeEventListener("resize",move);};
  },[open]);
  useEffect(()=>{
    if(!open)return;
    const row=list.current?.querySelector<HTMLElement>(`[data-index="${focused}"]`),box=list.current;
    if(row&&box){if(row.offsetTop<box.scrollTop)box.scrollTop=row.offsetTop;else if(row.offsetTop+row.offsetHeight>box.scrollTop+box.clientHeight)box.scrollTop=row.offsetTop+row.offsetHeight-box.clientHeight;}
  },[open,focused]);
  return <div className="segment-picker" ref={root} onKeyDown={e=>{
    if(!open)return;
    if(e.key==="Escape"){e.preventDefault();e.stopPropagation();close(true);}
    else if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();const i=options.findIndex(o=>o.index===focused);setActive(options[Math.max(0,Math.min(options.length-1,i+(e.key==="ArrowDown"?1:-1)))]?.index??value);}
    else if(e.key==="Enter"){e.preventDefault();if(focused!==undefined){onChange(focused);close(true);}}
    else if(e.key==="Tab")close();
  }}>
    <button ref={trigger} type="button" className="segment-picker-trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open?id:undefined} disabled={disabled} onClick={()=>open?close():show()} onKeyDown={e=>{if(!open&&(e.key==="ArrowDown"||e.key==="ArrowUp")){e.preventDefault();show();}}}>
      <span>{selected?msg('SegmentPicker.m0959', { v0: value+1, v1: formatTime(selected.start), v2: selected.text }):msg('SegmentPicker.m0960')}</span><span aria-hidden="true">⌄</span>
    </button>
    {open&&<div className="segment-picker-popup" style={{left:position.left,top:position.top,width:position.width,maxHeight:position.height}}>
      <input ref={input} type="search" role="combobox" aria-label={msg('SegmentPicker.m0961', { v0: label })} aria-expanded="true" aria-controls={id} aria-activedescendant={focused===undefined?undefined:`${id}-${focused}`} value={query} onChange={e=>setQuery(e.target.value)} placeholder={msg('SegmentPicker.m0962')}/>
      <div className="segment-picker-columns" aria-hidden="true"><span>{msg('SegmentPicker.m0963')}</span><span>{msg('SegmentPicker.m0964')}</span><span>{msg('SegmentPicker.m0965')}</span></div>
      <div id={id} ref={list} className="segment-picker-list" role="listbox" aria-label={label}>
        {options.map(({segment,index})=><div key={segment.id} id={`${id}-${index}`} data-index={index} role="option" aria-label={msg('SegmentPicker.m0966', { v0: index+1, v1: formatTime(segment.start), v2: segment.text })} aria-selected={index===value} className={`segment-picker-row ${index===focused?"segment-picker-row--active":""}`} onMouseDown={e=>e.preventDefault()} onClick={()=>{onChange(index);close(true);}}><span>{msg('SegmentPicker.m0967')}{index+1}</span><time>{formatTime(segment.start)}</time><span title={segment.text}>{segment.text}</span></div>)}
        {!options.length&&<p className="ai-subtitle">{msg('SegmentPicker.m0968')}</p>}
      </div>
    </div>}
  </div>;
}
