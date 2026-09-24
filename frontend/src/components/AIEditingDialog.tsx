import { builtinText } from '../i18n/builtinText';
import { msg, uiMessage, useInterfaceLanguage, isMessage } from '../i18n';
import { trapDialogFocus } from '../lib/dialogFocus';
import { resumeResults, type EditResume } from "../lib/editResume";
import { startEditingTiming } from "../lib/editingTimings";
import { recordProblem } from "../lib/diagnostics";
import { CopyProblem } from "./CopyProblem";
import { runEditBatches } from "../lib/editBatchRunner";
import { SegmentPicker } from "./SegmentPicker";
import { AIPlanSections } from "./AIPlanSections";
import { emptyPlanForms, restorePlanForms, formInstructions, type PlanForms, type EditingPlan } from "../lib/planForms";
import { revisionFor, decideRevision, resolvedSuggestion, type TrialState, type RevisionState } from "../lib/revisions";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Transcript } from "../types";
import {
  BUILTIN_EDITING_RULES, aiRequest, batchSegments,
  type AIConfig, type AIExample, type AISuggestion, type SavedAIPreference,
} from "../lib/aiEditing";
import "./aiEditing.css";


interface CandidatePreference {id:number;text:string;title?:string;description?:string;checked:boolean;example?:AIExample}

export interface AIReviewDraft {
  resume?: EditResume;
  nameSource?: "user";
  mode?: "setup" | "trial" | "formal";
  trial?: TrialState;
  reviews?: Record<string,RevisionState>;
  baseline: Transcript; suggestions: AISuggestion[]; accepted: string[]; label: string; name: string; complete: boolean;
  options?: {forms?:PlanForms;planId?:string; planName?:string; planInstructions?:string; ruleIds: string[]; engineId: string; whole: boolean; first: number; last: number; learned?: CandidatePreference[]};
}

interface Props {
  loadDocumentId?: () => Promise<string>;
  sourceLabel?: string;
  suggestedName?: string;
  loadDraft?: () => Promise<AIReviewDraft | null>;
  saveDraft?: (draft: AIReviewDraft | null) => Promise<void>;
  transcript: Transcript;
  source: string;
  selectedId: string;
  loadOriginal: () => Promise<Transcript | null>;
  onClose: () => void;
  onSettings: () => void;
  onApply: (suggestions: AISuggestion[], label: string) => Promise<void>;
}

