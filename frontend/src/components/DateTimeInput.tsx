import { msg, useInterfaceLanguage, interfaceLanguage } from '../i18n';
import {useRef} from "react";

/** Use explicit segments so year/month/day have the same predictable keyboard behavior. */
export function DateTimeInput({value,onChange,onCommit,onCancel,label,includeTime=true,autoFocus=true}:{value:string;onChange:(value:string)=>void;onCommit:()=>void;onCancel:()=>void;label:string;includeTime?:boolean;autoFocus?:boolean}) {
  useInterfaceLanguage();
  const refs=useRef<(HTMLInputElement|null)[]>([]);
  const parts=value.split(/[-T:]/);
  const fields=Array.from({length:5},(_,index)=>parts[index] ?? "");
  const names=[msg('DateTimeInput.m0384'),msg('DateTimeInput.m0385'),msg('DateTimeInput.m0386'),msg('DateTimeInput.m0387'),msg('DateTimeInput.m0388')].slice(0,includeTime?5:3);
  const separators=interfaceLanguage() === 'en' ? ['-', '-', ' ', ':', ''] : [msg('DateTimeInput.m0389'),msg('DateTimeInput.m0390'),msg('DateTimeInput.m0391'),":",""];
  return <span className="date-time-input" role="group" aria-label={label}
    onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))onCommit();}}
    onKeyDown={e=>{e.stopPropagation();if(e.nativeEvent.isComposing)return;if(e.key==="Escape"){e.preventDefault();onCancel();}else if(e.key==="Enter"){e.preventDefault();onCommit();}}}>
    {names.map((name,index)=><span className="date-time-field" key={index}>
      <input ref={element=>{refs.current[index]=element;}} autoFocus={autoFocus && index===0} className={index===0?"date-time-year":""}
        type="text" inputMode="numeric" aria-label={`${label}：${name}`} placeholder={index===0?"----":"--"}
        maxLength={index===0?4:2} value={fields[index]??""} onFocus={e=>e.currentTarget.select()}
        onChange={e=>{
          let text=e.target.value.replace(/\D/g,"").slice(0,index===0?4:2);
          const input=e.nativeEvent as InputEvent;
          const deleting=input.inputType?.startsWith("delete");
          // A digit that cannot begin a valid two-digit value is complete already.
          const maxFirstDigit=[9,1,3,2,5][index];
          if(!deleting && index>0 && text.length===1 && Number(text)>maxFirstDigit)text=`0${text}`;
          const next=[...fields];next[index]=text;
          const date=`${next[0]}-${next[1]}-${next[2]}`.replace(/-+$/, "");
          onChange(next.every(v=>!v)?"":date+(includeTime && (next[3] || next[4]) ? `T${next[3]}:${next[4]}` : ""));
          if(text.length===(index===0?4:2) && !deleting)refs.current[index+1]?.focus();
        }}/><span aria-hidden="true">{separators[index]}</span>
    </span>)}
  </span>;
}
