import { msg, uiMessage, useInterfaceLanguage } from '../i18n';
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { TranscriptModel } from "../types";
import { defaultEditLabel, displayEngineLabel } from "../localStore";
import { useDismissable } from "../useDismissable";

export interface VersionPickerProps {
  models: TranscriptModel[];
  value: string;
  variant: "current" | "comparison";
  excluded?: string;
  disabled?: boolean;
  onSelect: (modelId: string, editId: string) => void;
  onRename: (modelId: string, editId: string, label: string) => void | Promise<void>;
  onCopy?: (modelId: string, editId: string) => void;
  onDelete?: (modelId: string, editId: string, label: string, isLast: boolean) => void;
}

function VersionActionIcon({action}:{action:"rename"|"new"|"copy"|"delete"}) {
  useInterfaceLanguage();
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {action==="rename" && <><path d="m16 3 5 5-12 12-6 1 1-6Z"/><path d="m14 5 5 5"/></>}
    {action==="new" && <path d="M12 5v14M5 12h14"/>}
    {action==="copy" && <><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>}
    {action==="delete" && <><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 10v8m4-8v8"/></>}
  </svg>;
}

/** Both selectors share labels and rename actions; selection always uses stable IDs. */
export function VersionPicker({models,value,variant,excluded,disabled,onSelect,onRename,onCopy,onDelete}:VersionPickerProps) {
  useInterfaceLanguage();
  const [open,setOpen]=useState(false);
  const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
  const popupId=useId();
  const menu=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    const popup=menu.current, anchor=trigger.current;
    if(!open || !popup || !anchor) return;
    // The top layer keeps this menu outside scrollable headers and sidebars.
    popup.showPopover?.();
    const place=()=>{
      const rect=anchor.getBoundingClientRect();
      const below=window.innerHeight-rect.bottom-12, above=rect.top-12;
      const up=below<Math.min(200,popup.scrollHeight) && above>below;
      popup.style.maxHeight=`${Math.max(40,up?above:below)}px`;
      const width=popup.getBoundingClientRect().width;
      popup.style.left=`${Math.max(8,Math.min(variant==='comparison'?rect.right-width:rect.left,window.innerWidth-width-8))}px`;
      popup.style.top=`${up?Math.max(8,rect.top-popup.getBoundingClientRect().height-6):rect.bottom+6}px`;
    };
    place();
    window.addEventListener('resize',place);
    window.addEventListener('scroll',place,true);
    return ()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
  },[open,variant]);
  const [editing,setEditing]=useState<{model:string;edit:string;label:string}|null>(null);
  const [draft,setDraft]=useState("");
  const [error,setError]=useState("");
  const [saving,setSaving]=useState(false);
  const pendingSave=useRef(false);
  const clickTimer=useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const input=useRef<HTMLInputElement>(null);
  const renameRow=useRef<HTMLElement|null>(null);
  const clearClick=()=>{clearTimeout(clickTimer.current);clickTimer.current=undefined;};
  const close=()=>{if(pendingSave.current)return;clearClick();setEditing(null);setError("");setOpen(false);};
  useEffect(()=>()=>clearTimeout(clickTimer.current),[]);
  useEffect(()=>{
    if(editing){input.current?.focus();input.current?.select();}
    else if(renameRow.current){
      renameRow.current.querySelector<HTMLElement>('.version-picker-option')?.focus();
      renameRow.current=null;
    }
  },[editing]);
  useEffect(()=>{
    if(open) (menu.current?.querySelector<HTMLElement>('.version-picker-option[aria-pressed="true"]') ?? menu.current?.querySelector<HTMLElement>('.version-picker-option'))?.focus();
  },[open]);
  useDismissable(root,open,close);
  const beginRename=(model:string,edit:string,label:string)=>{
    if(disabled||pendingSave.current)return;
    renameRow.current=document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>('.version-picker-row') : null;
    clearClick();setEditing({model,edit,label});setDraft(label);setError("");
  };
  const save=async()=>{
    if(!editing||pendingSave.current)return;
    if(!draft.trim()){setError(msg('VersionPicker.m1083'));input.current?.focus();return;}
    if(draft.trim()===editing.label){renameRow.current=null;close();trigger.current?.focus();return;}
    pendingSave.current=true;setSaving(true);setError("");
    try {await onRename(editing.model,editing.edit,draft.trim());renameRow.current=null;setEditing(null);setOpen(false);trigger.current?.focus();}
    catch(error){setError(error instanceof Error?error.message:msg('VersionPicker.m1084'));}
    finally {pendingSave.current=false;setSaving(false);}
  };
  // Imported originals appear before imported editing manuscripts, independent of import order.
  const orderedModels=[...models];
  const imported=orderedModels.filter(model=>model.sourceKind === "import")
    .sort((a,b)=>Number(!!b.designatedOriginal)-Number(!!a.designatedOriginal));
  let importIndex=0;
  const groups=orderedModels.map(model=>model.sourceKind === "import" ? imported[importIndex++] : model).map(model=>({model,entries:[
    ...((model.designatedOriginal || (model.original && (model.sourceKind !== "import" || variant === "comparison" || value === `${model.id}:original`))) ? [{id:"original",label:model.sourceKind === "import" && !model.designatedOriginal ? msg('VersionPicker.m1085') : msg('VersionPicker.m1086')}] : []),
    ...(model.designatedOriginal && variant === "current" ? [] : model.edits).map((edit,index)=>({id:edit.id,label:edit.label ?? defaultEditLabel(index)})),
  ].filter(entry=>`${model.id}:${entry.id}`!==excluded)})).filter(group=>group.entries.length);
  const selected=groups.flatMap(({model,entries})=>entries.map(entry=>({...entry,value:`${model.id}:${entry.id}`}))).find(entry=>entry.value===value);
  const title=variant==="current" ? msg('VersionPicker.m1087') : msg('VersionPicker.m1088');
  const run=(action:()=>void)=>{clearClick();setEditing(null);setOpen(false);trigger.current?.focus();action();};
  return <div className={`version-picker version-picker--${variant}${variant==="current" && selected?.id==="original" ? " version-picker--original" : ""}`} ref={root}
    onKeyDown={event=>{
      if(event.nativeEvent.isComposing || event.keyCode===229){event.stopPropagation();return;}
      if(event.key==="Escape"){event.preventDefault();event.stopPropagation();if(editing){if(!saving){setEditing(null);setError("");}}else{close();trigger.current?.focus();}}
      else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
        event.stopPropagation();
        if(editing)return;
        event.preventDefault();
        if(!open){setOpen(true);return;}
        const buttons=Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
        if(!buttons.length)return;
        const index=buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;
        buttons[next].focus();
      }
    }}
    onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))close();}}>
    <button ref={trigger} type="button" className="version-picker-trigger" aria-label={`${title}：${selected?.label ?? msg('VersionPicker.m1089')}`}
      aria-expanded={open} aria-controls={popupId} disabled={disabled || !groups.length} onClick={()=>{if(open)close();else setOpen(true);}}>
      <span>{selected?.label ?? msg('VersionPicker.m1090')}</span><span aria-hidden="true">▾</span>
    </button>
    {open && <div ref={menu} popover="manual" id={popupId} className="version-picker-menu" role="group" aria-label={msg('VersionPicker.m1091', { v0: title })}>
      {groups.map(({model,entries})=><section key={model.id} className={`version-picker-group${model.sourceKind === "import" ? " version-picker-group--import" : ""}`}>
        {model.sourceKind !== "import" && <div className="version-picker-engine"><span>{msg('VersionPicker.m1092')}</span><strong>{displayEngineLabel(model.engine)}</strong></div>}
        {entries.map(entry=><div key={entry.id} className={`version-picker-row version-picker-row--${entry.id==="original" ? "original" : "edit"}${`${model.id}:${entry.id}`===value ? " is-selected" : ""}`}>
          {editing?.model===model.id && (editing.edit===entry.id || (editing.edit==="model-name" && entry===entries[0])) ? <div className="version-picker-inline">
            <input ref={input} aria-label={editing.edit === "model-name" ? msg('VersionPicker.m1093') : msg('VersionPicker.m1094')} value={draft} maxLength={100} readOnly={saving} aria-invalid={!!error}
              onChange={event=>{setDraft(event.target.value);setError("");}}
              onKeyDown={event=>{if(event.key==="Enter"&&!event.nativeEvent.isComposing&&event.keyCode!==229){event.preventDefault();void save();}}}/>
            {error && <span role="alert">{uiMessage(error)}</span>}
          </div> : <button type="button" className="version-picker-option" aria-pressed={`${model.id}:${entry.id}`===value} disabled={saving||disabled}
            onClick={event=>{
              clearClick();
              if(event.detail===0||entry.id==="original")run(()=>onSelect(model.id,entry.id));
              else clickTimer.current=setTimeout(()=>run(()=>onSelect(model.id,entry.id)),300);
            }} onDoubleClick={()=>{if(entry.id!=="original")beginRename(model.id,entry.id,entry.label);}}><span>{entry.label}</span>{model.sourceKind === "import" && <small className="version-picker-source" title={model.sourceName}>{model.label ?? model.sourceName ?? msg('VersionPicker.m1095')}</small>}</button>}
          <div className="version-picker-actions">
            {model.sourceKind === "import" && entry.id === "original" && entry === entries[0] && <button type="button" data-tip={msg('VersionPicker.m1096')} aria-label={msg('VersionPicker.m1097', { v0: model.label ?? model.sourceName ?? '' })} disabled={saving || disabled} onClick={()=>beginRename(model.id,"model-name",model.label ?? model.sourceName ?? msg('VersionPicker.m1098'))}><VersionActionIcon action="rename"/></button>}
            {entry.id!=="original" && <button type="button" data-tip={editing?.model===model.id&&editing.edit===entry.id?msg('VersionPicker.m1099'):msg('VersionPicker.m1100')} aria-label={msg('VersionPicker.m1101', { v0: entry.label })} disabled={saving||disabled} onClick={()=>{if(editing?.model===model.id&&editing.edit===entry.id)void save();else beginRename(model.id,entry.id,entry.label);}}><VersionActionIcon action="rename"/></button>}
            {onCopy && <button disabled={saving||disabled} type="button" data-tip={entry.id==="original" ? msg('VersionPicker.m1102') : msg('VersionPicker.m1103')} aria-label={entry.id==="original" ? msg('VersionPicker.m1104') : msg('VersionPicker.m1105', { v0: entry.label })}
              onClick={()=>run(()=>onCopy(model.id,entry.id))}><VersionActionIcon action={entry.id==="original" ? "new" : "copy"}/></button>}
            {onDelete && <button disabled={saving||disabled} type="button" className="version-picker-delete" data-tip={entry.id==="original" ? (model.sourceKind === "import" && !model.designatedOriginal ? msg('VersionPicker.m1106') : msg('VersionPicker.m1107')) : msg('VersionPicker.m1108')} aria-label={msg('VersionPicker.m1109', { v0: entry.label })}
              onClick={()=>run(()=>onDelete(model.id,entry.id,entry.label,entry.id==="original" ? !model.edits.length : !model.original && model.edits.length===1))}><VersionActionIcon action="delete"/></button>}
          </div>
        </div>)}
      </section>)}
    </div>}
  </div>;
}
