// @vitest-environment jsdom
import {useState} from "react";
import {act,cleanup,fireEvent,render,screen,within} from "@testing-library/react";
import {afterAll,afterEach,beforeAll,expect,it,vi} from "vitest";
import {VersionPicker} from "./VersionPicker";
import type {TranscriptModel} from "../types";
import {displayEngineLabel} from "../localStore";
// jsdom hides [popover] but does not implement the browser's top-layer API.
const nativeShowPopover=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'showPopover');
beforeAll(()=>Object.defineProperty(HTMLElement.prototype,'showPopover',{configurable:true,value:function(this:HTMLElement){this.style.display='block';}}));
afterAll(()=>{if(nativeShowPopover)Object.defineProperty(HTMLElement.prototype,'showPopover',nativeShowPopover);else delete (HTMLElement.prototype as Partial<HTMLElement>).showPopover;});
const models:TranscriptModel[]=[{id:"m1",engine:"ElevenLabs Scribe v2",label:"ElevenLabs Scribe v2 · 分段合并",createdAt:"2026-09-20",original:"original.json",activeEditId:"e1",edits:[{id:"e1",label:"v1",file:"v1.json",updated_at:"2026-09-20"},{id:"e2",label:"校订稿",file:"v2.json",updated_at:"2026-09-20"}]}];
afterEach(()=>{cleanup();vi.useRealTimers();});
it("shows the engine rather than the legacy model label and keeps original read-only",()=>{
 const select=vi.fn(),rename=vi.fn();
 render(<VersionPicker models={models} value="m1:e1" variant="current" onSelect={select} onRename={rename}/>);
 fireEvent.click(screen.getByRole("button",{name:"当前版本：v1"}));
 expect(screen.getByText("转录引擎")).toBeTruthy();
 expect(screen.getByText("ElevenLabs Scribe v2")).toBeTruthy();
 expect(screen.queryByText(/分段合并/)).toBeNull();
 expect(screen.queryByRole("button",{name:/重命名原始/})).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"原始转录稿（只读）"}));
 expect(select).toHaveBeenCalledWith("m1","original");
 expect(displayEngineLabel("ElevenLabs Scribe v2 · 分段合并")).toBe("ElevenLabs Scribe v2");
});
it("renames from the comparison menu without switching either selection and updates both menus",async()=>{
 const select=vi.fn();
 function Pair(){const [data,setData]=useState(models);const rename=(model:string,edit:string)=>setData(data.map(m=>m.id!==model?m:{...m,edits:m.edits.map(e=>e.id===edit?{...e,label:"定稿"}:e)}));return <>
 <VersionPicker models={data} value="m1:e1" variant="current" onRename={rename} onSelect={select}/>
 <VersionPicker models={data} value="m1:e2" excluded="m1:e1" variant="comparison" onRename={rename} onSelect={select}/></>;}
 render(<Pair/>);fireEvent.click(screen.getByRole("button",{name:"对照版本：校订稿"}));
 const menu=screen.getByRole("group",{name:"对照版本列表"});expect(within(menu).queryByRole("button",{name:"v1"})).toBeNull();
 fireEvent.click(within(menu).getByRole("button",{name:"重命名校订稿"}));
 const input=screen.getByRole("textbox",{name:"版本名称"});
 fireEvent.change(input,{target:{value:"定稿"}});
 await act(async()=>{fireEvent.keyDown(input,{key:"Enter"});});
 expect(select).not.toHaveBeenCalled();
 expect(screen.getByRole("button",{name:"对照版本：定稿"})).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:"当前版本：v1"}));
 expect(within(screen.getByRole("group",{name:"当前版本列表"})).getByRole("button",{name:"定稿"})).toBeTruthy();
});
it("retains copy and delete actions without also selecting the row",()=>{
 const select=vi.fn(),copy=vi.fn(),remove=vi.fn();
 render(<VersionPicker models={models} value="m1:e1" variant="current" onSelect={select} onRename={vi.fn()} onCopy={copy} onDelete={remove}/>);
 fireEvent.click(screen.getByRole("button",{name:"当前版本：v1"}));
 fireEvent.click(screen.getByRole("button",{name:"将 校订稿 复制为新修改版本"}));expect(copy).toHaveBeenCalledWith("m1","e2");
 fireEvent.click(screen.getByRole("button",{name:"当前版本：v1"}));
 fireEvent.click(screen.getByRole("button",{name:"删除校订稿"}));expect(remove).toHaveBeenCalledWith("m1","e2","校订稿",false);expect(select).not.toHaveBeenCalled();
});
it("closes with Escape or an outside pointer and restores focus for Escape",()=>{
 render(<VersionPicker models={models} value="m1:e1" variant="current" onSelect={vi.fn()} onRename={vi.fn()}/>);
 const trigger=screen.getByRole("button",{name:"当前版本：v1"});fireEvent.click(trigger);
 const option=screen.getByRole("button",{name:"校订稿"});option.focus();fireEvent.keyDown(option,{key:"Escape"});
 expect(screen.queryByRole("group")).toBeNull();expect(document.activeElement).toBe(trigger);
 fireEvent.click(trigger);fireEvent.pointerDown(document.body);expect(screen.queryByRole("group")).toBeNull();
});

