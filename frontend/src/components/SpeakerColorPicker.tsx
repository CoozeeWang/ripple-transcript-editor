import { msg, uiMessage, useInterfaceLanguage } from '../i18n';
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { speakerColorNames, SPEAKER_PALETTE, validSpeakerColor } from "../lib/speakers";
import { readSpeakerPresets, saveSpeakerPresets, SPEAKER_PRESETS_EVENT } from "../lib/speakerPresets";
import { createPortal } from "react-dom";
import { placeSpeakerPalette } from "../lib/speakerPalettePosition";

export function SpeakerColorPicker({name,color,onChange}:{name:string;color:string;onChange:(color:string,index:number)=>void}) {
  useInterfaceLanguage();
  const [open,setOpen]=useState(false);
  const [custom,setCustom]=useState(readSpeakerPresets);
  const [adding,setAdding]=useState(false);
  const [managing,setManaging]=useState(false);
  const [draft,setDraft]=useState(color);
  const [error,setError]=useState("");
  useEffect(()=>{
    const update=()=>setCustom(readSpeakerPresets());
    window.addEventListener(SPEAKER_PRESETS_EVENT,update);window.addEventListener("storage",update);
    return ()=>{window.removeEventListener(SPEAKER_PRESETS_EVENT,update);window.removeEventListener("storage",update);};
  },[]);
  const root=useRef<HTMLSpanElement>(null);
  const trigger=useRef<HTMLButtonElement>(null);
  const popup=useRef<HTMLDivElement>(null);
  const [position,setPosition]=useState({left:8,top:8,maxHeight:300});
  useLayoutEffect(()=>{
    if(!open)return;
    const update=()=>{
      if(!trigger.current||!popup.current)return;
      const next=placeSpeakerPalette(trigger.current.getBoundingClientRect(),popup.current.getBoundingClientRect(),window.innerWidth,window.innerHeight);
      setPosition(previous=>previous.left===next.left&&previous.top===next.top&&previous.maxHeight===next.maxHeight?previous:next);
    };
    update();
    const observer=typeof ResizeObserver!=="undefined"?new ResizeObserver(update):null;
    if(popup.current)observer?.observe(popup.current);
    window.addEventListener("resize",update);window.addEventListener("scroll",update,true);
    return ()=>{observer?.disconnect();window.removeEventListener("resize",update);window.removeEventListener("scroll",update,true);};
  },[open,adding,managing,custom.length,error]);
  useEffect(()=>{
    if(!open)return;
    const dismiss=(event:PointerEvent)=>{
      const target=event.target as Node;
      if(!root.current?.contains(target)&&!popup.current?.contains(target)){
        setOpen(false);setAdding(false);setManaging(false);setError("");
      }
    };
    document.addEventListener("pointerdown",dismiss);
    return ()=>document.removeEventListener("pointerdown",dismiss);
  },[open]);
  const close=()=>{setOpen(false);setAdding(false);setManaging(false);setError("");};
  const choose=(next:string,index:number)=>{onChange(next,index);close();trigger.current?.focus();};
  return <span className="speaker-color-action-wrap" ref={root} onKeyDown={event=>{if(event.key==="Escape"){event.stopPropagation();close();trigger.current?.focus();}}}>
    <button ref={trigger} type="button" className="speaker-action speaker-color-action" aria-label={msg('SpeakerColorPicker.m0991', { v0: name })} title={msg('SpeakerColorPicker.m0992')} aria-expanded={open} onClick={()=>{if(open)close();else {setCustom(readSpeakerPresets());setOpen(true);}}}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.4-3.4 1.5 1.5 0 0 1 1.1-2.6H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8Z" />
        <circle cx="7.5" cy="10" r=".8" /><circle cx="11" cy="7" r=".8" /><circle cx="15.5" cy="8" r=".8" />
      </svg>
    </button>
    {open && createPortal(<div ref={popup} style={position} className="speaker-preset-palette" role="group" aria-label={msg('SpeakerColorPicker.m0993', { v0: name })}>
      <div className="speaker-palette-heading">{msg('SpeakerColorPicker.m0994')}</div>
      <div className="speaker-palette-grid" role="group" aria-label={msg('SpeakerColorPicker.m0995')}>
      {SPEAKER_PALETTE.map((preset,index)=><button className="speaker-palette-swatch" key={preset} type="button" title={speakerColorNames()[index]} aria-label={speakerColorNames()[index]} aria-pressed={color.toLowerCase()===preset.toLowerCase()}
        style={{background:preset}} onClick={()=>choose(preset,index)} />)}
      </div>
      <div className="speaker-palette-heading speaker-palette-custom-heading"><span>{msg('SpeakerColorPicker.m0996')}</span>
        {(custom.length>0||managing) && <button type="button" className="speaker-palette-text" onClick={()=>{setManaging(!managing);setAdding(false);setError("");}}>{managing?msg('SpeakerColorPicker.m0997'):msg('SpeakerColorPicker.m0998')}</button>}
      </div>
      <div className="speaker-palette-grid" role="group" aria-label={msg('SpeakerColorPicker.m0999')}>
        {custom.map(preset=><button className={`speaker-palette-swatch${managing?" is-removing":""}`} key={preset} type="button" title={managing?msg('SpeakerColorPicker.m1000', { v0: preset }):preset} aria-label={managing?msg('SpeakerColorPicker.m1001', { v0: preset }):msg('SpeakerColorPicker.m1002', { v0: preset })} aria-pressed={!managing&&color.toUpperCase()===preset}
          style={{background:preset}} onClick={()=>{
            if(!managing){choose(preset,Math.max(0,SPEAKER_PALETTE.indexOf(preset)));return;}
            try {saveSpeakerPresets(readSpeakerPresets().filter(c=>c!==preset));setError("");} catch {setError(msg('SpeakerColorPicker.m1003'));}
          }}>{managing&&<span aria-hidden="true">×</span>}</button>)}
        {!managing && <button type="button" className="speaker-palette-add" title={msg('SpeakerColorPicker.m1004')} aria-label={msg('SpeakerColorPicker.m1005')} aria-expanded={adding} onClick={()=>{setAdding(!adding);setDraft(color);setError("");}}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></button>}
      </div>
      {adding && <div className="speaker-palette-editor">
        <div className="speaker-palette-fields"><input type="color" aria-label={msg('SpeakerColorPicker.m1006')} value={validSpeakerColor(draft)?draft:color} onChange={event=>{setDraft(event.target.value);setError("");}}/>
        <input type="text" aria-label={msg('SpeakerColorPicker.m1007')} value={draft} maxLength={7} spellCheck={false} onChange={event=>{setDraft(event.target.value);setError("");}} /></div>
        <button type="button" className="speaker-palette-save" onClick={()=>{
          if(!validSpeakerColor(draft)){setError(msg('SpeakerColorPicker.m1008'));return;}
          const next=draft.toUpperCase();
          try {
            if(!SPEAKER_PALETTE.includes(next))saveSpeakerPresets([...readSpeakerPresets(),next]);
            choose(next,Math.max(0,SPEAKER_PALETTE.indexOf(next)));
          } catch {setError(msg('SpeakerColorPicker.m1009'));}
        }}>{msg('SpeakerColorPicker.m1010')}</button>
      </div>}
      {error && <p className="speaker-palette-error" role="alert">{uiMessage(error)}</p>}
    </div>,document.body)}
  </span>;
}
