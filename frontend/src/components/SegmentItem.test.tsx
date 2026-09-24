// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { SegmentItem, type SegmentItemProps } from "./SegmentItem";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("shows exactly one arrow on the emphasized segment, moving on click and editor focus", () => {
  const noop = () => {};
  const shared: Omit<SegmentItemProps, "segment" | "index" | "effectiveSelectedSegmentId"> = {
    totalSegments: 2, speakers: [{id: "s", name: "测试"}], isPlaying: false, currentTime: 0,
    findQuery: "", audioUrl: "", viewingOriginal: false, audioRef: {current: null},
    textareaRefs: {current: new Map()}, editingRef: {current: false}, setSelectedSegmentId: noop,
    seekTo: noop, recordEditorCursor: noop, addSpeaker: noop, updateSegment: noop,
    removeSegment: noop, splitSegment: noop, mergeWithNext: noop, handleEditorKeydown: noop,
  };
  function Harness() {
    const [selected, setSelected] = useState("a");
    return <>{["a", "b"].map((id, index) => <SegmentItem {...shared} key={id}
      index={index} segment={{id, text: id, speaker_id: "s", start: index * 10, end: (index + 1) * 10}}
      effectiveSelectedSegmentId={selected} setSelectedSegmentId={setSelected}/>)}</>;
  }
  const ui = render(<Harness/>);
  const expectCurrent = (id: string) => {
    expect(ui.container.querySelectorAll(".segment-link-arrow")).toHaveLength(1);
    expect(ui.container.querySelector(".segment-link-arrow")?.parentElement?.id).toBe(`segment-${id}`);
    expect(ui.container.querySelectorAll(".segment--selected")).toHaveLength(1);
    expect(ui.container.querySelector(".segment--selected")?.id).toBe(`segment-${id}`);
  };
  expectCurrent("a");
  fireEvent.click(ui.container.querySelector("#segment-b")!);
  expectCurrent("b");
  fireEvent.focus(ui.getByLabelText("00:00–00:10 的文字"));
  expectCurrent("a");
});

it("seeks to the clicked character while playing, without a focus-time jump to segment start", () => {
  const calls: [number, boolean | undefined][] = [];
  const noop = () => {};
  const props: SegmentItemProps = {
    segment: {id: "b", speaker_id: "s", text: "甲乙丙丁", start: 10, end: 20},
    index: 1, totalSegments: 2, speakers: [{id: "s", name: "测试"}],
    effectiveSelectedSegmentId: "a", isPlaying: true, currentTime: 1,
    findQuery: "", audioUrl: "test.wav", viewingOriginal: false,
    audioRef: {current: null}, textareaRefs: {current: new Map()}, editingRef: {current: false},
    setSelectedSegmentId: noop, seekTo: (time, playing) => calls.push([time, playing]),
    recordEditorCursor: noop, addSpeaker: noop, updateSegment: noop, removeSegment: noop,
    splitSegment: noop, mergeWithNext: noop, handleEditorKeydown: noop,
  };
  const ui = render(<SegmentItem {...props}/>);
  const editor = props.textareaRefs.current.get("b")!;
  fireEvent.focus(editor);
  expect(calls).toEqual([]);
  editor.setSelectionRange(2, 2);
  fireEvent.click(editor);
  expect(calls).toEqual([[15, true]]);
  editor.setSelectionRange(0, 2);
  fireEvent.click(editor);
  expect(calls).toHaveLength(1);

  // 原稿只读层与正在播放的文字层共用点击处理：段落 DOM 偏移同样映射到时间。
  ui.rerender(<SegmentItem {...props} viewingOriginal/>);
  const text = ui.container.querySelector(".rt-para")!.firstChild!;
  const range = document.createRange();
  range.setStart(text, 3); range.collapse(true);
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
  fireEvent.click(ui.getByLabelText("00:10–00:20 的文字"));
  expect(calls.at(-1)).toEqual([17.5, true]);

  // 在按下和 click 之间替换文字层，仍然使用按下时的位置而非新 DOM 中的光标。
  const downRange = document.createRange();
  downRange.setStart(text, 1); downRange.collapse(true);
  Object.defineProperty(document, "caretRangeFromPoint", {configurable: true, value: vi.fn(() => downRange)});
  fireEvent.pointerDown(ui.getByLabelText("00:10–00:20 的文字"), {button: 0, clientX: 12, clientY: 20});
  ui.rerender(<SegmentItem {...props}/>);
  const replacement = props.textareaRefs.current.get("b")!;
  replacement.setSelectionRange(3, 3);
  fireEvent.click(replacement, {clientX: 12, clientY: 20});
  expect(calls.at(-1)).toEqual([12.5, true]);
  delete (document as unknown as {caretRangeFromPoint?: unknown}).caretRangeFromPoint;

});


it("keeps readonly playback visible across find markup and clears it on pause or unmount", () => {
  const highlights = new Map<string, {ranges: Range[]}>();
  vi.stubGlobal("CSS", {highlights});
  vi.stubGlobal("Highlight", class {ranges: Range[]; constructor(...ranges: Range[]) {this.ranges=ranges;} });
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const noop = () => {};
  const props: SegmentItemProps = {
    segment:{id:"readonly",speaker_id:"s",text:"甲乙\n丙丁",start:0,end:4,words:[{text:"甲乙",start:0,end:2},{text:"\n丙丁",start:2,end:4}]},
    index:0,totalSegments:1,speakers:[{id:"s",name:"说话人"}],effectiveSelectedSegmentId:"readonly",
    isPlaying:true,currentTime:1,findQuery:"乙",audioUrl:"test.wav",viewingOriginal:true,
    audioRef:{current:null},textareaRefs:{current:new Map()},editingRef:{current:false},
    setSelectedSegmentId:noop,seekTo:noop,recordEditorCursor:noop,addSpeaker:noop,updateSegment:noop,
    removeSegment:noop,splitSegment:noop,mergeWithNext:noop,handleEditorKeydown:noop,
  };
  const ui=render(<SegmentItem {...props}/>);
  const root=ui.container.querySelector(".segment-text-readonly")!;
  const before=root.innerHTML;
  expect(highlights.get("transcript-playback")?.ranges.map(r=>r.toString()).join("")).toBe("甲乙");
  expect(root.querySelector(".find-highlight")?.textContent).toBe("乙");
  expect(root.hasAttribute("contenteditable")).toBe(false);
  const selection=window.getSelection()!;
  const range=document.createRange();range.selectNodeContents(root.querySelector(".find-highlight")!);
  selection.removeAllRanges();selection.addRange(range);
  ui.rerender(<SegmentItem {...props} currentTime={1.5}/>);
  expect(selection.toString()).toBe("乙");expect(root.innerHTML).toBe(before);
  ui.rerender(<SegmentItem {...props} isPlaying={false}/>);
  expect(highlights.has("transcript-playback")).toBe(false);
  ui.rerender(<SegmentItem {...props} findQuery="丙" currentTime={3}/>);
  expect(highlights.get("transcript-playback")?.ranges.map(r=>r.toString()).join("")).toContain("丙丁");
  ui.unmount();expect(highlights.has("transcript-playback")).toBe(false);
});
