// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AIEditingDialog, type AIReviewDraft } from "./AIEditingDialog";
import { decideRevision, revisionFor } from "../lib/revisions";
import type { Transcript } from "../types";
const transcript:Transcript={audio:{filename:"A.wav",duration:4},speakers:[{id:"sp",name:"张三"}],segments:[{id:"a",speaker_id:"sp",start:0,end:2,text:"我觉得可能吧"},{id:"b",speaker_id:"sp",start:2,end:4,text:"嗯嗯，确实"}]};
const profile={id:"p1",kind:"rule",name:"保留犹豫",instructions:"保留犹豫",examples:[],updated_at:"now"};
const original={...transcript,segments:transcript.segments.map(s=>({...s,text:`嗯${s.text}`}))};
const loadOriginal=async()=>original;
const config={configured:true,model:"test",has_key:true,base_url:"https://text.example"};
let requests:{path:string;body:Record<string,unknown>|null;signal?:AbortSignal}[];
function stubFetch(handler?:(path:string,init:RequestInit)=>Promise<unknown>){
 vi.stubGlobal("fetch",vi.fn(async(path:string,init:RequestInit={})=>{const body=init.body?JSON.parse(String(init.body)):null;requests.push({path,body,signal:init.signal??undefined});const data=await handler?.(path,init);return {ok:true,json:async()=>data??(path.endsWith("/config")?config:path.endsWith("/preferences")?[profile]:path.endsWith("/plans")?[]:path.endsWith("/edit")?{segments:(body.segments as {id:string;text:string}[]).map(s=>({...s,text:s.id==="a"?"可能吧":s.text,reason:"模拟建议"}))}:{})};}));
}
beforeEach(()=>{requests=[];HTMLDialogElement.prototype.showModal=function(){this.open=true;};HTMLDialogElement.prototype.close=function(){this.open=false;};vi.spyOn(window,"confirm").mockReturnValue(true);});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
function setup(extra:Partial<Parameters<typeof AIEditingDialog>[0]>={}){const onApply=vi.fn(async()=>{}),onClose=vi.fn();const ui=render(<AIEditingDialog transcript={transcript} source="A.wav" selectedId="a" loadOriginal={loadOriginal} onSettings={vi.fn()} onClose={onClose} onApply={onApply} {...extra}/>);return {ui,onApply,onClose};}
async function selectPlan(ui:ReturnType<typeof render>){fireEvent.click(await ui.findByRole("checkbox",{name:"选用忠实转写"}));}

function startEditing(ui: ReturnType<typeof render>, name = "AI 编辑稿") {
 fireEvent.click(ui.getByText("开始 AI 辅助编辑"));
 fireEvent.change(ui.getByLabelText("版本名称"),{target:{value:name}});
 fireEvent.click(ui.getByText("确认名称并开始"));
}

it("starts editing only after selecting a plan and explicitly starting",async()=>{stubFetch();const {ui}=setup();fireEvent.click(await ui.findByRole("checkbox",{name:"选用忠实转写"}));expect((ui.getByText("开始 AI 辅助编辑") as HTMLButtonElement).disabled).toBe(false);expect(requests.filter(r=>r.path.endsWith("/edit"))).toHaveLength(0);startEditing(ui);await waitFor(()=>expect((ui.getByText("打开修改版本") as HTMLButtonElement).disabled).toBe(false));expect(requests.filter(r=>r.path.endsWith("/edit"))).toHaveLength(1);});

it("restores a legacy draft without publishing implicitly",async()=>{
 stubFetch();const saved:AIReviewDraft={baseline:transcript,suggestions:[{id:"a",text:"可能吧",reason:"恢复建议"}],accepted:["a"],label:"修改稿 v1",name:"我的 AI 稿",complete:true};
 const saveDraft=vi.fn(async()=>{});const {ui,onApply}=setup({loadDraft:async()=>saved,saveDraft});
 await ui.findByText("打开修改版本");expect(ui.getByRole("dialog")).toBeTruthy();expect(onApply).not.toHaveBeenCalled();
 fireEvent.click(ui.getByText("打开修改版本"));await waitFor(()=>expect(onApply).toHaveBeenCalledWith([expect.objectContaining({text:"可能吧"})],"我的 AI 稿"));
 expect(saveDraft).toHaveBeenLastCalledWith(null);
});

