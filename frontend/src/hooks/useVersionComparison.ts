import { msg, useInterfaceLanguage } from '../i18n';
import { recordProblem } from "../lib/diagnostics";
import { useEffect, useMemo, useState } from "react";
import type { Transcript, TranscriptModel } from "../types";
import { defaultEditLabel, displayEngineLabel, readModelEdit, readModelOriginal } from "../localStore";
import { flushEditorDrafts } from "../lib/editorDrafts";
import { useComparisonReadingPosition } from "./useComparisonReadingPosition";

export function useVersionComparison(dir: FileSystemDirectoryHandle | null, audio: string,
  models: TranscriptModel[], modelId: string | null, editId: string | undefined, original: boolean,
  panelRef?: {current:HTMLElement|null}) {
  const language = useInterfaceLanguage();
  const context = `${audio}:${modelId}:${original ? "original" : editId}`;
  const [state, setState] = useState<{dir:typeof dir;context:string;shown:boolean;base:string}>({dir:null,context:"",shown:false,base:""});
  const [loaded, setLoaded] = useState<{dir:typeof dir;context:string;base:string;selection:typeof state;transcript:Transcript|null;error:string}>();
  const options = useMemo(() => { void language; return models.flatMap(model => [
    ...(model.original ? [{value:`${model.id}:original`,model:model.id,edit:"original",label:`${model.sourceKind === "import" ? (model.sourceName ?? msg('useVersionComparison.m1179')) : displayEngineLabel(model.engine)} · ${model.sourceKind === "import" && !model.designatedOriginal ? msg('useVersionComparison.m1180') : msg('useVersionComparison.m1181')}`}] : []),
    ...model.edits.map((edit,i)=>({value:`${model.id}:${edit.id}`,model:model.id,edit:edit.id,label:edit.label ?? defaultEditLabel(i)})),
  ]).filter(option=>option.value!==`${modelId}:${original ? "original" : editId}`); }, [models,modelId,editId,original,language]);
  const preferred=models.find(m=>m.id===modelId)?.edits.find(e=>e.id===editId)?.comparisonBaseId;
  const same = state.dir===dir && state.context===context;
  const base = same && options.some(o=>o.value===state.base) ? state.base
    : options.find(o=>o.value===`${modelId}:${preferred}`)?.value ?? options.find(o=>o.model===modelId && o.edit==="original")?.value ?? options[0]?.value ?? "";
  const shown = !original && same && state.shown;
  const toggle = () => { if (original) return; captureReadingPosition(); flushEditorDrafts(); setState({dir,context,shown:!shown,base}); };
  const choose = (base:string) => { if (original) return; captureReadingPosition(); flushEditorDrafts(); setState({dir,context,shown:true,base}); };
  const activate = (model:string,edit:string,base:string) => setState({dir,context:`${audio}:${model}:${edit}`,shown:true,base});
  useEffect(()=>{
    if(!shown || !dir || !base) return;
    let stale=false;
    const option=options.find(o=>o.value===base);
    if (!option) return;
    const load=option.edit==="original"?readModelOriginal(dir,audio,option.model):readModelEdit(dir,audio,option.model,option.edit);
    void load.then(value=>{if(!stale)setLoaded({dir,context,base,selection:state,transcript:value?.transcript ?? null,error:value?"":msg('useVersionComparison.m1182')});})
      .catch((error)=>{if(!stale)recordProblem("comparison", error);if(!stale)setLoaded({dir,context,base,selection:state,transcript:null,error:msg('useVersionComparison.m1183')});});
    return()=>{stale=true;};
  },[dir,audio,context,base,shown,state,options]);
  const ready=loaded?.dir===dir&&loaded.context===context&&loaded.base===base&&loaded.selection===state;
  const captureReadingPosition = useComparisonReadingPosition(panelRef, dir, context, shown,
    shown&&!ready&&Boolean(base), shown&&ready?loaded.transcript:null);
  return {shown,base,options,toggle,choose,activate,baseline:shown&&ready?loaded.transcript:null,error:shown&&ready?loaded.error:"",loading:shown&&!ready&&Boolean(base)};
}
