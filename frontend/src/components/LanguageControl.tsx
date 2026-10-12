import {useId,useLayoutEffect,useRef,useState} from 'react';
import {interfaceLanguage,msg,setInterfaceLanguage,useInterfaceLanguage} from '../i18n';
import {useDismissable} from '../useDismissable';
import './languageControl.css';

export function LanguageControl({welcome=false}:{welcome?:boolean}) {
  const language=useInterfaceLanguage();
  const [open,setOpen]=useState(false);
  const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null);
  const id=useId();
  const close=()=>setOpen(false);
  useDismissable(root,open,close);
  useLayoutEffect(()=>{
    if(!open||!menu.current||!trigger.current)return;
    const popup=menu.current;if(popup.showPopover)popup.showPopover();else popup.style.display='block';
    const rect=trigger.current.getBoundingClientRect();
    popup.style.left=`${Math.max(8,Math.min(rect.right-popup.offsetWidth,window.innerWidth-popup.offsetWidth-8))}px`;
    popup.style.top=`${Math.min(rect.bottom+6,window.innerHeight-popup.offsetHeight-8)}px`;
    popup.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  },[open,language]);
  return <div ref={root} className="language-control" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))close();}}
    onKeyDown={event=>{
      if(event.key==='Escape'){event.preventDefault();close();trigger.current?.focus();}
      if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
        event.preventDefault();if(!open){setOpen(true);return;}
        const options=Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button')??[]);
        const index=options.indexOf(document.activeElement as HTMLButtonElement);
        options[event.key==='Home'?0:event.key==='End'?options.length-1:(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length]?.focus();
      }
    }}>
    <button ref={trigger} type="button" className={welcome?'language-control--welcome':'icon-button'} aria-label={msg('language.label')}
      title={msg('language.label')} aria-haspopup="menu" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(!open)}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 4 6 4 9s-1 6-4 9c-3-3-4-6-4-9s1-6 4-9Z"/></svg>
    </button>
    {open&&<div ref={menu} id={id} popover="manual" role="menu" className="language-menu" aria-label={msg('language.label')}
      onPointerDown={event=>{if(event.button===0)event.preventDefault();}}>
      {([['zh-CN','简体中文'],['en','English']] as const).map(([value,label])=><button type="button" role="menuitemradio" aria-checked={interfaceLanguage()===value} key={value}
        onClick={()=>{void setInterfaceLanguage(value);close();trigger.current?.focus();}}><span aria-hidden="true">{language===value?'✓':''}</span>{label}</button>)}
    </div>}
  </div>;
}