it("does not overwrite a draft whose source changed",async()=>{stubFetch();const saveDraft=vi.fn();const {ui}=setup({loadDraft:async()=>({baseline:original,suggestions:[],accepted:[],label:"旧稿",name:"旧稿",complete:true}),saveDraft});await ui.findByRole("alert");expect(saveDraft).not.toHaveBeenCalled();expect(ui.getByText("放弃旧草稿")).toBeTruthy();});

it("blocks publication of incomplete recovered work",async()=>{
 stubFetch();const {ui,onApply}=setup({loadDraft:async()=>({baseline:transcript,suggestions:[{id:"a",text:"可能吧",reason:"第一批"}],accepted:[],label:"全文",name:"AI 稿",complete:false})});
 expect((await ui.findByText("打开修改版本") as HTMLButtonElement).disabled).toBe(true);
 expect(ui.getByText("开始 AI 辅助编辑")).toBeTruthy();expect(onApply).not.toHaveBeenCalled();
});

it("preserves legacy rejection decisions when opening or closing the recovered draft",async()=>{
 stubFetch();const suggestion={id:"a",text:"可能吧",reason:"旧建议"};
 const review=decideRevision(revisionFor(transcript.segments[0].text,suggestion),"reject");
 const saved:AIReviewDraft={baseline:transcript,suggestions:[suggestion],accepted:[],reviews:{a:review},label:"全文",name:"旧稿",complete:true};
 const saveDraft=vi.fn(async()=>{});const first=setup({loadDraft:async()=>saved,saveDraft});
 await first.ui.findByText("打开修改版本");fireEvent.click(first.ui.getByLabelText("关闭 AI 辅助编辑"));
 await waitFor(()=>expect(first.onClose).toHaveBeenCalled());expect(saveDraft).toHaveBeenLastCalledWith(expect.objectContaining({reviews:{a:review}}));
 cleanup();const second=setup({loadDraft:async()=>saved});fireEvent.click(await second.ui.findByText("打开修改版本"));
 await waitFor(()=>expect(second.onApply).toHaveBeenCalledWith([expect.objectContaining({text:transcript.segments[0].text})],"旧稿"));
});

it("lists the pending draft across steps and deletes it without publishing or restoring it on close",async()=>{
 stubFetch();const saveDraft=vi.fn(async()=>{});
 const {ui,onApply,onClose}=setup({saveDraft,loadDraft:async()=>({baseline:transcript,suggestions:[{id:"a",text:"可能吧",reason:"建议"}],accepted:[],label:"全文",name:"待审稿 A",complete:true})});
 await ui.findByText("打开修改版本");
 const list=ui.getByRole("region",{name:"待审阅 AI 草稿"});expect(within(list).getByText("待审稿 A")).toBeTruthy();
 expect(ui.getByRole("region",{name:"待审阅 AI 草稿"})).toBeTruthy();
 fireEvent.click(ui.getByText("删除草稿"));
 await waitFor(()=>expect(ui.queryByRole("region",{name:"待审阅 AI 草稿"})).toBeNull());
 expect(saveDraft).toHaveBeenLastCalledWith(null);
 fireEvent.click(ui.getByLabelText("关闭 AI 辅助编辑"));
 await waitFor(()=>expect(onClose).toHaveBeenCalled());
 expect(saveDraft).toHaveBeenLastCalledWith(null);expect(onApply).not.toHaveBeenCalled();
});

it("updates legacy automatic draft names and shows only source and original generation range",async()=>{
 stubFetch();const {ui}=setup({sourceLabel:"修改稿 v1",suggestedName:"修改稿 v1 · AI 辅助 01",loadDraft:async()=>({baseline:transcript,suggestions:[{id:"a",text:"可能吧",reason:"建议"}],accepted:[],label:"修改稿 v1 · 片段 26–79 · 很长的编辑规则",name:"修改稿 v2 · AI 编辑",complete:true})});
 await ui.findByText("打开修改版本");
 const list=within(ui.getByRole("region",{name:"待审阅 AI 草稿"}));
 expect(list.getByText("修改稿 v1 · AI 辅助 01")).toBeTruthy();
 expect(list.getByText("基于 修改稿 v1")).toBeTruthy();
 expect(list.getByText("编辑范围：片段 26–79")).toBeTruthy();
 expect(list.queryByText(/很长的编辑规则/)).toBeNull();
});

