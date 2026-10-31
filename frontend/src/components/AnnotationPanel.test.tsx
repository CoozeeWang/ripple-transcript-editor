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
  ui.rerender(<AnnotationPanel {...props} readOnly />);
  expect((ui.getByRole('button',{name:'取消这一处高亮'}) as HTMLButtonElement).disabled).toBe(true);
  expect(ui.getByText(/当前转录稿为只读/)).toBeTruthy();
  fireEvent.click(ui.getByRole('button',{name:'取消这一处高亮'}));
  expect(remove).toHaveBeenCalledTimes(1);
  frame.mockRestore(); panel.remove();
});

it('adds to the selected segment from All, keeps drafts scoped to their target and respects read-only', () => {
 const first={id:'s1',speaker_id:'a',start:0,end:1,text:'First'}, second={id:'s2',speaker_id:'a',start:1,end:2,text:'Second'};
 const add=vi.fn();
 const props:AnnotationPanelProps={transcript:{audio:{filename:'synthetic.wav',duration:2},segments:[first,second],speakers:[]},annotationView:'all',setAnnotationView:vi.fn(),panelTab:'annotation',setPanelTab:vi.fn(),currentSegment:first,currentSegmentId:first.id,hiddenSpeakerIds:new Set(),annotationListRef:{current:null},collapsed:false,setCollapsed:vi.fn(),highlightGroups:[],highlightCount:0,setSelectedSegmentId:vi.fn(),seekTo:vi.fn(),updateAnnotation:vi.fn(),deleteAnnotation:vi.fn(),addAnnotation:add,onJumpToHighlight:vi.fn(),onRemoveHighlight:vi.fn()};
 const ui=render(<AnnotationPanel {...props}/>);
 fireEvent.change(ui.getByRole('textbox'),{target:{value:'Synthetic note'}});
 fireEvent.keyDown(ui.getByRole('textbox'),{key:'Enter',metaKey:true});
 expect(add).toHaveBeenCalledExactlyOnceWith('s1','Synthetic note');
 fireEvent.change(ui.getByRole('textbox'),{target:{value:'Unsent'}});
 ui.rerender(<AnnotationPanel {...props} currentSegment={second} currentSegmentId={second.id}/>);
 expect((ui.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
 ui.rerender(<AnnotationPanel {...props} readOnly/>);
 expect((ui.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true);
 expect((ui.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Unsent');
 ui.rerender(<AnnotationPanel {...props} currentSegment={undefined} currentSegmentId=''/>);
 expect(ui.queryByRole('textbox')).toBeNull();
});
it('keeps collapsed rail to one expand control and uses the same SVG frame for all three tabs',()=>{
 const props:AnnotationPanelProps={transcript:null,annotationView:'selected',setAnnotationView:vi.fn(),panelTab:'annotation',setPanelTab:vi.fn(),currentSegment:undefined,currentSegmentId:'',hiddenSpeakerIds:new Set(),annotationListRef:{current:null},collapsed:true,setCollapsed:vi.fn(),highlightGroups:[],highlightCount:0,setSelectedSegmentId:vi.fn(),seekTo:vi.fn(),updateAnnotation:vi.fn(),deleteAnnotation:vi.fn(),addAnnotation:vi.fn(),onJumpToHighlight:vi.fn(),onRemoveHighlight:vi.fn()};const h=render(<AnnotationPanel {...props}/>);expect(h.container.querySelectorAll('.annotation-rail svg')).toHaveLength(1);expect(h.getAllByRole('button')).toHaveLength(1);h.rerender(<AnnotationPanel {...props} collapsed={false} tagsPanel={<div>Synthetic tags</div>} tagCount={2}/>);const icons=h.container.querySelectorAll('.panel-tab-icon');expect(icons).toHaveLength(3);expect([...icons].every(e=>e.getAttribute('width')==='20'&&e.getAttribute('height')==='20')).toBe(true);expect(icons[0].querySelectorAll('path')).toHaveLength(2);
});
