// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EditingPlanSettings } from "./EditingPlanSettings";
import type { EditingPlan } from "../lib/planForms";
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
it("edits and deletes the shared saved plan without changing system presets",async()=>{
 let plans:EditingPlan[]=[{id:"one",name:"访谈方案",instructions:"保留原话",common:false}];
 const calls:RequestInit[]=[];
 vi.stubGlobal("fetch",vi.fn(async(_path:string,init:RequestInit)=>{
  calls.push(init);
  if(init.method==="PUT")plans=[{id:"one",...JSON.parse(String(init.body))}];
  if(init.method==="DELETE")plans=[];
  return {ok:true,json:async()=>init.method==="PUT"?plans[0]:init.method==="DELETE"?{ok:true}:plans};
 }));
 const confirm=vi.spyOn(window,"confirm").mockReturnValue(false);
 const ui=render(<EditingPlanSettings/>);
 await ui.findByText("访谈方案");
 expect(ui.getAllByText("删除方案")).toHaveLength(1);
 fireEvent.click(ui.getByText("编辑"));
 fireEvent.change(ui.getByLabelText("方案名称"),{target:{value:"新名称"}});
 fireEvent.change(ui.getByLabelText("编辑规则"),{target:{value:"保留语气和重复"}});
 fireEvent.click(ui.getByLabelText("显示在常用方案中"));
 fireEvent.click(ui.getByText("保存修改"));
 await ui.findByText("新名称");
 expect(plans[0]).toEqual({id:"one",name:"新名称",instructions:"保留语气和重复",common:true});
 fireEvent.click(ui.getByText("删除方案"));expect(calls.some(c=>c.method==="DELETE")).toBe(false);
 confirm.mockReturnValue(true);fireEvent.click(ui.getByText("删除方案"));
 await waitFor(()=>expect(ui.queryByText("新名称")).toBeNull());
 expect(ui.getByText("忠实转写")).toBeTruthy();
 expect(ui.getByText(/还没有保存的方案/)).toBeTruthy();
});
it("keeps unsaved input when saving fails",async()=>{
 vi.stubGlobal("fetch",vi.fn(async(_path:string,init:RequestInit)=>({ok:init.method!=="PUT",json:async()=>init.method==="PUT"?{detail:"保存失败"}:[{id:"one",name:"方案",instructions:"规则"}]})));
 const ui=render(<EditingPlanSettings/>);await ui.findByText("方案");fireEvent.click(ui.getByText("编辑"));
 fireEvent.change(ui.getByLabelText("编辑规则"),{target:{value:"新的规则"}});fireEvent.click(ui.getByText("保存修改"));
 await ui.findByRole("alert");expect((ui.getByLabelText("编辑规则") as HTMLTextAreaElement).value).toBe("新的规则");
});
