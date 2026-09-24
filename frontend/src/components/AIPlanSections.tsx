import { builtinText } from '../i18n/builtinText';
import { msg, useInterfaceLanguage } from '../i18n';
import { trapDialogFocus } from "../lib/dialogFocus";
import { ENGLISH_EDITING_RULES } from '../lib/englishEditingRules';
import { EDITING_PRESETS, presetInstructions } from "../lib/editingPresets";
import { aiRequest, learningExample, type AIExample } from "../lib/aiEditing";
import type { Transcript } from "../types";

import { useEffect, useRef, useState } from "react";
import { SegmentPicker } from "./SegmentPicker";
import { formInstructions, parsePlanRule, type EditingPlan, type PlanForms } from "../lib/planForms";
type Form = PlanForms["custom"];

export function AIPlanSections({plans,onSaved,onDeleted,active,onUse,forms,onChange,transcript,original,engineId,hasEngine,disabled,run}:{
  plans:EditingPlan[];onDeleted:(id:string)=>void;onSaved:(plan:EditingPlan)=>void;active:EditingPlan;onUse:(plan:EditingPlan)=>void;
  forms:PlanForms;onChange:(forms:PlanForms)=>void;transcript:Transcript;original:Transcript|null;engineId:string;hasEngine:boolean;disabled:boolean;
  run:(label:string,work:(signal:AbortSignal)=>Promise<void>)=>Promise<void>;
}) {
  useInterfaceLanguage();
  const mode=forms.mode??"common";
  const update=(kind:"custom"|"extracted",patch:Partial<Form>)=>onChange({...forms,[kind]:{...forms[kind],...patch}});
  const instructions=formInstructions;
  const [generating,setGenerating]=useState(false);
  const [editing,setEditing]=useState<"custom"|"extracted"|null>(null);
  const review=useRef<HTMLDivElement>(null);
  const [generation,setGeneration]=useState(0);
  useEffect(()=>{if(generation)review.current?.scrollIntoView?.({block:"start",behavior:"smooth"});},[generation]);
  const commonPlans=[...EDITING_PRESETS.map(p=>({id:`builtin:${p.id}`,name:p.name,instructions:presetInstructions(p),summary:p.summary})),...plans.filter(p=>p.common!==false).map(p=>({...p,summary:p.instructions.split("\n")[0]}))];
  function applyForm(kind:"custom"|"extracted",save:boolean,updateExisting=false){
    const form=forms[kind];const text=instructions(form);
    void run(save?msg('AIPlanSections.m0256'):msg('AIPlanSections.m0257'),async signal=>{
      if(!text)throw new Error(msg('AIPlanSections.m0258'));
      if(text.length>6000)throw new Error(msg('AIPlanSections.m0259'));
      if(!form.name.trim())throw new Error(msg('AIPlanSections.m0260'));
      let plan:EditingPlan={id:"",name:form.name.trim(),instructions:text,common:false};
      if(save){
        if(updateExisting&&!plans.some(p=>p.id===form.id))throw new Error(msg('AIPlanSections.m0261'));
        plan=await aiRequest<EditingPlan>(updateExisting?`plans/${form.id}`:"plans",{name:plan.name,instructions:text,common:true},signal,updateExisting?"PUT":"POST");
        if(signal.aborted)return;
        onSaved(plan);
      }
      update(kind,{id:plan.id,name:plan.name,common:save});onUse(plan);setEditing(null);
    });
  }
  function removePlan(plan:EditingPlan){
    if(!window.confirm(msg('AIPlanSections.m0262', { v0: builtinText(plan.id, plan.name) })))return;
    void run(msg('AIPlanSections.m0263'),async signal=>{
      await aiRequest(`plans/${plan.id}`,undefined,signal,"DELETE");
      if(signal.aborted)return;
      onDeleted(plan.id);
    });
  }
  async function extract(){
    const form=forms.extracted;
    if(form.rules.some(r=>r.text.trim())&&!window.confirm(msg('AIPlanSections.m0264')))return;
    setGenerating(true);
    try{await run(msg('AIPlanSections.m0265'),async signal=>{
      const example:AIExample=learningExample(original,transcript.segments.slice(forms.first,forms.last+1),`片段${forms.first+1}–${forms.last+1}`);
      if(example.before===example.after)throw new Error(msg('AIPlanSections.m0267'));
      const result=await aiRequest<{rules?:string[]}>("learn",{instructions:"",examples:[example],engine_id:engineId||undefined},signal);
      if(signal.aborted)return;
      const rules=result.rules?.map(text=>text.trim()).filter(Boolean)??[];
      if(!rules.length)throw new Error(msg('AIPlanSections.m0268'));
      if(rules.join("\n\n").length>6000)throw new Error(msg('AIPlanSections.m0269'));
      update("extracted",{generated:true,id:"",common:false,rules:rules.map(parsePlanRule)});
      setEditing("extracted");setGeneration(n=>n+1);
    });}finally{setGenerating(false);}
  }
  function editor(kind:"custom"|"extracted"){
    const form=forms[kind];const prefix=kind==="custom"?msg('AIPlanSections.m0270'):msg('AIPlanSections.m0271');
    const confirmed=editing!==kind&&!!active.instructions&&active.instructions===instructions(form)&&active.name===form.name.trim();
    const hasRules=!!instructions(form);
    return <div className={`ai-plan-rule-editor ai-plan-rule-editor--${kind}`} ref={kind==="extracted"?review:undefined}>
      {kind==="extracted"&&<><h4>{msg('AIPlanSections.m0272')}</h4><p className="ai-subtitle">{msg('AIPlanSections.m0273')}</p></>}
      {form.rules.map((rule,i)=><div className="ai-compose-rule" key={i}>
        <div className="ai-rule-heading">
          {kind==="extracted"&&<input className="ripple-checkbox" type="checkbox" aria-label={msg('AIPlanSections.m0274', { v0: i+1 })} checked={rule.checked} disabled={disabled||confirmed} onChange={e=>update(kind,{rules:form.rules.map((r,j)=>j===i?{...r,checked:e.target.checked}:r)})}/>}
          <span className="ai-rule-number">{i+1}</span>
          <input className="ai-rule-title" aria-label={msg('AIPlanSections.m0275', { v0: prefix, v1: i+1 })} readOnly={confirmed} maxLength={32} value={rule.title??""} placeholder={rule.text.length<=24&&rule.text.trim()?rule.text:msg('AIPlanSections.m0276', { v0: i+1 })} onChange={e=>update(kind,{rules:form.rules.map((r,j)=>j===i?{...r,title:e.target.value}:r)})}/>
          {!confirmed&&form.rules.length>1&&<button type="button" className="button ai-rule-delete" aria-label={msg('AIPlanSections.m0277', { v0: prefix, v1: i+1 })} onClick={()=>update(kind,{rules:form.rules.filter((_,j)=>j!==i)})}>{msg('AIPlanSections.m0278')}</button>}
        </div>
        <textarea rows={kind==="custom"?4:2} maxLength={6000} readOnly={confirmed} aria-label={msg('AIPlanSections.m0279', { v0: prefix, v1: i+1 })} value={rule.text} onChange={e=>update(kind,{rules:form.rules.map((r,j)=>j===i?{...r,text:e.target.value}:r)})} placeholder={msg('AIPlanSections.m0280')}/>
      </div>)}
      {!confirmed&&<div className="ai-actions"><button type="button" className="button ai-plan-outline" onClick={()=>update(kind,{rules:[...form.rules,{text:"",checked:true}]})}>{msg('AIPlanSections.m0281')}</button>
        {kind === "custom" && ENGLISH_EDITING_RULES.map(rule => <button type="button" className="button ai-plan-outline" key={rule.id} disabled={disabled || form.rules.some(r => r.text === rule.text)} onClick={() => update(kind, { rules: [...form.rules, { text: rule.text, checked: true }] })}>{msg(`review.${rule.id}`)}</button>)}
      </div>}
      <label className="field ai-new-plan-name"><span>{msg('AIPlanSections.m0282')}<span className="ai-required" aria-hidden="true">*</span></span><input aria-label={msg('AIPlanSections.m0283', { v0: prefix })} aria-required="true" readOnly={confirmed} maxLength={100} value={form.name} onChange={e=>update(kind,{name:e.target.value})} placeholder={msg('AIPlanSections.m0284')}/></label>
      {confirmed?<div className="ai-actions ai-plan-confirmed"><span>{msg('AIPlanSections.m0285')}{active.name}</span><button type="button" className="button ai-plan-outline" onClick={()=>setEditing(kind)}>{msg('AIPlanSections.m0286')}</button><button type="button" className="button ai-confirmed-button" disabled>{msg('AIPlanSections.m0287')}</button></div>:<div className="ai-actions ai-plan-save-actions">
        <button type="button" className="button ai-plan-outline" disabled={!hasRules||!form.name.trim()} onClick={()=>applyForm(kind,false)}>{msg('AIPlanSections.m0288')}</button>
        <button type="button" className="button button--primary" disabled={!hasRules||!form.name.trim()} onClick={()=>applyForm(kind,true)}>{msg('AIPlanSections.m0289')}</button>
        {kind==="custom"&&form.id&&<button type="button" className="button ai-plan-outline" disabled={!hasRules||!form.name.trim()} onClick={()=>applyForm(kind,true,true)}>{msg('AIPlanSections.m0290')}</button>}
      </div>}
    </div>;
  }
  return <div className="ai-plan-sections">
    <div className="ai-source-switch" role="radiogroup" aria-label={msg('AIPlanSections.m0291')}>{([{id:"common",label:msg('AIPlanSections.m0292')},{id:"extracted",label:msg('AIPlanSections.m0293')},{id:"custom",label:msg('AIPlanSections.m0294')}] as const).map(item=><label className="ai-source-option" key={item.id}><input className="sr-only" type="radio" name="ai-plan-source" checked={mode===item.id} disabled={disabled} onChange={()=>onChange({...forms,mode:item.id})}/><span>{item.label}</span></label>)}</div>
    <section className="ai-section" hidden={mode!=="common"} aria-label={msg('AIPlanSections.m0295')}><h3>{msg('AIPlanSections.m0296')}</h3>
      <div className="ai-common-plans">{commonPlans.map((plan,i)=><div className="ai-common-plan" key={plan.id}>
        <label className="ai-check" htmlFor={`ai-plan-choice-${i}`}><input className="ripple-checkbox" id={`ai-plan-choice-${i}`} type="checkbox" aria-label={msg('AIPlanSections.m0297', { v0: builtinText(plan.id, plan.name) })} disabled={disabled} checked={active.id===plan.id&&active.instructions===plan.instructions} onChange={e=>onUse(e.target.checked?plan:{id:"",name:"",instructions:""})}/><strong>{builtinText(plan.id, plan.name)}</strong></label>
        <button type="button" className="ai-info-button" data-tip={msg('AIPlanSections.m0298')} aria-label={msg('AIPlanSections.m0299', { v0: builtinText(plan.id, plan.name) })} popoverTarget={`ai-plan-info-${i}`}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.5" r=".8" fill="currentColor" stroke="none"/></svg></button>
        <label htmlFor={`ai-plan-choice-${i}`} className="ai-plan-summary">{builtinText(plan.id, plan.summary)}</label>
        <div id={`ai-plan-info-${i}`} popover="auto" className="ai-plan-info" role="dialog" aria-label={msg('AIPlanSections.m0300', { v0: builtinText(plan.id, plan.name) })} onKeyDown={trapDialogFocus}
          onToggle={event => { if (event.newState === "open") event.currentTarget.querySelector<HTMLButtonElement>(".ai-plan-info-close")?.focus(); }}>
          <div className="ai-plan-info-header"><h3>{builtinText(plan.id, plan.name)}</h3><div className="ai-actions">
            {!plan.id.startsWith("builtin:")&&<><button type="button" className="button ai-plan-manage-edit" disabled={disabled} popoverTarget={`ai-plan-info-${i}`} popoverTargetAction="hide" onClick={()=>onChange({...forms,mode:"custom",custom:{id:plan.id,name:plan.name,rules:plan.instructions.split("\n\n").map(parsePlanRule),common:true}})}>{msg('AIPlanSections.m0301')}</button><button type="button" className="button ai-plan-manage-delete" disabled={disabled} onClick={()=>removePlan(plan)}>{msg('AIPlanSections.m0302')}</button></>}
            <button type="button" className="ai-plan-info-close" popoverTarget={`ai-plan-info-${i}`} popoverTargetAction="hide" aria-label={msg('AIPlanSections.m0303')}><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
          </div></div>
          <ul>{plan.instructions.split(/\n+/).filter(Boolean).map((r,j)=><li key={j}>{builtinText(plan.id, r)}</li>)}</ul>
        </div>
      </div>)}</div>
    </section>
    <section className="ai-section" hidden={mode!=="extracted"} aria-label={msg('AIPlanSections.m0304')}><h3>{msg('AIPlanSections.m0305')}</h3><p className="ai-subtitle">{msg('AIPlanSections.m0306')}</p>
      <div className="ai-range">{[msg('AIPlanSections.m0307'),msg('AIPlanSections.m0308')].map((label,i)=><div className="field" key={label}><span>{label}</span><SegmentPicker segments={transcript.segments} label={msg('AIPlanSections.m0309', { v0: label })} value={i===0?forms.first:forms.last} min={i===0?0:forms.first} disabled={disabled} onChange={n=>onChange({...forms,...(i===0?{first:n,last:Math.max(n,forms.last)}:{last:n})})}/></div>)}</div>
      <div className="ai-actions"><button type="button" className="button button--primary" disabled={disabled||!hasEngine||!original||!transcript.segments.length} onClick={()=>void extract()}>{msg('AIPlanSections.m0310')}</button></div>
      {generating&&<div className="ai-processing-banner ai-processing-local" role="status" aria-live="polite"><span className="ai-processing-spinner" aria-hidden="true"/><span>{msg('AIPlanSections.m0311')}</span></div>}
      {!original&&<p className="ai-subtitle">{msg('AIPlanSections.m0312')}</p>}
      {mode==="extracted"&&(forms.extracted.generated||forms.extracted.rules.some(r=>r.text.trim()))&&editor("extracted")}
    </section>
    <section className="ai-section" hidden={mode!=="custom"} aria-label={msg('AIPlanSections.m0313')}><h3>{msg('AIPlanSections.m0314')}</h3><p className="ai-subtitle">{msg('AIPlanSections.m0315')}</p>{mode==="custom"&&editor("custom")}</section>
  </div>;
}