it("shows common plans as exclusive checkboxes and exposes rule popovers",async()=>{
 stubFetch();const {ui}=setup();const first=await ui.findByRole("checkbox",{name:"选用忠实转写"});const second=ui.getByRole("checkbox",{name:"选用口述史访谈稿"});
 fireEvent.click(first);expect((first as HTMLInputElement).checked).toBe(true);fireEvent.click(second);expect((first as HTMLInputElement).checked).toBe(false);expect((second as HTMLInputElement).checked).toBe(true);
 const info=ui.getByRole("button",{name:"查看 忠实转写 的详细规则"});expect(info.getAttribute("popovertarget")).toBe("ai-plan-info-0");expect(ui.container.querySelector("#ai-plan-info-0")?.textContent).toContain("不删减这些口语特征");
 expect(ui.getByText(/可能产生费用/)).toBeTruthy();expect(requests.filter(r=>r.body)).toHaveLength(0);
});

it("orders three plan sources without testing controls or model requests",async()=>{
 stubFetch();const {ui}=setup();await selectPlan(ui);
 expect(ui.getAllByRole("radio").slice(0,3).map(r=>r.parentElement?.textContent)).toEqual(["常用方案","从已有修改版本中生成方案","自定义方案"]);
 expect(ui.queryByText(/试编辑|再测试|优化方案|第 0 轮/)).toBeNull();expect(requests.filter(r=>r.body)).toHaveLength(0);
 expect((ui.getByText("开始 AI 辅助编辑") as HTMLButtonElement).disabled).toBe(false);
 expect(ui.queryByRole("navigation",{name:"AI 编辑步骤"})).toBeNull();expect(ui.getByRole("region",{name:"选择编辑范围"})).toBeTruthy();expect((ui.getByRole("radio",{name:"全文"}) as HTMLInputElement).checked).toBe(true);
});
it("uses the chosen engine for formal editing and preserves original text",async()=>{
 stubFetch(async path=>path.endsWith("/config")?{...config,selected_engine_id:"one",engines:[{id:"one",name:"个人"},{id:"two",name:"团队"}]}:undefined);
 const {ui}=setup();await selectPlan(ui);fireEvent.change(ui.getByLabelText("本次编辑使用的编辑引擎"),{target:{value:"two"}});startEditing(ui);await waitFor(()=>expect((ui.getByText("打开修改版本") as HTMLButtonElement).disabled).toBe(false));
 expect(requests.find(r=>r.path.endsWith("/edit"))?.body).toEqual(expect.objectContaining({engine_id:"two",rules:[],preference:expect.objectContaining({instructions:expect.stringContaining("不删减这些口语特征")})}));expect(transcript.segments[0].text).toBe("我觉得可能吧");
});
async function generatedRules(ui:ReturnType<typeof render>){fireEvent.click(await ui.findByRole("radio",{name:"从已有修改版本中生成方案"}));fireEvent.click(ui.getByText("生成方案"));await ui.findByText("审阅编辑规则");}
it("generates rules from corrected text, reviews them, and saves only reusable selected rules",async()=>{
 stubFetch(async(path,init)=>path.endsWith("/learn")?{rules:["保留强调","保留反问"],instructions:"私有摘要",examples:[{before:"私有原话",after:"私有修订"}]}:path.endsWith("/plans")&&init.method==="POST"?{id:"new",...JSON.parse(String(init.body))}:undefined);
 const {ui}=setup();await generatedRules(ui);
 expect(requests.find(r=>r.path.endsWith("/learn"))?.body?.examples).toEqual([expect.objectContaining({before:"嗯我觉得可能吧",after:"我觉得可能吧"})]);
 const area=within(ui.getByRole("region",{name:"从已有修改版本中生成方案"}));fireEvent.click(area.getByLabelText("选用候选规则 2"));fireEvent.click(area.getByText("＋ 添加一条规则"));fireEvent.change(area.getByLabelText("生成编辑规则 3"),{target:{value:"不补充事实"}});fireEvent.change(area.getByLabelText("生成方案名称"),{target:{value:"访谈规则"}});
 fireEvent.click(area.getByText("保存为新方案"));await area.findByText("✓ 已确认");expect((area.getByLabelText("生成编辑规则 1") as HTMLTextAreaElement).readOnly).toBe(true);
 expect(requests.find(r=>r.path.endsWith("/plans")&&r.body)?.body).toEqual({name:"访谈规则",common:true,instructions:"保留强调\n\n不补充事实"});
 startEditing(ui);await waitFor(()=>expect((ui.getByText("打开修改版本") as HTMLButtonElement).disabled).toBe(false));
 expect((requests.find(r=>r.path.endsWith("/edit"))?.body?.preference as {instructions:string}).instructions).toBe("保留强调\n\n不补充事实");expect(requests.some(r=>r.path.endsWith("/refine"))).toBe(false);
});
it("keeps a one-time generated plan in this document and restores it without another request",async()=>{
 stubFetch(async path=>path.endsWith("/learn")?{rules:["保留语气"],instructions:"摘要"}:undefined);let saved:AIReviewDraft|null=null;
 const {ui,onClose}=setup({saveDraft:async value=>{saved=value;}});await generatedRules(ui);fireEvent.change(ui.getByLabelText("生成方案名称"),{target:{value:"本次访谈"}});fireEvent.click(ui.getByText("确认，仅本次使用"));await ui.findAllByText("本次使用：本次访谈");fireEvent.click(ui.getByLabelText("关闭 AI 辅助编辑"));await waitFor(()=>expect(onClose).toHaveBeenCalled());
 expect(saved!.mode).toBe("setup");expect(saved!.options?.planInstructions).toBe("保留语气");expect(requests.filter(r=>r.path.includes("/plans")&&r.body)).toHaveLength(0);
 cleanup();const resumed=setup({loadDraft:async()=>saved}).ui;await resumed.findAllByText("本次使用：本次访谈");expect((resumed.getByText("开始 AI 辅助编辑") as HTMLButtonElement).disabled).toBe(false);expect(requests.filter(r=>r.path.endsWith("/learn"))).toHaveLength(1);
});
it("does not generate from unchanged or missing originals",async()=>{
 stubFetch();const {ui}=setup({loadOriginal:async()=>transcript});fireEvent.click(await ui.findByRole("radio",{name:"从已有修改版本中生成方案"}));fireEvent.click(ui.getByText("生成方案"));await ui.findByText("所选范围与基准稿内容相同。请选择已经人工修改过的片段。");expect(requests.some(r=>r.path.endsWith("/learn"))).toBe(false);
 cleanup();const missing=setup({loadOriginal:async()=>null}).ui;fireEvent.click(await missing.findByRole("radio",{name:"从已有修改版本中生成方案"}));expect((missing.getByText("生成方案") as HTMLButtonElement).disabled).toBe(true);
});
it("shows generation status beside its trigger and ignores cancelled late results",async()=>{
 let finish!:(value:unknown)=>void;stubFetch(async path=>path.endsWith("/learn")?new Promise(resolve=>{finish=resolve;}):undefined);
 const {ui}=setup();fireEvent.click(await ui.findByRole("radio",{name:"从已有修改版本中生成方案"}));fireEvent.click(ui.getByText("生成方案"));await waitFor(()=>expect(requests.some(r=>r.path.endsWith("/learn"))).toBe(true));expect(ui.getByRole("status").closest("section")?.getAttribute("aria-label")).toBe("从已有修改版本中生成方案");fireEvent.click(ui.getByText("取消请求"));await act(async()=>finish({rules:["晚到规则"]}));expect(ui.queryByText("审阅编辑规则")).toBeNull();expect(requests.find(r=>r.path.endsWith("/learn"))?.signal?.aborted).toBe(true);
});
it("keeps custom drafts between sources and requires confirming changed rules before continuing",async()=>{
 stubFetch();const {ui}=setup();fireEvent.click(await ui.findByRole("radio",{name:"自定义方案"}));const area=within(ui.getByRole("region",{name:"自定义编辑方案"}));fireEvent.change(area.getByLabelText("自定义编辑规则 1"),{target:{value:"保留所有语气词"}});fireEvent.change(area.getByLabelText("自定义方案名称"),{target:{value:"口语"}});
 fireEvent.click(ui.getByRole("radio",{name:"从已有修改版本中生成方案"}));fireEvent.click(ui.getByRole("radio",{name:"自定义方案"}));expect((area.getByLabelText("自定义编辑规则 1") as HTMLTextAreaElement).value).toBe("保留所有语气词");expect((ui.getByText("开始 AI 辅助编辑") as HTMLButtonElement).disabled).toBe(true);
 expect(ui.queryByRole("region",{name:"选择编辑范围"})).toBeNull();fireEvent.click(area.getByText("确认，仅本次使用"));await area.findByText("✓ 已确认");expect(ui.getByRole("region",{name:"选择编辑范围"})).toBeTruthy();fireEvent.click(area.getByText("继续修订"));fireEvent.change(area.getByLabelText("自定义编辑规则 1"),{target:{value:"保留强调重复"}});expect((ui.getByText("开始 AI 辅助编辑") as HTMLButtonElement).disabled).toBe(true);fireEvent.click(area.getByText("确认，仅本次使用"));await area.findByText("✓ 已确认");expect((ui.getByText("开始 AI 辅助编辑") as HTMLButtonElement).disabled).toBe(false);
 expect(requests.filter(r=>r.body)).toHaveLength(0);
});
it("saves custom rules for reuse in another document and requires an explicit update",async()=>{
 const plans:Record<string,unknown>[]=[];stubFetch(async(path,init)=>{if(path.endsWith("/plans")){if(init.method==="POST"){const plan={id:"p",...JSON.parse(String(init.body))};plans.push(plan);return plan;}return plans;}if(path.endsWith("/plans/p"))return {id:"p",...JSON.parse(String(init.body))};});
 const {ui}=setup();fireEvent.click(await ui.findByRole("radio",{name:"自定义方案"}));const area=within(ui.getByRole("region",{name:"自定义编辑方案"}));fireEvent.change(area.getByLabelText("自定义方案名称"),{target:{value:"常设规则"}});fireEvent.change(area.getByLabelText("自定义编辑规则 1"),{target:{value:"保留语气"}});fireEvent.click(area.getByText("保存为新方案"));await area.findByText("✓ 已确认");cleanup();
 const other=setup({source:"Other.wav"}).ui;fireEvent.click(await other.findByRole("checkbox",{name:"选用常设规则"}));expect((other.getByText("开始 AI 辅助编辑") as HTMLButtonElement).disabled).toBe(false);
 fireEvent.click(other.getByText("在“自定义方案”中编辑"));fireEvent.change(other.getByLabelText("自定义编辑规则 1"),{target:{value:"保留语气和停顿"}});expect(requests.some(r=>r.path.endsWith("/plans/p"))).toBe(false);fireEvent.click(other.getByText("更新已保存方案"));await other.findByText("✓ 已确认");expect(requests.find(r=>r.path.endsWith("/plans/p"))?.body?.instructions).toBe("保留语气和停顿");
});
it("retains reviewed generated rules and name after a shared save fails",async()=>{
 stubFetch(async(path,init)=>{if(path.endsWith("/learn"))return {rules:["保留语气"]};if(path.endsWith("/plans")&&init.method==="POST")throw new Error("保存失败");});
 const {ui}=setup();await generatedRules(ui);fireEvent.change(ui.getByLabelText("生成方案名称"),{target:{value:"我的方案"}});fireEvent.click(ui.getByText("保存为新方案"));await ui.findByText("保存失败");expect((ui.getByLabelText("生成编辑规则 1") as HTMLTextAreaElement).value).toBe("保留语气");expect((ui.getByLabelText("生成方案名称") as HTMLInputElement).value).toBe("我的方案");expect((ui.getByText("开始 AI 辅助编辑") as HTMLButtonElement).disabled).toBe(true);
});
it("migrates legacy trial rules once, preserves the old review, and never resumes testing",async()=>{
 stubFetch();let saved:AIReviewDraft|null=null;
 const legacy:AIReviewDraft={mode:"trial",baseline:transcript,suggestions:[],accepted:[],label:"",name:"AI 稿",complete:false,options:{planName:"LA",planInstructions:"旧规则",ruleIds:[],engineId:"",whole:true,first:0,last:1},trial:{round:2,ids:["a"],suggestions:[{id:"a",text:"建议",reason:"旧审阅"}],reviews:{},complete:true,candidates:["候选规则"]}};
 const {ui,onClose}=setup({loadDraft:async()=>legacy,saveDraft:async value=>{saved=value;}});await ui.findByText("审阅编辑规则");expect(ui.queryByText(/第 2 轮|试编辑/)).toBeNull();fireEvent.change(ui.getByLabelText("生成编辑规则 1"),{target:{value:"继续修订过的规则"}});fireEvent.click(ui.getByLabelText("关闭 AI 辅助编辑"));await waitFor(()=>expect(onClose).toHaveBeenCalled());expect(saved!.trial).toEqual(legacy.trial);expect(saved!.mode).toBe("setup");cleanup();
 const resumed=setup({loadDraft:async()=>saved}).ui;await resumed.findByText("审阅编辑规则");expect((resumed.getByLabelText("生成编辑规则 1") as HTMLTextAreaElement).value).toBe("继续修订过的规则");expect(requests.filter(r=>r.body)).toHaveLength(0);
});

