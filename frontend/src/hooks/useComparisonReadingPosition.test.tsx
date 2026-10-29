// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useComparisonReadingPosition } from "./useComparisonReadingPosition";

afterEach(() => { cleanup(); document.body.replaceChildren(); });
function setup() {
  const panel = document.createElement("section");
  panel.innerHTML = '<article class="segment segment--selected" id="segment-old"></article><article class="segment" id="segment-reading"><p class="rt-para">正在看的段落</p></article>';
  document.body.append(panel);
  panel.scrollTop = 1000;
  let top = -20, height = 100;
  panel.getBoundingClientRect = () => ({ top: 0, bottom: 500, height: 500 } as DOMRect);
  const selected = panel.children[0] as HTMLElement;
  selected.getBoundingClientRect = () => ({ top: -900, bottom: -500, height: 400 } as DOMRect);
  const segment = panel.children[1] as HTMLElement;
  const rect = () => ({ top, bottom: top + height, height } as DOMRect);
  segment.getBoundingClientRect = rect;
  (segment.firstChild as HTMLElement).getBoundingClientRect = rect;
  panel.scrollTo = vi.fn((options?: ScrollToOptions | number) => {
    const next = typeof options === "number" ? options : options?.top ?? 0;
    top -= next - panel.scrollTop;
    panel.scrollTop = next;
  });
  const ref = { current: panel }, dir = {};
  const initialProps = { directory: dir, context: "A", shown: false, loading: false, baseline: null as unknown };
  const hook = renderHook(p => useComparisonReadingPosition(ref, p.directory, p.context, p.shown, p.loading, p.baseline), { initialProps });
  return { panel, hook, initialProps, shift: (t: number, h = 100) => { top = t; height = h; }, replaceParagraph: () => {
    segment.innerHTML = '<p class="rt-para">带修改痕迹的段落</p>';
    (segment.firstChild as HTMLElement).getBoundingClientRect = rect;
  } };
}

it("keeps the visible paragraph through async loading and replaced text nodes, then hiding", () => {
  const { panel, hook, initialProps, shift, replaceParagraph } = setup();
  act(() => hook.result.current());
  hook.rerender({ ...initialProps, shown: true, loading: true });
  expect(panel.scrollTop).toBe(1000);
  shift(380, 200); replaceParagraph();
  hook.rerender({ ...initialProps, shown: true, baseline: {} });
  expect(panel.scrollTop).toBe(1420); // preserve the 20% reading position in the paragraph
  act(() => hook.result.current());
  shift(-440);
  hook.rerender(initialProps);
  expect(panel.scrollTop).toBe(1000);
});

it("does not restore an old anchor in another document or directory", () => {
  const { panel, hook, initialProps, shift } = setup();
  act(() => hook.result.current());
  shift(400);
  hook.rerender({ ...initialProps, context: "B", shown: true, baseline: {} });
  expect(panel.scrollTo).not.toHaveBeenCalled();
  act(() => hook.result.current());
  hook.rerender({ ...initialProps, directory: {}, shown: true, baseline: {} });
  expect(panel.scrollTo).not.toHaveBeenCalled();
});

it("does not pull the reader back if they scroll while the comparison loads", () => {
  const { panel, hook, initialProps, shift } = setup();
  act(() => hook.result.current());
  hook.rerender({ ...initialProps, shown: true, loading: true });
  vi.mocked(panel.scrollTo).mockClear();
  act(() => panel.dispatchEvent(new Event("wheel")));
  shift(400);
  hook.rerender({ ...initialProps, shown: true, baseline: {} });
  expect(panel.scrollTo).not.toHaveBeenCalled();
});

