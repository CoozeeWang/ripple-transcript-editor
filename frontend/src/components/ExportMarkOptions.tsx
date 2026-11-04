import './exportMarkOptions.css';
import {msg,useInterfaceLanguage} from '../i18n';
import {exportMarkCapabilities,type ExportMarkOptions as Options} from '../lib/exportOptions';
import type {ExportFormat} from '../lib/export';
export function ExportMarkOptions({format,value,onChange,disabled=false,menu=false,heading}:{heading?:string;format:ExportFormat;value:Options;onChange:(value:Options)=>void;disabled?:boolean;menu?:boolean}){
 useInterfaceLanguage();const keys=exportMarkCapabilities(format);if(!keys.length)return null;
 return <fieldset className="export-mark-options" disabled={disabled}><legend className="sr-only">{heading??msg('export.includeMarks')}</legend><span className="export-mark-prefix" aria-hidden="true">{heading??msg('export.includeMarks')}</span>{keys.map(key=><label key={key}><input className="ripple-checkbox" type="checkbox" role={menu?'menuitemcheckbox':undefined} aria-checked={value[key]} checked={value[key]} onChange={event=>onChange({...value,[key]:event.target.checked})}/>{msg(`export.include_${key}`)}</label>)}</fieldset>;
}