it("keeps an empty generated rule editable instead of hiding the review",async()=>{
 stubFetch(async path=>path.endsWith("/learn")?{rules:["保留语气"]}:undefined);const {ui}=setup();await generatedRules(ui);fireEvent.change(ui.getByLabelText("生成编辑规则 1"),{target:{value:""}});expect(ui.getByLabelText("生成编辑规则 1")).toBeTruthy();expect((ui.getByText("确认，仅本次使用") as HTMLButtonElement).disabled).toBe(true);fireEvent.change(ui.getByLabelText("生成编辑规则 1"),{target:{value:"保留强调"}});expect((ui.getByLabelText("生成编辑规则 1") as HTMLTextAreaElement).value).toBe("保留强调");
});
it("retains existing common-plan selection when closing and reopening",async()=>{
 const plan={id:"existing",name:"已保存方案",instructions:"保留原话",common:true};stubFetch(async path=>path.endsWith("/plans")?[plan]:undefined);let saved:AIReviewDraft|null=null;const {ui,onClose}=setup({saveDraft:async value=>{saved=value;}});fireEvent.click(await ui.findByRole("checkbox",{name:"选用已保存方案"}));fireEvent.click(ui.getByLabelText("关闭 AI 辅助编辑"));await waitFor(()=>expect(onClose).toHaveBeenCalled());expect((saved as AIReviewDraft|null)?.options?.planId).toBe("existing");cleanup();const resumed=setup({loadDraft:async()=>saved}).ui;await resumed.findByRole("checkbox",{name:"选用已保存方案"});expect((resumed.getByRole("checkbox",{name:"选用已保存方案"}) as HTMLInputElement).checked).toBe(true);
});