// Real editor offsets with synthetic layout: jsdom has no text geometry.
function editingSetup(count = 3) {
  const panel = document.createElement('section'); document.body.append(panel);
  panel.scrollTop = 1000;
  panel.getBoundingClientRect = () => ({top:0,bottom:500,height:500} as DOMRect);
  let extra = 0, rowHeight = 180, caret = 350;
  for (let index=0;index<count;index++) {
    const row=document.createElement('article');row.className='segment';row.id=`segment-${index}`;
    const editor=document.createElement('div');editor.dataset.transcriptEditor='true';editor.contentEditable='true';editor.tabIndex=0;editor.textContent='甲乙丙丁';row.append(editor);panel.append(row);
    row.getBoundingClientRect=()=>({top:980+index*180+extra-panel.scrollTop,bottom:980+index*180+extra-panel.scrollTop+rowHeight,height:rowHeight} as DOMRect);
  }
  const editor=panel.lastElementChild!.firstElementChild as HTMLElement;
  const rectDescriptor=Object.getOwnPropertyDescriptor(Range.prototype,'getBoundingClientRect');
  Object.defineProperty(Range.prototype,'getBoundingClientRect',{configurable:true,value:()=>({top:caret-panel.scrollTop,bottom:caret-panel.scrollTop+20,height:20})});
  const restoreRect=()=>{if(rectDescriptor)Object.defineProperty(Range.prototype,'getBoundingClientRect',rectDescriptor);else delete (Range.prototype as Partial<Range>).getBoundingClientRect;};
  const select=()=>{editor.focus();const range=document.createRange();range.setStart(editor.firstChild!,1);range.setEnd(editor.firstChild!,3);window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(range);};
  const ref={current:panel},directory={};
  const props={directory,context:'synthetic-version',shown:false,loading:false,baseline:null as unknown};
  panel.scrollTo=vi.fn((options?:ScrollToOptions|number)=>{panel.scrollTop=typeof options==='number'?options:options?.top??0;});
  const hook=renderHook(p=>useComparisonReadingPosition(ref,p.directory,p.context,p.shown,p.loading,p.baseline),{initialProps:props});
  select();
  return {panel,editor,hook,props,select,restoreRect,layout:(shift:number,height=180,cursor=350)=>{extra=shift;rowHeight=height;caret=cursor;}};
}

it('centers the active editor through async expansion and repeated show/hide, preserving selection and focus',()=>{
 const s=editingSetup();try {
  const selection=window.getSelection()!,anchor=selection.anchorNode,focus=selection.focusNode;
  for(let cycle=0;cycle<3;cycle++) {
   act(()=>s.hook.result.current());
   s.hook.rerender({...s.props,shown:true,loading:true});
   s.layout(820);
   s.hook.rerender({...s.props,shown:true,baseline:{cycle}});
   expect(s.panel.scrollTop).toBe(2000); // active row top = 160 in a 500px viewport
   expect(document.activeElement).toBe(s.editor);
   expect([selection.anchorNode,selection.anchorOffset,selection.focusNode,selection.focusOffset]).toEqual([anchor,1,focus,3]);
   act(()=>s.hook.result.current());s.layout(0);s.hook.rerender(s.props);
   expect(s.panel.scrollTop).toBe(1180);
  }
 } finally{s.restoreRect();}
});

it('keeps a long segment caret visible in a 1060-row transcript without changing its selection',()=>{
 const s=editingSetup(1060);try {
  act(()=>s.hook.result.current());s.layout(900,1800,194000);
  s.hook.rerender({...s.props,shown:true,baseline:{}});
  expect(s.panel.scrollTop).toBe(193760);
  expect(window.getSelection()!.toString()).toBe('乙丙');
  expect(document.activeElement).toBe(s.editor);
 } finally{s.restoreRect();}
});

it('uses the pre-blur editor position when the comparison button takes focus, without refocusing it',()=>{
 const s=editingSetup();try {
  const button=document.createElement('button');button.className='comparison-toggle';document.body.append(button);
  act(()=>button.focus());window.getSelection()!.removeAllRanges();
  act(()=>s.hook.result.current());s.layout(820);s.hook.rerender({...s.props,shown:true,baseline:{}});
  expect(s.panel.scrollTop).toBe(2000);expect(document.activeElement).toBe(button);
 } finally{s.restoreRect();}
});

it.each(['wheel','pointerdown','keydown','compositionstart'])('does not restore an editor after the user acts during loading: %s',event=>{
 const s=editingSetup();try {
  act(()=>s.hook.result.current());s.hook.rerender({...s.props,shown:true,loading:true});vi.mocked(s.panel.scrollTo).mockClear();
  act(()=>s.editor.dispatchEvent(new Event(event,{bubbles:true})));s.layout(820);
  s.hook.rerender({...s.props,shown:true,baseline:{}});expect(s.panel.scrollTo).not.toHaveBeenCalled();
 } finally{s.restoreRect();}
});

it.each(['context','directory'] as const)('drops an editing anchor when %s changes',key=>{
 const s=editingSetup();try {
  act(()=>s.hook.result.current());s.layout(820);
  s.hook.rerender({...s.props,[key]:key==='context'?'other-version':{},shown:true,baseline:{}});
  expect(s.panel.scrollTo).not.toHaveBeenCalled();
 } finally{s.restoreRect();}
});

it('does not use an old editor selection after focus moves to another field',()=>{
 const s=editingSetup();try {
  const input=document.createElement('input');document.body.append(input);act(()=>input.focus());
  act(()=>s.hook.result.current());s.layout(820);s.hook.rerender({...s.props,shown:true,baseline:{}});
  expect(s.panel.scrollTop).not.toBe(2000);expect(document.activeElement).toBe(input);
 } finally{s.restoreRect();}
});
