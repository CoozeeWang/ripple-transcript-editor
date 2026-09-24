import type {Transcript} from "../src/types";
import {applyComparisonDecision,comparisonReviewKey,reconcileComparisonReviews} from "../src/lib/comparisonReview";
import {useRef,useState,useEffect} from "react";
import {createRoot} from "react-dom/client";
import {SegmentTextArea} from "../src/components/SegmentTextArea";
import type {ParagraphEditorElement} from "../src/lib/paragraphEditor";
import {flushEditorDrafts} from "../src/lib/editorDrafts";
import "../src/styles.css";
export function Check(){
 const versions=["我觉得，可能需要继续讨论。\n第二段保持原样。", "我觉得，需要讨论。\n第二段保持原样。"];
 const [transcript,setTranscript]=useState<Transcript>({audio:{filename:"test.wav",duration:1},speakers:[],segments:[{id:"demo",speaker_id:"p",start:0,end:1,text:"我觉得，需要继续讨论。\n第二段保持原样。"}]});
 const text=transcript.segments[0]?.text??"";const setText=(text:string)=>setTranscript(current=>reconcileComparisonReviews({...current,segments:current.segments.map(s=>({...s,text}))}));const [shown,setShown]=useState(true),[base,setBase]=useState(0);
 const registry=useRef(new Map<string,ParagraphEditorElement>());
 const toggle=()=>{flushEditorDrafts();setShown(s=>!s);};
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if((e.metaKey||e.ctrlKey)&&e.shiftKey&&e.code==="KeyY"){e.preventDefault();toggle();}};window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key);},[]);
 const noop=()=>{};
 return <main className="transcript-panel" style={{maxWidth:900,margin:"40px auto"}}><h1>单栏版本比较（模拟数据）</h1><div className="version-badge-row"><span className="version-badge">AI 编辑稿</span><button className={`button comparison-toggle ${shown?"is-active":""}`} aria-pressed={shown} onClick={toggle}>显示修改痕迹</button><label className="comparison-source">对照：<select value={base} onChange={e=>{flushEditorDrafts();setBase(Number(e.target.value));}}><option value={0}>修改稿 v1</option><option value={1}>修改稿 v2</option></select></label></div><div className="segment" style={{display:"block",marginTop:24}}><SegmentTextArea segmentId="demo" value={text} comparisonBefore={shown?versions[base]:undefined} comparisonBase={String(base)} comparisonAccepted={transcript.comparisonReviews?.[comparisonReviewKey(String(base),"demo")]?.accepted} onComparisonDecision={decision=>setTranscript(current=>reconcileComparisonReviews(applyComparisonDecision(current,decision)))} registry={registry} ariaLabel="正文" onFocus={noop} onBlur={noop} onClick={noop} onKeyDown={noop} onChange={setText}/></div><button className="button" onClick={()=>flushEditorDrafts()}>保存模拟稿件</button><pre aria-label="保存正文">{text}</pre></main>;
}
createRoot(document.getElementById("root")!).render(<Check/>);