it("double click edits in place without selecting and Escape cancels",()=>{
 vi.useFakeTimers();const select=vi.fn(),rename=vi.fn();
 render(<VersionPicker models={models} value="m1:e1" variant="current" onSelect={select} onRename={rename}/>);
 fireEvent.click(screen.getByRole("button",{name:"当前版本：v1"}));
 const row=screen.getByRole("button",{name:"校订稿"});
 fireEvent.click(row,{detail:1});fireEvent.click(row,{detail:2});fireEvent.doubleClick(row);
 act(()=>{vi.runAllTimers();});
 const input=screen.getByRole("textbox",{name:"版本名称"});
 expect(document.activeElement).toBe(input);expect(select).not.toHaveBeenCalled();
 fireEvent.change(input,{target:{value:"不保存"}});fireEvent.keyDown(input,{key:"Escape"});
 expect(rename).not.toHaveBeenCalled();expect(screen.queryByRole("textbox")).toBeNull();
 expect(screen.getByRole("group",{name:"当前版本列表"})).toBeTruthy();
});
it("keeps the entered name and reports save failure inline",async()=>{
 const rename=vi.fn(async()=>{throw new Error("写入失败");});
 render(<VersionPicker models={models} value="m1:e1" variant="current" onSelect={vi.fn()} onRename={rename}/>);
 fireEvent.click(screen.getByRole("button",{name:"当前版本：v1"}));
 fireEvent.click(screen.getByRole("button",{name:"重命名校订稿"}));
 const input=screen.getByRole("textbox",{name:"版本名称"});
 fireEvent.change(input,{target:{value:"  "}});fireEvent.keyDown(input,{key:"Enter"});
 expect(rename).not.toHaveBeenCalled();
 fireEvent.change(input,{target:{value:" 定稿 "}});
 await act(async()=>{fireEvent.keyDown(input,{key:"Enter"});});
 expect(rename).toHaveBeenCalledWith("m1","e2","定稿");
 expect(screen.getByRole("alert").textContent).toBe("写入失败");
 expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(" 定稿 ");
});
it("single pointer click still selects after the double-click window",()=>{
 vi.useFakeTimers();const select=vi.fn();
 render(<VersionPicker models={models} value="m1:e1" variant="current" onSelect={select} onRename={vi.fn()}/>);
 fireEvent.click(screen.getByRole("button",{name:"当前版本：v1"}));
 fireEvent.click(screen.getByRole("button",{name:"校订稿"}),{detail:1});
 act(()=>{vi.runAllTimers();});
 expect(select).toHaveBeenCalledWith("m1","e2");expect(screen.queryByRole("group")).toBeNull();
});
it('labels external baselines as imported and offers comparison and new edits without pretending they were transcribed',()=>{
 const select=vi.fn();
 render(<VersionPicker models={[{...models[0],sourceKind:'import',label:undefined}]} value="m1:original" variant="current" onSelect={select} onRename={vi.fn()} onCopy={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'当前版本：导入稿（只读）'}));
 expect(screen.getAllByText('外部导入').length).toBeGreaterThan(0);
 expect(screen.queryByText('原始转录稿（只读）')).toBeNull();
 expect(screen.queryByRole('button',{name:/重命名导入稿/})).toBeNull();
});

it('renames an imported transcript independently of its edit versions',async()=>{
 const rename=vi.fn();
 render(<VersionPicker models={[{...models[0],sourceKind:'import',label:'人工初稿',sourceName:'访谈.txt'}]} value="m1:original" variant="current" onRename={rename} onSelect={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'当前版本：导入稿（只读）'}));
 fireEvent.click(screen.getByRole('button',{name:'重命名转录稿 人工初稿'}));
 fireEvent.change(screen.getByRole('textbox',{name:'转录稿名称'}),{target:{value:'人工校订稿'}});
 await act(async()=>fireEvent.keyDown(screen.getByRole('textbox',{name:'转录稿名称'}),{key:'Enter'}));
 expect(rename).toHaveBeenCalledWith('m1','model-name','人工校订稿');
 expect(screen.queryByRole('group')).toBeNull();
 const trigger=screen.getByRole('button',{name:'当前版本：导入稿（只读）'});expect(document.activeElement).toBe(trigger);fireEvent.click(trigger);
 expect(screen.getByRole('button',{name:/^v1.*人工初稿/})).toBeTruthy();
});