it("keeps rule titles separate while editing and includes them in saved instructions",async()=>{
 stubFetch(async(path,init)=>path.endsWith("/learn")?{rules:["保留语气：保留表达不确定性的措辞。"]}:path.endsWith("/plans")&&init.method==="POST"?{id:"titled",...JSON.parse(String(init.body))}:undefined);
 const {ui}=setup();await generatedRules(ui);expect((ui.getByLabelText("生成规则标题 1") as HTMLInputElement).value).toBe("保留语气");expect((ui.getByLabelText("生成编辑规则 1") as HTMLTextAreaElement).value).toBe("保留表达不确定性的措辞。");fireEvent.change(ui.getByLabelText("生成规则标题 1"),{target:{value:"保留不确定语气"}});fireEvent.change(ui.getByLabelText("生成方案名称"),{target:{value:"访谈"}});fireEvent.click(ui.getByText("保存为新方案"));await ui.findByText("✓ 已确认");expect(requests.find(r=>r.path.endsWith("/plans")&&r.body)?.body?.instructions).toBe("保留不确定语气：保留表达不确定性的措辞。");
});

it("shows generation progress in the draft row and restores review controls after failure",async()=>{
 let fail!:(error:Error)=>void;
 stubFetch(async path=>path.endsWith("/edit")?new Promise((_resolve,reject)=>{fail=reject;}):undefined);
 const {ui}=setup();await selectPlan(ui);startEditing(ui);
 const row=within(await ui.findByRole("region",{name:"待审阅 AI 草稿"}));
 await waitFor(()=>expect(row.getByRole("status").textContent).toBe("正在生成建议 · 已完成批次：0 / 1"));
 expect(row.queryByText("打开修改版本")).toBeNull();
 expect(row.queryByText("删除草稿")).toBeNull();
 expect(row.queryByText("继续未完成部分")).toBeNull();
 expect(row.getByRole("button",{name:"取消请求"})).toBeTruthy();
 expect(ui.getAllByRole("button",{name:"取消请求"})).toHaveLength(1);
 expect(ui.container.querySelector('.ai-configuration')?.hasAttribute('inert')).toBe(true);
 expect(ui.container.querySelector('.ai-footer')?.hasAttribute('inert')).toBe(true);
 expect(ui.getByRole('dialog').classList.contains('ai-dialog--processing')).toBe(true);
 await act(async()=>fail(new Error("服务暂不可用")));
 await ui.findByText("服务暂不可用");
 expect(ui.container.querySelector('.ai-configuration')?.hasAttribute('inert')).toBe(false);
 expect(ui.getByRole('dialog').classList.contains('ai-dialog--processing')).toBe(false);
 expect(row.queryByText("取消请求")).toBeNull();
 expect(row.queryByRole("status")).toBeNull();
 expect((row.getByText("打开修改版本") as HTMLButtonElement).disabled).toBe(true);
});