function generationRangeLabel(label: string) {
  const part = label.split(" · ").find(value => /^(全文|片段\s*\d+[–—-]\d+)$/.test(value));
  if (part === '全文') return msg('extra.wholeTranscript');
  if (part) return msg('AIEditingDialog.m0189', { v0: part.replace(/^片段\s*/, '') });
  return msg('AIEditingDialog.m0190');
}
export function AIEditingDialog({ transcript, source, loadOriginal, onClose, onSettings, onApply, sourceLabel = msg('AIEditingDialog.m0148'), suggestedName = "AI 编辑稿", loadDraft, saveDraft, loadDocumentId }: Props) {
  useInterfaceLanguage();
  const [forms,setForms] = useState<PlanForms>(emptyPlanForms);
  const [plans, setPlans] = useState<EditingPlan[]>([]);
  const [planId, setPlanId] = useState("");
  const [planName, setPlanName] = useState("");
  const [planInstructions, setPlanInstructions] = useState("");
  const formDirty = JSON.stringify(forms)!==JSON.stringify(emptyPlanForms());
  const planDirty = Boolean(planName.trim() || planInstructions.trim());
  // Preserve historical review data when rewriting an older draft. No trial UI or requests remain.
  const [legacyTrial,setLegacyTrial]=useState<TrialState>();
  const [reviews,setReviews]=useState<Record<string,RevisionState>>({});
  const [ruleIds, setRuleIds] = useState<Set<string>>(new Set());
  const [documentId, setDocumentId] = useState(source);
  const [profiles, setProfiles] = useState<SavedAIPreference[]>([]);
  const [learned, setLearned] = useState<CandidatePreference[]>([]);
  const [original, setOriginal] = useState<Transcript | null>(null);
  const [config, setConfig] = useState<AIConfig | null>(null);
  const [engineId, setEngineId] = useState("");
  const selectedEngine = config?.engines?.find(e => e.id === engineId);
  const hasEngine = config?.engines ? Boolean(selectedEngine) : Boolean(config?.configured);
  const [draftConflict, setDraftConflict] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, updateError] = useState("");
  const setError = useCallback((message: string) => {
    if (message) recordProblem("editing", new Error(message));
    updateError(message);
  }, []);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const [whole, setWhole] = useState(true);
  const [resume, setResume] = useState<EditResume>();
  const [complete, setComplete] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [versionName, setVersionName] = useState(suggestedName);
  const [userNamed, setUserNamed] = useState(false);
  const [namingOpen, setNamingOpen] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const startButtonRef = useRef<HTMLButtonElement>(null);
  const wasNaming = useRef(false);
  useEffect(() => {
    if (namingOpen) nameInputRef.current?.focus();
    else if (wasNaming.current) startButtonRef.current?.focus();
    wasNaming.current = namingOpen;
  }, [namingOpen]);
  const published = useRef(false);
  const draftQueue = useRef(Promise.resolve());
  const draftIO = useRef({loadDraft, saveDraft, loadDocumentId});
  const naming = useRef({sourceLabel, suggestedName});
  const [first, setFirst] = useState(0);
  const [last, setLast] = useState(transcript.segments.length - 1);
  const [suggestions, setSuggestions] = useState<AISuggestion[]>([]);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [generationLabel, setGenerationLabel] = useState("");
  const controller = useRef<AbortController | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const mounted = useRef(false);
  const selection = whole ? transcript.segments : transcript.segments.slice(first, last + 1);
  function draft(values: Partial<AIReviewDraft> = {}): AIReviewDraft {
    return {nameSource:userNamed?"user":undefined,resume,mode:generated?"formal":"setup",trial:legacyTrial,reviews,baseline: transcript, suggestions, accepted: [...accepted], label: generationLabel, name: versionName, complete, options: {forms,planId, planName, planInstructions, ruleIds: [...ruleIds], engineId, whole, first, last, learned}, ...values};
  }
  async function persist(values: Partial<AIReviewDraft> = {}) {
    const value = draft(values);
    const write = draftQueue.current.catch(() => {}).then(() => draftIO.current.saveDraft?.(value));
    draftQueue.current = write;
    await write;
  }
  const isPreference = (p: SavedAIPreference) => p.kind === "style" || p.examples.length > 0;
  const visibleProfiles = profiles.filter(p => p.common !== false || p.document_id === documentId);
  const explicitRules = visibleProfiles.filter(p => !isPreference(p));
  const savedPreferences = visibleProfiles.filter(isPreference);
  const selectedRules = [...BUILTIN_EDITING_RULES, ...explicitRules].filter(p => ruleIds.has(p.id));
  const selectedPreferences = [
    ...(planInstructions.trim() ? [{id:"plan",name:planName || "本次编辑规则",instructions:planInstructions.trim(),examples:[] as AIExample[]}] : []),
    ...savedPreferences.filter(p => ruleIds.has(p.id)),
  ];
  const requirements = [...selectedRules, ...selectedPreferences];
  const preference = { name: "编辑偏好", instructions: selectedPreferences.map(p => p.instructions).join("\n\n") || "保留原有表达，仅执行明确规则。", examples: [...new Map(selectedPreferences.flatMap(p => p.examples).map(example=>[JSON.stringify(example),example])).values()] };



  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);

  useEffect(() => {
    const modal = dialog.current;
    const previous = document.activeElement;
    modal?.showModal();
    return () => {
      if (modal?.open) modal.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    let stale = false;
    const abort = new AbortController();
    Promise.all([aiRequest<SavedAIPreference[]>("preferences", undefined, abort.signal),
      aiRequest<AIConfig>("config", undefined, abort.signal), loadOriginal(), draftIO.current.loadDraft?.() ?? Promise.resolve(null), draftIO.current.loadDocumentId?.() ?? Promise.resolve(source), aiRequest<EditingPlan[]>("plans", undefined, abort.signal)]).then(([list, value, raw, saved, docId, savedPlans]) => {
      if (stale) return;
      setPlans(savedPlans); setDocumentId(docId); setProfiles(list); setConfig(value); setEngineId(value.selected_engine_id ?? ""); setOriginal(raw); setReady(true); setError("");
      if (saved) {
        if (JSON.stringify(saved.baseline) !== JSON.stringify(transcript)) {
          setError(msg('AIEditingDialog.m0153'));
          setDraftConflict(true);
        } else {
          setResume(saved.resume);
          setUserNamed(saved.nameSource === "user");
          setLegacyTrial(saved.trial);
          const isSetup=saved.mode==="setup"||saved.mode==="trial";
          setReviews(saved.reviews ?? Object.fromEntries(saved.suggestions.map(s=>[s.id,saved.accepted.includes(s.id)?decideRevision(revisionFor(transcript.segments.find(p=>p.id===s.id)!.text,s),"accept"):revisionFor(transcript.segments.find(p=>p.id===s.id)!.text,s)])));
          setSuggestions(saved.suggestions); setAccepted(new Set(saved.accepted)); setGenerationLabel(saved.label);
          const restoredForms=restorePlanForms(saved.options,saved.mode==="trial"?saved.trial:undefined,savedPlans);
          setForms(restoredForms);
          if(saved.options){
            const options=saved.options;
            setPlanId(options.planId?.startsWith("builtin:")||savedPlans.some(p=>p.id===options.planId)?options.planId!:"");
            setPlanName(options.planName??"");setPlanInstructions(options.planInstructions??"");setRuleIds(new Set(options.ruleIds));
            setEngineId(options.engineId);setWhole(options.whole);setFirst(options.first);setLast(options.last);setLearned(options.learned??[]);
          }

          setVersionName(saved.nameSource === "user" ? saved.name : /^修改稿 v\d+ · AI 编辑$/.test(saved.name) || saved.name === "AI 编辑稿" ? naming.current.suggestedName : saved.name.startsWith(naming.current.sourceLabel + " · AI 修改稿 ") ? saved.name.replace(" · AI 修改稿 ", " · AI 辅助 ") : saved.name); setComplete(saved.complete); setGenerated(!isSetup);
          setNotice(isSetup ? msg('AIEditingDialog.m0158') : saved.complete ? msg('AIEditingDialog.m0159') : saved.resume ? msg('AIEditingDialog.m0160') : msg('AIEditingDialog.m0161'));
        }
      }
    }).catch(e => { if (!stale) setError(e.message); });
    return () => { stale = true; abort.abort(); };
  }, [loadOriginal, reload, transcript, source, setError]);

  useEffect(() => {
    if ((!generated && !legacyTrial && !planDirty && !formDirty) || !ready || draftConflict || busy || saving || published.current) return;
    const value: AIReviewDraft = {nameSource:userNamed?"user":undefined,resume,mode:generated?"formal":"setup",trial:legacyTrial,reviews,baseline: transcript, suggestions, accepted: [...accepted], label: generationLabel, name: versionName, complete, options: {forms,planId, planName, planInstructions, ruleIds: [...ruleIds], engineId, whole, first, last, learned}};
    const timer=window.setTimeout(()=>{
      const write = draftQueue.current.catch(() => {}).then(() => draftIO.current.saveDraft?.(value));
      draftQueue.current = write;
      void write.catch(() => { if (mounted.current) setError(msg('AIEditingDialog.m0162')); });
    },350);
    return()=>window.clearTimeout(timer);
  }, [userNamed, resume, generated, busy, saving, transcript, suggestions, accepted, generationLabel, versionName, complete, ruleIds, engineId, whole, first, last, learned, legacyTrial, reviews, planId, planName, planInstructions, planDirty, ready, draftConflict, forms, formDirty, setError]);

  async function run(label: string, work: (signal: AbortSignal) => Promise<void>) {
    if (controller.current) return;
    const abort = new AbortController(); controller.current = abort;
    setBusy(label); setError(""); setNotice("");
    try { await work(abort.signal); }
    catch (e) {
      if (!mounted.current) return;
      if (abort.signal.aborted) setNotice(msg('AIEditingDialog.m0163'));
      else { setError(e instanceof Error ? e.message : msg('AIEditingDialog.m0164')); }
    } finally {
      if (controller.current === abort) controller.current = null;
      if (mounted.current) setBusy("");
    }
  }

  function generate(continuing = false, requestedName = versionName) {
    const outputName = (continuing ? versionName : requestedName).trim();
    if (!outputName || outputName.length > 100) return;
    if (!continuing && generated && !window.confirm(msg('AIEditingDialog.m0165'))) return;
    setNamingOpen(false);
    setVersionName(outputName);
    if (!continuing) setUserNamed(true);
    void run(msg('AIEditingDialog.m0166'), async signal => {
      const timing = startEditingTiming(signal, selection.length, selection.reduce((n, s) => n + s.text.length, 0));
      let succeeded = false;
      try {
      const fresh = await aiRequest<AIConfig>("config", undefined, signal);
      const engine = fresh.engines?.find(e=>e.id===engineId);
      const revision = engine?.revision ?? fresh.revision;
      const signature = JSON.stringify({version:1,engineId,revision,model:engine?.model??fresh.model,preference,rules:selectedRules.map(r=>r.instructions)});
      let checkpoint: EditResume;
      let initial = new Map<number, AISuggestion[]>();
      if (continuing) {
        if (!resume) throw new Error(msg('AIEditingDialog.m0167'));
        initial = resumeResults(resume, selection, signature);
        checkpoint = resume;
      } else {
        checkpoint = {version:1,signature,batches:batchSegments(selection).map(b=>b.map(s=>s.id)),completed:[]};
      }
      const byId = new Map(selection.map(s=>[s.id,s]));
      const batches = checkpoint.batches.map(ids=>ids.map(id=>byId.get(id)!));
      const label = `${sourceLabel} · ${whole ? "全文" : `片段${first + 1}–${last + 1}`} · ${requirements.map(r => r.name).join("、")}`;
      await timing.measure("prepare", () => persist({name:outputName,nameSource:continuing ? (userNamed ? "user" : undefined) : "user",resume:checkpoint,mode:"formal",suggestions: continuing ? suggestions : [], accepted: [], reviews:{}, label, complete: false}));
      setGenerated(true); setComplete(false); setGenerationLabel(label);
      setResume(checkpoint);
      if (!continuing) setSuggestions([]); setAccepted(new Set());setReviews({});
      setBusy(msg('AIEditingDialog.m0170', { v0: initial.size, v1: batches.length }));
      const originals = new Map(transcript.segments.map(s => [s.id, s.text]));
      const completed = await runEditBatches(batches, signal, async (batch, requestSignal) => {
        const value = await timing.measure("request", () => aiRequest<{ segments: AISuggestion[] }>("edit", { preference, rules: selectedRules.map(r => r.instructions), engine_id: engineId || undefined, engine_revision: revision,
          segments: batch.map(s => ({ id: s.id, text: s.text,
            speaker: transcript.speakers.find(p => p.id === s.speaker_id)?.name ?? s.speaker_id })) }, requestSignal), batches.indexOf(batch) + 1, batch.length, batch.reduce((n, s) => n + s.text.length, 0));
        const ids = new Set(value.segments.map(s => s.id));
        if (value.segments.length !== batch.length || ids.size !== batch.length || batch.some(s => !ids.has(s.id))) {
          throw new Error(msg('AIEditingDialog.m0171'));
        }
        return batch.map(s => value.segments.find(r => r.id === s.id)!);
      }, async (results, count, indexed) => {
        const partial = results.flat().filter(r => (r.action && r.action !== "edit") || originals.get(r.id) !== r.text);
        const saved: EditResume = {...checkpoint,completed:indexed.map(({index,value})=>({index,segments:value}))};
        setSuggestions(partial);
        await timing.measure("checkpoint", () => persist({name:outputName,nameSource:continuing ? (userNamed ? "user" : undefined) : "user",resume:saved,mode:"formal",suggestions: partial, accepted: [], reviews:{}, label, complete: false}), count);
        checkpoint = saved;
        if (mounted.current) setResume(saved);
        if (!signal.aborted) setBusy(msg('AIEditingDialog.m0172', { v0: count, v1: batches.length }));
      }, initial);
      const result = completed.flat();
      if (signal.aborted) return;
      const changes = selection.flatMap(s => {
        const value = result.find(r => r.id === s.id);
        return value && ((value.action && value.action !== "edit") || value.text !== s.text) ? [value] : [];
      });
      await timing.measure("final_checkpoint", () => persist({name:outputName,nameSource:continuing ? (userNamed ? "user" : undefined) : "user",resume:checkpoint,mode:"formal",suggestions: changes, accepted: [], reviews:{}, label, complete: true}));
      if (!mounted.current) return;
      setSuggestions(changes); setComplete(true);
      if (signal.aborted) return;
      succeeded = await timing.measure("publish", async () => {
        setBusy(msg('AIEditingDialog.m0173'));
        await apply(changes, true, outputName);
        return true;
      });
      } finally { timing.finish(succeeded); }
    });
  }

  async function apply(resolved: AISuggestion[], propagate = false, outputName = versionName) {
    setSaving(true); setError("");
    try {
      if (!published.current) {
        await onApply(resolved, outputName.trim());
        published.current = true;
      }
      await draftQueue.current.catch(() => {});
      await draftIO.current.saveDraft?.(null);
      onClose();
      return true;
    } catch (e) { if (propagate) throw e; if (mounted.current) setError(e instanceof Error ? e.message : msg('AIEditingDialog.m0174')); return false; }
    finally { if (mounted.current) setSaving(false); }
  }

  async function deleteReviewDraft() {
    if (locked || !window.confirm(msg('AIEditingDialog.m0175'))) return;
    setSaving(true); setError("");
    try {
      await draftQueue.current.catch(() => {});
      if (legacyTrial||planDirty||formDirty) await persist({resume:undefined,mode:"setup",suggestions:[],accepted:[],reviews:{},complete:false});
      else await draftIO.current.saveDraft?.(null);
      setResume(undefined);
      setGenerated(false); setSuggestions([]); setAccepted(new Set()); setReviews({});
      setComplete(false);
    } catch (e) { setError(e instanceof Error ? e.message : msg('AIEditingDialog.m0176')); }
    finally { setSaving(false); }
  }

  async function close() {
    if (saving) return;
    controller.current?.abort();
    try {
      // Generation checkpoints own the freshest results. A close-button render
      // may still contain the preceding batch, so never overwrite them with it.
      if (generatingSuggestions) await draftQueue.current;
      else if (!draftConflict&&(generated || legacyTrial || planDirty || formDirty)) await persist();
      onClose();
    }
    catch { setError(msg('AIEditingDialog.m0177')); }
  }
  async function openEngineSettings() {
    if (busy || saving) return;
    try { if (!draftConflict&&(generated || legacyTrial || planDirty || formDirty)) await persist(); onSettings(); }
    catch { setError(msg('AIEditingDialog.m0178')); }
  }
  function rangeFields(start: number, end: number, setStart: (n:number)=>void, setEnd: (n:number)=>void, prefix: string) {
    return <>{[msg('AIEditingDialog.m0179'), msg('AIEditingDialog.m0180')].map((label,field) => <div className="field" key={label}><span>{prefix}{label}</span><SegmentPicker segments={transcript.segments} label={`${prefix}${label}`} value={field===0?start:end} min={field===0?0:start} disabled={Boolean(busy)||saving} onChange={n=>{if(field===0){setStart(n);setEnd(Math.max(end,n));}else setEnd(n);}}/></div>)}</>;
  }
  const activeForm=(forms.mode??"common")==="common"?null:forms[forms.mode as "custom"|"extracted"];
  const canContinue=requirements.length>0&&(!activeForm||(formInstructions(activeForm)===planInstructions&&activeForm.name.trim()===planName));
  const locked = Boolean(busy) || saving;
  const generatingSuggestions = /^正在(?:准备修改建议|生成建议)/.test(busy);
  const editingInProgress = generatingSuggestions || isMessage(busy, 'AIEditingDialog.m0181');
  return <dialog ref={dialog} className={`ai-dialog${editingInProgress ? " ai-dialog--processing" : ""}`} aria-labelledby="ai-title" onCancel={e => { e.preventDefault(); close(); }}
    onKeyDown={e => { trapDialogFocus(e); e.stopPropagation(); }}>
    <div className="dialog-header"><div><h2 id="ai-title">{msg('AIEditingDialog.m0182')}</h2></div><button type="button" className="dialog-close" aria-label={msg('AIEditingDialog.m0183')} disabled={saving} onClick={close}>×</button></div>
    <div className="ai-body" aria-busy={Boolean(busy)}>
    {(generated || generatingSuggestions) && !draftConflict && <section className="ai-draft-list" aria-label={msg('AIEditingDialog.m0184')}>
      <h3 className="ai-draft-heading">{editingInProgress ? msg('AIEditingDialog.m0185') : msg('AIEditingDialog.m0186')} <span className="ai-draft-count">1</span></h3>
      <div className="ai-draft-row"><div className="ai-draft-info"><strong>{versionName}</strong><div className="ai-draft-meta"><span className="ai-draft-source">{msg('review.draftSource', { source: sourceLabel })}</span><span>{msg('AIEditingDialog.m0188', { range: generationRangeLabel(generationLabel) })}</span></div></div>
      <div className="ai-actions">{editingInProgress ? <>
        <div className="ai-draft-progress" role="status"><span className="ai-processing-spinner" aria-hidden="true"/><span>{uiMessage(busy)}</span></div>
        {generatingSuggestions && <button type="button" className="button ai-cancel-request" onClick={()=>controller.current?.abort()}>{msg('AIEditingDialog.m0191')}</button>}
      </> : <>
        <button className="button button--primary" disabled={locked || !complete} onClick={()=>void apply(suggestions.map(s=>reviews[s.id] ? resolvedSuggestion(transcript.segments.find(p=>p.id===s.id)!,s,{...reviews[s.id],operation:reviews[s.id].operation === "pending" ? "accept" : reviews[s.id].operation}) : s))}>{msg('AIEditingDialog.m0192')}</button>
        {!complete && resume && <button className="button button--primary" disabled={locked || !ready || !hasEngine || !canContinue} onClick={()=>generate(true)}>{msg('AIEditingDialog.m0193')}</button>}
        <button className="button" disabled={locked} onClick={()=>void deleteReviewDraft()}>{msg('AIEditingDialog.m0194')}</button>
      </>}</div></div>
    </section>}
      <div className="ai-configuration" inert={editingInProgress}>
      {!ready ? <p role={error ? "alert" : "status"} className={error ? "ai-error" : undefined}>{error || msg('AIEditingDialog.m0195')}{error && <button className="button" onClick={() => setReload(n => n + 1)}>{msg('AIEditingDialog.m0196')}</button>}</p> : <>

        {draftConflict && <div className="ai-callout">{msg('AIEditingDialog.m0197')}<button className="button" disabled={locked} onClick={() => {
          if (!window.confirm(msg('AIEditingDialog.m0198'))) return;
          void run(msg('AIEditingDialog.m0199'), async () => {await draftIO.current.saveDraft?.(null);setDraftConflict(false);});
        }}>{msg('AIEditingDialog.m0200')}</button></div>}
        <section className="ai-engine-section" aria-label={msg('AIEditingDialog.m0201')}><h3>{msg('AIEditingDialog.m0202')}</h3><p className="ai-cost-notice"><span className="ai-cost-badge" aria-hidden="true">!</span>{msg('AIEditingDialog.m0203')}</p>
        {!hasEngine && <div className="ai-callout">{config?.engines?.length ? msg('AIEditingDialog.m0204') : msg('AIEditingDialog.m0205')}<button className="button" disabled={locked} onClick={openEngineSettings}>{msg('AIEditingDialog.m0206')}</button></div>}
        {config?.engines && config.engines.length > 0 && <div className="ai-engine-picker"><label className="field"><span className="sr-only">{msg('AIEditingDialog.m0207')}</span><select value={engineId} disabled={locked} onChange={e => setEngineId(e.target.value)}><option value="">{msg('AIEditingDialog.m0208')}</option>{config.engines.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label><button type="button" className="button ai-engine-add" aria-label={msg('AIEditingDialog.m0209')} data-tip={msg('AIEditingDialog.m0210')} disabled={locked} onClick={openEngineSettings}>+</button></div>}
        {hasEngine && <p className="ai-subtitle">{msg('AIEditingDialog.m0211')}</p>}
        </section>
        <fieldset className="ai-fieldset" disabled={locked}>
          <div>
            <AIPlanSections plans={plans} forms={forms} onChange={value=>{setForms(value);if(value.mode!==forms.mode){setPlanId("");setPlanName("");setPlanInstructions("");setRuleIds(new Set());setLearned([]);}}} transcript={transcript} original={original} engineId={engineId} hasEngine={hasEngine} disabled={locked} run={run}
              active={{id:planId,name:planName,instructions:planInstructions}}
              onDeleted={id=>{
                setPlans(list=>list.filter(p=>p.id!==id));
                if(planId===id)setPlanId("");

                setForms(value=>({...value,custom:{...value.custom,id:value.custom.id===id?"":value.custom.id},extracted:{...value.extracted,id:value.extracted.id===id?"":value.extracted.id}}));
                setNotice(msg('AIEditingDialog.m0212'));
              }}
              onSaved={value=>setPlans(list=>[...list.filter(p=>p.id!==value.id),value])}
              onUse={value=>{
                setPlanId(value.id);setPlanName(value.name);setPlanInstructions(value.instructions);setRuleIds(new Set());setLearned([]);setNotice("");
              }}/>
          </div>
          {canContinue && <section className="ai-section ai-confirm" aria-label={msg('AIEditingDialog.m0213')}>
            <h3>{msg('AIEditingDialog.m0214')}</h3>
            <p className="ai-subtitle">{msg('review.editingSource', { source: sourceLabel })}</p>
            <div className="ai-actions"><label className="ai-check"><input type="radio" name="ai-range" checked={whole} onChange={() => setWhole(true)}/>{msg('AIEditingDialog.m0217')}</label><label className="ai-check"><input type="radio" name="ai-range" checked={!whole} onChange={() => setWhole(false)}/>{msg('AIEditingDialog.m0218')}</label></div>
            {!whole && <div className="ai-range">{rangeFields(first, last, setFirst, setLast, "")}</div>}
            <p className="ai-confirm-count">{msg('review.editingSelection', { segmentCount: selection.length, characterCount: selection.reduce((n,s) => n+s.text.length,0) })}</p>
            {generated && !complete && !busy && <p className="ai-subtitle" role="status">{resume ? msg('AIEditingDialog.m0222', { v0: resume.completed.length, v1: resume.batches.length }) : msg('AIEditingDialog.m0223')}</p>}
          </section>}
        </fieldset>
      </>}
      </div>
    </div>
    <footer className="ai-footer" inert={editingInProgress}>
      <div aria-live="polite">{error && ready ? <p className="ai-error" role="alert">{uiMessage(error)} <CopyProblem operation="editing" /></p> : <p>{uiMessage((!editingInProgress && busy&&!isMessage(busy, 'AIPlanSections.m0265')?busy:"") || notice || msg('AIEditingDialog.m0224'))}</p>}</div>
      {namingOpen ? <form className="ai-version-naming" onSubmit={event=>{event.preventDefault();generate(false,nameInput);}}>
        <label className="field"><span>{msg('AIEditingDialog.m0225')}</span><input ref={nameInputRef} value={nameInput} maxLength={100} placeholder={msg('AIEditingDialog.m0226')} required onChange={e=>setNameInput(e.target.value)} onKeyDown={e=>{if(e.key==="Escape"){e.preventDefault();e.stopPropagation();setNamingOpen(false);}}}/></label>
        <div className="ai-actions"><button type="button" className="button" onClick={()=>setNamingOpen(false)}>{msg('AIEditingDialog.m0227')}</button><button type="submit" className="button button--primary" disabled={!nameInput.trim() || locked}>{msg('AIEditingDialog.m0228')}</button></div>
      </form> : <div className="ai-actions ai-footer-start">
        {canContinue && <p className="ai-active-plan" aria-label={msg('AIEditingDialog.m0229')}>{msg('review.activePlan', { planName: builtinText(planId,planName)||requirements.map(r=>builtinText(r.id,r.name)).join("、") })}</p>}
        {busy&&!editingInProgress&&<button type="button" className="button ai-cancel-request" onClick={()=>controller.current?.abort()}>{msg('AIEditingDialog.m0232')}</button>}
        <button ref={startButtonRef} className="button button--primary ai-start-editing" disabled={!ready||locked||draftConflict||!hasEngine||!canContinue||!selection.length} onClick={()=>{setNameInput(generated ? versionName : "");setNamingOpen(true);}}>{msg('AIEditingDialog.m0233')}</button>

      </div>}
    </footer>
  </dialog>;
}
