// Standalone visual fixture. All responses and writes stay in memory.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AIEditingDialog, type AIReviewDraft } from "../src/components/AIEditingDialog";
import { AIModelSettings } from "../src/components/AIModelSettings";
import type { AIPreference, SavedAIPreference } from "../src/lib/aiEditing";
import type { Transcript } from "../src/types";
import "../src/styles.css";

const transcript: Transcript = { audio: { filename: "模拟采访.wav", duration: 60 }, speakers: [{ id: "s", name: "张三" }], segments: [
  { id: "a", speaker_id: "s", start: 0, end: 20, text: "我觉得吧，这件事怎么说呢……也不能说是完全没用。我们当时确实试过，只是后来没有继续。" },
  { id: "b", speaker_id: "s", start: 20, end: 40, text: "然后然后，就是就是，我们也不确定。可能还需要一点时间吧，我觉得。" },
  { id: "c", speaker_id: "s", start: 40, end: 60, text: "对，我不是说这个方向不对。我是说，嗯，大家当时的理解可能不太一样。" },
] };
const instructions = "保留承载犹豫和语气的词，如「我觉得吧」「怎么说呢」。保留说话人的自我修正与未完成表达。删除连续重复、没有额外意义的「然后」「就是」。不补全原话未说出的因果关系，不把口语改写成书面文章。";
const plans: {id:string;name:string;instructions:string;common:boolean}[]=[];
let profiles: SavedAIPreference[] = [{ id: "demo", name: "张三采访 · 轻度整理", instructions, examples: [], updated_at: "now" }];
window.fetch = async (input, init) => {
  const path = String(input); const body = init?.body ? JSON.parse(String(init.body)) : {};
  let result: unknown = {};
  if (path.endsWith("/config")) result = { configured: true, selected_engine_id: "qa", engines: [{ id: "qa", name: "隔离模拟引擎", model: "qa-model", revision: "qa", active: true }], revision: "qa", model: "模拟文本模型（无外部调用）", has_key: false, base_url: "http://localhost:9999/v1" };
  else if (path.endsWith("/providers")) result = [];
  else if (path.endsWith("/learn")) result = { instructions:"整理修订中的通用规则",rules:["保留不确定语气：保留表达犹豫和不确定性的措辞，不把推测改为确定结论。","区分重复作用：精简明确无意义的连续重复，保留强调性重复。","不补充事实：不补充原文未说明的事实或因果关系。"] };
  else if(path.includes("/plans")){if(init?.method==="POST"){const plan={...body,id:crypto.randomUUID()};plans.push(plan);result=plan;}else result=plans;}
  else if (path.endsWith("/edit")) result = { segments: (body.segments as { id: string; text: string }[]).map(s => ({ ...s, text: s.text.replaceAll("然后然后", "然后").replaceAll("就是就是，", ""), reason: "删除连续重复，保留不确定性和句末语气。" })) };
  else if (path.includes("/preferences") && (init?.method === "POST" || init?.method === "PUT")) {
    const value = { ...body as AIPreference, id: path.split("/").at(-1) === "preferences" ? crypto.randomUUID() : path.split("/").at(-1)!, updated_at: "now" };
    profiles = [...profiles.filter(p => p.id !== value.id), value]; result = value;
  } else if (path.includes("/preferences")) result = profiles;
  return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
};
const loadOriginal = async () => ({ ...transcript, segments: transcript.segments.map(s => ({ ...s, text: s.id === "a" ? "嗯嗯，" + s.text : s.text })) });
const stage=new URLSearchParams(location.search).get("stage");
if(new URLSearchParams(location.search).has("long")) transcript.segments[0].text += "\n" + "长片段需要自动换行，保留正文可读性。".repeat(60);
let saved: AIReviewDraft|null=stage==="review"?{baseline:transcript,suggestions:[{id:"b",text:"然后，我们也不确定。可能还需要一点时间吧，我觉得。",reason:"删除重复起句，保留不确定的语气。"}],accepted:[],label:"模拟正式稿",name:"修改稿 v2 · AI 编辑",complete:true,mode:"formal"}:null;
export function Preview() {
  const [open,setOpen]=useState(true);
  const [status,setStatus]=useState("模拟数据，不读取或修改任何采访文件。");
  return <div className="app-shell"><header className="topbar"><strong>Ripple · 界面验收</strong><span>{status}</span><button className="button" onClick={()=>setOpen(true)}>打开 AI 辅助编辑</button></header>
    <div style={{padding:32}}><AIModelSettings/></div>
    {open&&<AIEditingDialog transcript={transcript} source="模拟采访.wav" selectedId="b" loadOriginal={loadOriginal} loadDraft={async()=>saved} saveDraft={async value=>{saved=value;}} onClose={()=>setOpen(false)} onSettings={()=>setOpen(false)} onApply={async suggestions=>setStatus(`已保存 ${suggestions.length} 项模拟建议`)}/>}
  </div>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