it("opens completed AI output in the main editor without individual review confirmation",async()=>{
 stubFetch();const saveDraft=vi.fn(async()=>{});const {ui,onApply,onClose}=setup({saveDraft});
 await selectPlan(ui);startEditing(ui);
 await waitFor(()=>expect(onApply).toHaveBeenCalledWith([expect.objectContaining({id:"a",text:"可能吧"})],"AI 编辑稿"));
 await waitFor(()=>expect(onClose).toHaveBeenCalled());expect(saveDraft).toHaveBeenLastCalledWith(null);
 expect(ui.queryByRole("region",{name:"AI 待审阅稿"})).toBeNull();
});
it("keeps the completed generation recoverable when creating its main-editor version fails",async()=>{
 stubFetch();const saveDraft=vi.fn(async()=>{});const {ui,onApply,onClose}=setup({saveDraft});
 onApply.mockRejectedValueOnce(new Error("保存失败"));await selectPlan(ui);startEditing(ui);
 await ui.findByText("保存失败");expect(onClose).not.toHaveBeenCalled();
 expect(saveDraft).toHaveBeenLastCalledWith(expect.objectContaining({complete:true,suggestions:[expect.objectContaining({id:"a"})]}));
 fireEvent.click(ui.getByText("打开修改版本"));await waitFor(()=>expect(onClose).toHaveBeenCalled());
 expect(requests.filter(r=>r.path.endsWith("/edit"))).toHaveLength(1);
});

