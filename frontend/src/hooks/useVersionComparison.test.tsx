// @vitest-environment jsdom
import {act,cleanup,renderHook,waitFor} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {useVersionComparison} from "./useVersionComparison";
import type {TranscriptModel,Transcript} from "../types";
import {readModelEdit} from "../localStore";
vi.mock("../localStore",()=>({displayEngineLabel:(engine:string)=>engine,defaultEditLabel:(i:number)=>`修改稿 ${i+1}`,readModelOriginal:vi.fn(async()=>({transcript:{segments:[]}})),readModelEdit:vi.fn(async()=>({transcript:{segments:[]}}))}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
const dir={} as FileSystemDirectoryHandle;
const models:TranscriptModel[]=[{id:"m1",engine:"引擎",original:"original.json",activeEditId:"e2",edits:[{id:"e1",file:"1.json",updated_at:""},{id:"e2",file:"2.json",comparisonBaseId:"e1",updated_at:""}]}];
it("defaults to hidden for ordinary opening, selects AI source as baseline, and resets on manuscript change",async()=>{
 const {result,rerender}=renderHook(({audio})=>useVersionComparison(dir,audio,models,"m1","e2",false),{initialProps:{audio:"A.wav"}});
 expect(result.current.shown).toBe(false);expect(result.current.base).toBe("m1:e1");expect(result.current.options.map(o=>o.value)).not.toContain("m1:e2");
 act(()=>result.current.toggle());await waitFor(()=>expect(result.current.loading).toBe(false));expect(readModelEdit).toHaveBeenCalledWith(dir,"A.wav","m1","e1");
 rerender({audio:"B.wav"});expect(result.current.shown).toBe(false);expect(result.current.baseline).toBeNull();
});
it("ignores a slow old baseline response after choosing another version",async()=>{
 let finish!:(value:{transcript:Transcript})=>void;
 vi.mocked(readModelEdit).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve as typeof finish;}));
 const {result}=renderHook(()=>useVersionComparison(dir,"A",models,"m1","e2",false));
 act(()=>result.current.toggle());act(()=>result.current.choose("m1:original"));
 await waitFor(()=>expect(result.current.loading).toBe(false));
 await act(async()=>finish({transcript:{audio:{filename:"old",duration:0},speakers:[],segments:[]}}));
 expect(result.current.base).toBe("m1:original");expect(result.current.baseline?.audio).toBeUndefined();
});
it("activates differences on the newly created AI version only",async()=>{
 const {result,rerender}=renderHook(({id})=>useVersionComparison(dir,"A",models,"m1",id,false),{initialProps:{id:"e1"}});
 act(()=>result.current.activate("m1","e2","m1:e1"));expect(result.current.shown).toBe(false);
 rerender({id:"e2"});expect(result.current.shown).toBe(true);expect(result.current.base).toBe("m1:e1");
 await waitFor(()=>expect(result.current.loading).toBe(false));
});

it("does not briefly reuse an old baseline when the same comparison is reopened",async()=>{
 const {result}=renderHook(()=>useVersionComparison(dir,"A",models,"m1","e2",false));
 act(()=>result.current.toggle());await waitFor(()=>expect(result.current.loading).toBe(false));
 act(()=>result.current.toggle());
 let finish!:(value:Awaited<ReturnType<typeof readModelEdit>>)=>void;
 vi.mocked(readModelEdit).mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));
 act(()=>result.current.toggle());
 expect(result.current.loading).toBe(true);expect(result.current.baseline).toBeNull();
 await act(async()=>finish(null));expect(result.current.error).toBe("无法读取对照版本");
});
it('keeps comparison off in original mode including keyboard toggle and direct selection',()=>{
 const {result}=renderHook(()=>useVersionComparison(dir,'A',models,'m1','e2',true));
 act(()=>result.current.toggle());expect(result.current.shown).toBe(false);
 act(()=>result.current.choose('m1:e1'));expect(result.current.shown).toBe(false);
 expect(result.current.baseline).toBeNull();expect(readModelEdit).not.toHaveBeenCalled();
});
