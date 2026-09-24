import { builtinText } from '../i18n/builtinText';
import { msg, useInterfaceLanguage } from '../i18n';
import { useState } from "react";
import { BUILTIN_EDITING_RULES, BUILTIN_RULE_EXAMPLES, type SavedAIPreference } from "../lib/aiEditing";

export function AIEditingRules({rules, selected, onToggle, onSave, onDelete, onDirty, preferences = false, onCommon}: {
  preferences?: boolean; onCommon?: (id:string, common:boolean)=>Promise<void>;
  rules: SavedAIPreference[]; selected: Set<string>; onToggle: (id:string) => void;
  onSave: (id:string, text:string) => Promise<void>; onDelete:(id:string)=>Promise<void>;
  onDirty:(value:boolean)=>void;
}) {
  useInterfaceLanguage();
  const noun = preferences ? msg('AIEditingRules.m0234') : msg('AIEditingRules.m0235');
  const [draft,setDraft]=useState<{id:string;text:string}|null>(null);
  const [dirty,setDirty]=useState(false);
  const edit=(value:typeof draft)=>{if(dirty && !window.confirm(msg('AIEditingRules.m0236', { v0: noun })))return;setDraft(value);setDirty(false);onDirty(false);};
  return <section className="ai-section ai-rules">
    {!preferences && <div className="ai-section-heading ai-rules-heading"><h3>{msg('AIEditingRules.m0237')}</h3><span>{msg('AIEditingRules.m0238')}</span></div>}
    {!preferences && <div className="ai-rule-list">{BUILTIN_EDITING_RULES.map(rule=><div className="ai-rule-row" key={rule.id}>
      <label className="ai-check"><input type="checkbox" checked={selected.has(rule.id)} onChange={()=>onToggle(rule.id)}/><span><strong>{builtinText(rule.id, rule.name)}: </strong>{builtinText(rule.id, rule.instructions)}</span></label>
      <p className="ai-subtitle">{builtinText(rule.id, BUILTIN_RULE_EXAMPLES[rule.id])}</p>
    </div>)}</div>}
    {rules.length > 0 && <div className="ai-rule-list">{rules.map(rule=><div className="ai-rule-row" key={rule.id}>
      <label className="ai-check"><input type="checkbox" checked={selected.has(rule.id)} onChange={()=>onToggle(rule.id)}/><span>{rule.instructions}{rule.examples.length > 0 && <small className="ai-rule-source">{preferences ? (rule.common === false ? msg('AIEditingRules.m0239') : msg('AIEditingRules.m0240')) : msg('AIEditingRules.m0241')}</small>}</span></label>
      {preferences && <button type="button" className="button ai-rule-icon" data-tip={rule.common === false ? msg('AIEditingRules.m0242') : msg('AIEditingRules.m0243')} aria-label={`${rule.common === false ? msg('AIEditingRules.m0244') : msg('AIEditingRules.m0245')}：${rule.name}`} aria-pressed={rule.common !== false} onClick={()=>void onCommon?.(rule.id,rule.common === false).catch(()=>{})}><svg width="16" height="16" viewBox="0 0 24 24" fill={rule.common === false ? "none" : "currentColor"} stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9Z"/></svg></button>}
      <button type="button" className="button ai-rule-icon" data-tip={msg('AIEditingRules.m0246')} aria-label={msg('AIEditingRules.m0247', { v0: noun, v1: rule.name })} onClick={()=>edit({id:rule.id,text:rule.instructions})}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m16 3 5 5-12 12-6 1 1-6Z"/><path d="m14 5 5 5"/></svg></button>
      <button type="button" className="button ai-rule-icon" data-tip={msg('AIEditingRules.m0248')} aria-label={msg('AIEditingRules.m0249', { v0: noun, v1: rule.name })} onClick={()=>{if(window.confirm(msg('AIEditingRules.m0250', { v0: noun }))) void onDelete(rule.id);}}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 10v8m4-8v8"/></svg></button>
    </div>)}</div>}
    {!draft && !preferences && <button className="button" onClick={()=>edit({id:"",text:""})}>{msg('AIEditingRules.m0251')}</button>}
    {draft && <div className="ai-preference-form">
      <label className="field"><span>{noun}{msg('AIEditingRules.m0252')}</span><textarea rows={3} maxLength={6000} value={draft.text} placeholder={msg('AIEditingRules.m0253')} onChange={e=>{setDraft({...draft,text:e.target.value});onDirty(true);setDirty(true);}}/></label>
      <div className="ai-actions"><button className="button button--primary" disabled={!draft.text.trim()} onClick={()=>void onSave(draft.id,draft.text.trim()).then(()=>{setDraft(null);setDirty(false);onDirty(false);}).catch(()=>{})}>{msg('AIEditingRules.m0254')}{noun}</button><button className="button" onClick={()=>edit(null)}>{msg('AIEditingRules.m0255')}</button></div>
    </div>}
  </section>;
}