it('flattens imported groups and keeps a pristine import snapshot out of the current list',()=>{
 const copy=vi.fn();render(<VersionPicker models={[{...models[0],sourceKind:'import',label:'外部校订稿'}]} value="m1:e1" variant="current" onSelect={vi.fn()} onRename={vi.fn()} onCopy={copy}/>);
 fireEvent.click(screen.getByRole('button',{name:'当前版本：v1'}));
 expect(screen.queryByText('转录引擎')).toBeNull();expect(screen.queryByText('导入稿（只读）')).toBeNull();
 const button=screen.getByRole('button',{name:'将 v1 复制为新修改版本'});expect(button.getAttribute('data-tip')).toBe('复制为新修改版本');fireEvent.click(button);expect(copy).toHaveBeenCalledWith('m1','e1');
});
it('offers an icon action to create an edit from a designated imported original',()=>{
 const copy=vi.fn();render(<VersionPicker models={[{...models[0],sourceKind:'import',designatedOriginal:true,label:'访谈原稿'}]} value="m1:original" variant="current" onSelect={vi.fn()} onRename={vi.fn()} onCopy={copy}/>);
 fireEvent.click(screen.getByRole('button',{name:'当前版本：原始转录稿（只读）'}));
 const button=screen.getByRole('button',{name:"从该原始转录稿新建修改版本"});expect(button.getAttribute('data-tip')).toBe('新建修改版本');fireEvent.click(button);expect(copy).toHaveBeenCalledWith('m1','original');
});

it('orders imported originals before edits and gives an edit only one rename action',()=>{
 const imported:TranscriptModel[]=[{...models[0],id:'edit',sourceKind:'import',label:'外部修改稿'}, {...models[0],id:'original',sourceKind:'import',designatedOriginal:true,label:'原稿'}];
 render(<VersionPicker models={imported} value="original:original" variant="current" onSelect={vi.fn()} onRename={vi.fn()} onCopy={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'当前版本：原始转录稿（只读）'}));
 const menu=screen.getByRole('group',{name:'当前版本列表'});
 const rows=menu.querySelectorAll('.version-picker-row');expect(rows[0].classList.contains('version-picker-row--original')).toBe(true);
 const editRow=Array.from(rows).find(row=>row.textContent?.includes('v1'))!;
 expect(within(editRow as HTMLElement).getAllByRole('button').filter(b=>/重命名|修改转录稿名称/.test(b.getAttribute('aria-label')??''))).toHaveLength(1);
});

it('keeps IME confirmation and cancellation inside renaming and restores its row afterward',()=>{
 const rename=vi.fn();render(<VersionPicker models={models} value="m1:e1" variant="current" onSelect={vi.fn()} onRename={rename}/>);
 const trigger=screen.getByRole('button',{name:'当前版本：v1'});trigger.focus();fireEvent.keyDown(trigger,{key:'ArrowDown'});
 expect(document.activeElement).toBe(screen.getByRole('button',{name:'v1'}));
 const renameButton=screen.getByRole('button',{name:'重命名v1'});renameButton.focus();fireEvent.click(renameButton);
 const input=screen.getByRole('textbox',{name:'版本名称'});fireEvent.change(input,{target:{value:'候选词'}});
 fireEvent.keyDown(input,{key:'Enter',keyCode:229});fireEvent.keyDown(input,{key:'Escape',isComposing:true});
 expect(rename).not.toHaveBeenCalled();expect(screen.getByRole('textbox',{name:'版本名称'})).toBe(input);
 fireEvent.keyDown(input,{key:'Escape'});expect(document.activeElement).toBe(screen.getByRole('button',{name:'v1'}));
 fireEvent.keyDown(document.activeElement!,{key:'Escape'});expect(document.activeElement).toBe(trigger);
});
it('navigates version actions without dispatching a global arrow shortcut',()=>{
 render(<VersionPicker models={models} value="m1:e1" variant="current" onSelect={vi.fn()} onRename={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'当前版本：v1'}));
 const globalKey=vi.fn();window.addEventListener('keydown',globalKey);
 fireEvent.keyDown(document.activeElement!,{key:'End'});expect(document.activeElement).toBe(screen.getByRole('button',{name:'重命名校订稿'}));
 fireEvent.keyDown(document.activeElement!,{key:'Home'});expect(document.activeElement).toBe(screen.getByRole('button',{name:'原始转录稿（只读）'}));
 expect(globalKey).not.toHaveBeenCalled();window.removeEventListener('keydown',globalKey);
});
