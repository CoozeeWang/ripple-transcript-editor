// @vitest-environment jsdom
import {cleanup, fireEvent, render} from "@testing-library/react";
import {afterEach, expect, it, vi} from "vitest";
import {AnnotationPanel, type AnnotationPanelProps} from "./AnnotationPanel";

afterEach(cleanup);
it("routes card title, background, excerpt and keyboard to the highlight jump but not removal",()=>{
  const segment={id:"s",speaker_id:"a",start:1,end:3,text:"甲乙"};
  const highlight={id:"h",start:0,end:1};
  const jump=vi.fn(), remove=vi.fn();
  const props:AnnotationPanelProps={transcript:null,annotationView:"all",setAnnotationView:vi.fn(),panelTab:"highlight",setPanelTab:vi.fn(),currentSegment:undefined,currentSegmentId:"",hiddenSpeakerIds:new Set(),annotationListRef:{current:null},collapsed:false,setCollapsed:vi.fn(),highlightGroups:[{segment,index:0,items:[{highlight,snippet:{before:"",marked:"甲",after:"乙",leadingEllipsis:false,trailingEllipsis:false}}]}],highlightCount:1,setSelectedSegmentId:vi.fn(),seekTo:vi.fn(),updateAnnotation:vi.fn(),deleteAnnotation:vi.fn(),addAnnotation:vi.fn(),onJumpToHighlight:jump,onRemoveHighlight:remove};
  const ui=render(<AnnotationPanel {...props}/>);
  fireEvent.click(ui.getByText(/片段 1/));
  fireEvent.click(ui.container.querySelector(".hl-card")!);
  fireEvent.click(ui.getByText("甲"));
  fireEvent.keyDown(ui.container.querySelector(".hl-row")!,{key:"Enter"});
  expect(jump).toHaveBeenCalledTimes(4);
  expect(jump).toHaveBeenLastCalledWith(segment,highlight);
  fireEvent.click(ui.getByRole("button",{name:"取消这一处高亮"}));
  expect(remove).toHaveBeenCalledWith("s","h");
  expect(jump).toHaveBeenCalledTimes(4);
  const panel=document.createElement("main"); panel.className="transcript-panel";
  const target=document.createElement("div"); target.id="segment-s"; panel.append(target); document.body.append(panel);
  const scroll=vi.fn(); panel.scrollTo=scroll;
  const frame=vi.spyOn(window,"requestAnimationFrame").mockImplementation(callback=>{callback(0);return 1;});
  ui.rerender(<AnnotationPanel {...props} panelTab="annotation" annotationView="selected" currentSegment={{...segment,annotations:[{id:"a",text:"定位批注",createdAt:new Date().toISOString()}]}} transcript={{audio:{filename:"test.wav",duration:3},segments:[segment],speakers:[]}}/>);
  fireEvent.click(ui.getByText("定位批注"));
  expect(props.setSelectedSegmentId).toHaveBeenCalledWith("s");
  expect(scroll).toHaveBeenCalledWith({top:0,behavior:"instant"});
  frame.mockRestore(); panel.remove();
});