it("recovers structural suggestions into the main editor without discarding an undecided merge",async()=>{
 stubFetch();const suggestion={id:"b",text:"嗯，确实",action:"merge_previous" as const,reason:"合并"};
 const {ui,onApply}=setup({loadDraft:async()=>({mode:"formal",baseline:transcript,suggestions:[suggestion],accepted:[],reviews:{},label:"全文",name:"AI 稿",complete:true})});
 fireEvent.click(await ui.findByText("打开修改版本"));await waitFor(()=>expect(onApply).toHaveBeenCalledWith([suggestion],"AI 稿"));
});


it("does not publish after cancelling while the completed checkpoint is being saved",async()=>{
 stubFetch();let finish!:()=>void;
 const saveDraft=vi.fn(async(value:AIReviewDraft|null)=>{if(value?.complete)await new Promise<void>(resolve=>{finish=resolve;});});
 const {ui,onApply}=setup({saveDraft});
 await selectPlan(ui);startEditing(ui);
 await waitFor(()=>expect(finish).toBeTypeOf("function"));
 fireEvent.click(ui.getByText("取消请求"));await act(async()=>finish());
 expect(onApply).not.toHaveBeenCalled();
});

it("closing during the final checkpoint preserves its completed output",async()=>{
 stubFetch();let finish!:()=>void;let saved:AIReviewDraft|null=null;
 const saveDraft=vi.fn(async(value:AIReviewDraft|null)=>{
  if(value?.complete)await new Promise<void>(resolve=>{finish=resolve;});
  saved=value;
 });
 const {ui,onApply,onClose}=setup({saveDraft});await selectPlan(ui);startEditing(ui);
 await waitFor(()=>expect(finish).toBeTypeOf("function"));
 fireEvent.click(ui.getByLabelText("关闭 AI 辅助编辑"));await act(async()=>finish());
 await waitFor(()=>expect(onClose).toHaveBeenCalled());
 expect(saved).toEqual(expect.objectContaining({complete:true,suggestions:[expect.objectContaining({id:"a",text:"可能吧"})]}));
 expect(onApply).not.toHaveBeenCalled();
});

