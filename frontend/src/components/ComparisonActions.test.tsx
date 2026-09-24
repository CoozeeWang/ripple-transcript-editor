// @vitest-environment jsdom
import {useEffect,useRef,useState} from "react";
import {act,cleanup,fireEvent,render} from "@testing-library/react";
import {afterEach,expect,it} from "vitest";
import {SegmentItem,type SegmentItemProps} from "./SegmentItem";
import {useTranscriptHistory} from "../useTranscriptHistory";
import {applyComparisonDecision,comparisonReviewKey,reconcileComparisonReviews} from "../lib/comparisonReview";
import type {Transcript} from "../types";
import type {ParagraphEditorElement} from "../lib/paragraphEditor";
import {writeEditorText} from "../lib/paragraphEditor";
const initial:Transcript={audio:{filename:"test.wav",duration:1},speakers:[{id:"p",name:"测试"}],segments:[{id:"s",speaker_id:"p",start:0,end:1,text:"甲新乙丙改丁"}]};
const before="甲旧乙丙原丁";
const baseline=[{...initial.segments[0],text:before,words:Array.from(before,(text,i)=>({text,start:i,end:i+1}))}];
const noop=()=>{};
afterEach(cleanup);
function Harness(){
 const history=useTranscriptHistory<Transcript>();const [base,setBase]=useState("e1");const [shown,setShown]=useState(true);
 const registry=useRef(new Map<string,ParagraphEditorElement>());
 const reset=history.reset;
 useEffect(()=>{reset(initial);},[reset]);
 const t=history.transcript;if(!t)return null;
 const props:SegmentItemProps={segment:t.segments[0],index:0,totalSegments:1,speakers:t.speakers,effectiveSelectedSegmentId:"s",isPlaying:false,currentTime:0,findQuery:"",audioUrl:"",viewingOriginal:false,audioRef:{current:null},textareaRefs:registry,editingRef:{current:false},setSelectedSegmentId:noop,seekTo:noop,recordEditorCursor:noop,addSpeaker:noop,updateSegment:(_id,changes)=>history.commit(current=>reconcileComparisonReviews({...current,segments:[{...current.segments[0],...changes}]})),removeSegment:noop,splitSegment:noop,mergeWithNext:noop,handleEditorKeydown:noop};
 return <><button onClick={history.undo}>撤销</button><button onClick={history.redo}>重做</button><button onClick={()=>setBase(b=>b==="e1"?"e2":"e1")}>换对照</button><button onClick={()=>setShown(s=>!s)}>痕迹</button>
 <SegmentItem {...props} comparisonBase={base} comparisonBefore={shown?before:undefined} comparisonAccepted={t.comparisonReviews?.[comparisonReviewKey(base,"s")]?.accepted}
 onComparisonDecision={decision=>history.commit(current=>reconcileComparisonReviews(applyComparisonDecision(current,decision,baseline)))}/>
 <output>{t.segments[0].text}</output><output data-testid="words">{JSON.stringify(t.segments[0].words)}</output></>;
}
it("opens actions through the real segment hit area, accepts locally, rejects another, and supports undo/redo",()=>{
 const ui=render(<Harness/>),editor=ui.getByRole("textbox");
 fireEvent.click(editor.querySelector("ins")!);expect(ui.getByRole("group",{name:"此处修改"})).toBeTruthy();
 fireEvent.click(ui.getByRole("button",{name:"接受"}));expect(editor.querySelectorAll("ins")).toHaveLength(1);expect(ui.getByText("甲新乙丙改丁",{selector:"output"})).toBeTruthy();
 fireEvent.click(editor.querySelector("del")!);fireEvent.click(ui.getByRole("button",{name:"拒绝"}));
 expect(ui.getByText("甲新乙丙原丁",{selector:"output"})).toBeTruthy();expect(editor.querySelector("ins")).toBeNull();
 const restoredWords=ui.getByTestId("words").textContent;
 expect(JSON.parse(restoredWords!).find((word:{text:string})=>word.text==="原")).toEqual({text:"原",start:4,end:5});
 fireEvent.click(ui.getByText("撤销"));expect(editor.querySelectorAll("ins")).toHaveLength(1);
 expect(ui.getByTestId("words").textContent).toBe("");
 fireEvent.click(ui.getByText("重做"));expect(ui.getByTestId("words").textContent).toBe(restoredWords);
 fireEvent.click(ui.getByText("撤销"));
 fireEvent.click(ui.getByText("撤销"));expect(editor.querySelectorAll("ins")).toHaveLength(2);
 fireEvent.click(ui.getByText("重做"));expect(editor.querySelectorAll("ins")).toHaveLength(1);
 fireEvent.click(ui.getByText("换对照"));expect(editor.querySelectorAll("ins")).toHaveLength(2);
 fireEvent.click(ui.getByText("换对照"));expect(editor.querySelectorAll("ins")).toHaveLength(1);
 fireEvent.click(ui.getByText("痕迹"));expect(editor.querySelector("ins")).toBeNull();
 fireEvent.click(ui.getByText("痕迹"));expect(editor.querySelectorAll("ins")).toHaveLength(1);
});
it("dismisses obsolete menus on IME input or baseline changes and keeps copying plain text",()=>{
 const ui=render(<Harness/>),editor=ui.getByRole("textbox") as ParagraphEditorElement;
 fireEvent.click(editor.querySelector("ins")!);fireEvent.click(ui.getByText("换对照"));expect(ui.queryByRole("group",{name:"此处修改"})).toBeNull();
 fireEvent.click(editor.querySelector("ins")!);fireEvent.compositionStart(editor);expect(ui.queryByRole("group",{name:"此处修改"})).toBeNull();
 act(()=>{writeEditorText(editor,"甲新输入乙丙改丁");fireEvent.input(editor);});fireEvent.compositionEnd(editor);
 const clipboard:Record<string,string>={};editor.setSelectionRange(0,editor.value.length);
 fireEvent.copy(editor,{clipboardData:{setData:(kind:string,text:string)=>{clipboard[kind]=text;}}});
 expect(clipboard["text/plain"]).toBe("甲新输入乙丙改丁");
});