it('restores successful unchanged batches after failure and only requests missing batches',async()=>{
 const long={...transcript,segments:Array.from({length:4},(_,i)=>({...transcript.segments[0],id:`row${i}`,text:'字'.repeat(1600)}))};
 let rejectSecond!:(e:Error)=>void;
 stubFetch(async(path,init)=>{
  if(!path.endsWith('/edit'))return;
  const rows=JSON.parse(String(init.body)).segments;
  if(rows[0].id==='row0')return {segments:rows.map((s:{id:string;text:string})=>({id:s.id,text:s.text,reason:''}))};
  if(rows[0].id==='row1')return new Promise((_,reject)=>{rejectSecond=reject;});
  return new Promise((_,reject)=>init.signal?.addEventListener('abort',()=>reject(new Error('cancelled'))));
 });
 const saveDraft=vi.fn<(draft:AIReviewDraft|null)=>Promise<void>>(async()=>{});
 const first=setup({transcript:long,saveDraft});await selectPlan(first.ui);
 startEditing(first.ui);
 await waitFor(()=>expect(saveDraft.mock.calls.some(([d])=>d?.resume?.completed.length===1)).toBe(true));
 rejectSecond(new Error('connection failed'));
 await first.ui.findByText('connection failed');
 expect(first.onApply).not.toHaveBeenCalled();
 const saved=saveDraft.mock.calls.map(([d])=>d).filter(d=>d?.resume?.completed.length===1).at(-1)!;
 expect(saved.suggestions).toHaveLength(0);
 cleanup();requests=[];stubFetch();
 const second=setup({transcript:long,loadDraft:async()=>saved,saveDraft});
 await second.ui.findByText('继续未完成部分');
 fireEvent.click(second.ui.getByRole('checkbox',{name:'选用口述史访谈稿'}));
 fireEvent.click(second.ui.getByText('继续未完成部分'));
 await second.ui.findByText(/基准稿范围、编辑引擎或编辑规则已变化/);
 expect(requests.filter(r=>r.path.endsWith('/edit'))).toHaveLength(0);
 fireEvent.click(second.ui.getByRole('checkbox',{name:'选用忠实转写'}));
 fireEvent.click(second.ui.getByText('继续未完成部分'));
 await waitFor(()=>expect(second.onApply).toHaveBeenCalledOnce());
 const ids=requests.filter(r=>r.path.endsWith('/edit')).flatMap(r=>(r.body!.segments as {id:string}[]).map(s=>s.id));
 expect(ids).toEqual(['row1','row2','row3']);
 expect(saveDraft).toHaveBeenLastCalledWith(null);
});


it('requires a user name before issuing editing requests and allows backing out',async()=>{
 stubFetch();const saveDraft=vi.fn(async()=>{});const {ui,onApply}=setup({saveDraft});await selectPlan(ui);
 fireEvent.click(ui.getByText('开始 AI 辅助编辑'));
 expect((ui.getByLabelText("版本名称") as HTMLInputElement).value).toBe('');
 expect((ui.getByText('确认名称并开始') as HTMLButtonElement).disabled).toBe(true);
 fireEvent.change(ui.getByLabelText("版本名称"),{target:{value:'   '}});
 expect((ui.getByText('确认名称并开始') as HTMLButtonElement).disabled).toBe(true);
 expect(requests.filter(r=>r.path.endsWith('/edit'))).toHaveLength(0);
 fireEvent.click(ui.getByText('返回'));
 expect(ui.queryByLabelText("版本名称")).toBeNull();
 startEditing(ui,'  我的访谈整理稿  ');
 await waitFor(()=>expect(onApply).toHaveBeenCalledWith(expect.any(Array),'我的访谈整理稿'));
 expect(saveDraft.mock.calls.some(args=>(args as unknown as [AIReviewDraft|null])[0]?.name==='我的访谈整理稿')).toBe(true);
});
it('preserves a user supplied name on reopening even when it matches an old automatic name',async()=>{
 stubFetch();const {ui,onApply}=setup({suggestedName:'新的自动名称',loadDraft:async()=>({nameSource:'user',baseline:transcript,suggestions:[],accepted:[],label:'全文',name:'AI 编辑稿',complete:true})});
 fireEvent.click(await ui.findByText("打开修改版本"));
 await waitFor(()=>expect(onApply).toHaveBeenCalledWith([],'AI 编辑稿'));
});


it("returns focus after leaving naming and after closing the dialog", async () => {
 stubFetch();
 const opener=document.createElement("button");document.body.append(opener);opener.focus();
 try {
  const {ui}=setup();await selectPlan(ui);
  fireEvent.click(ui.getByText("开始 AI 辅助编辑"));
  expect(document.activeElement).toBe(ui.getByLabelText("版本名称"));
  fireEvent.keyDown(ui.getByLabelText("版本名称"),{key:"Escape"});
  expect(document.activeElement).toBe(ui.getByText("开始 AI 辅助编辑"));
  ui.unmount();expect(document.activeElement).toBe(opener);
 } finally {opener.remove();}
});
