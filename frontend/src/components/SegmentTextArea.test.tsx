// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SegmentTextArea } from "./SegmentTextArea";
import { writeEditorText, type ParagraphEditorElement } from "../lib/paragraphEditor";
import { flushEditorDrafts } from "../lib/editorDrafts";

afterEach(() => { cleanup(); vi.useRealTimers(); });
function setup() {
  vi.useFakeTimers();
  const registry = {current: new Map<string, ParagraphEditorElement>()};
  const onChange = vi.fn();
  const onKeyDown = vi.fn();
  const props = {segmentId: "s", value: "甲\n乙", registry, ariaLabel: "正文", onFocus: () => {}, onBlur: () => {}, onClick: () => {}, onKeyDown, onChange};
  const ui = render(<SegmentTextArea {...props}/>);
  const editor = registry.current.get("s")!;
  return {props, ui, editor, onChange, onKeyDown};
}
describe("paragraph draft editing", () => {
  it("leaves horizontal caret navigation to the browser without walking text offsets", () => {
    const {editor} = setup();
    const start = vi.spyOn(editor, "selectionStart", "get");
    const end = vi.spyOn(editor, "selectionEnd", "get");
    fireEvent.keyDown(editor, {key:"ArrowRight"});
    fireEvent.keyDown(editor, {key:"ArrowLeft"});
    expect(start).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
    start.mockRestore(); end.mockRestore();
  });
  it("writes each editor only once at startup and skips selection reads for unfocused editors", () => {
    const writes = vi.spyOn(Element.prototype, "replaceChildren");
    const {props, ui, editor} = setup();
    expect(writes.mock.instances.filter(node => node === editor)).toHaveLength(1);
    const selection = vi.spyOn(editor, "selectionStart", "get");
    ui.rerender(<SegmentTextArea {...props} value="甲乙丙"/>);
    expect(selection).not.toHaveBeenCalled();
    expect(editor.value).toBe("甲乙丙");
    ui.rerender(<SegmentTextArea {...props} value="甲乙丙" comparisonBefore="甲旧丙"/>);
    expect(editor.querySelector("del")?.textContent).toBe("旧");
    selection.mockRestore(); writes.mockRestore();
  });
  it("does not rebuild paragraph DOM when its own committed value returns", () => {
    const {props, ui, editor, onChange} = setup();
    writeEditorText(editor, "甲\n乙丙");
    const paragraph = editor.lastChild;
    editor.focus(); editor.setSelectionRange(4, 4);
    fireEvent.input(editor);
    act(() => vi.advanceTimersByTime(500));
    expect(onChange).toHaveBeenCalledWith("甲\n乙丙",expect.any(Array));
    ui.rerender(<SegmentTextArea {...props} value={"甲\n乙丙"}/>);
    expect(editor.lastChild).toBe(paragraph);
    expect(editor.selectionStart).toBe(4);
  });
  it("keeps IME composition in the DOM until composition ends", () => {
    const {editor, onChange} = setup();
    fireEvent.compositionStart(editor);
    writeEditorText(editor, "甲\n输入中"); fireEvent.input(editor);
    act(() => vi.advanceTimersByTime(1000));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.compositionEnd(editor);
    act(() => vi.advanceTimersByTime(500));
    expect(onChange).toHaveBeenLastCalledWith("甲\n输入中",expect.any(Array));
  });
  it("flushes paragraph text immediately before save", () => {
    const {editor, onChange} = setup();
    writeEditorText(editor, "甲\n乙\n新段落"); fireEvent.input(editor);
    act(() => flushEditorDrafts());
    expect(onChange).toHaveBeenLastCalledWith("甲\n乙\n新段落",expect.any(Array));
  });
  it("restores external undo/redo text without moving the caret out of the editor", () => {
    const {props, ui, editor} = setup();
    editor.focus(); editor.setSelectionRange(2, 3);
    ui.rerender(<SegmentTextArea {...props} value={"甲\n乙丙"}/>);
    expect(editor.value).toBe("甲\n乙丙");
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([2, 3]);
    expect(document.activeElement).toBe(editor);
  });
  it("submits the latest paragraph draft before the split shortcut handler", () => {
    const {editor, onChange, onKeyDown} = setup();
    writeEditorText(editor, "甲\n乙丙"); fireEvent.input(editor);
    editor.focus(); editor.setSelectionRange(2, 2);
    onKeyDown.mockImplementation(event => {
      event.preventDefault();
      expect(onChange).toHaveBeenCalledWith("甲\n乙丙",expect.any(Array));
      expect(event.currentTarget.selectionStart).toBe(2);
    });
    fireEvent.keyDown(editor, {key: "Enter", ctrlKey: true});
    expect(onKeyDown).toHaveBeenCalled();
  });
});

it("playback highlighting never replaces the editable DOM or moves the typing caret", () => {
  const {props, ui, editor, onChange} = setup();
  const segment = {id: "s", speaker_id: "p", text: "甲\n乙", start: 0, end: 10};
  editor.focus(); editor.setSelectionRange(2, 2);
  const paragraph = editor.lastChild;
  ui.rerender(<SegmentTextArea {...props} playback={{segment, time: 3}}/>);
  expect(ui.getByRole("textbox")).toBe(editor);
  expect(editor.lastChild).toBe(paragraph);
  expect(editor.selectionStart).toBe(2);
  writeEditorText(editor, "甲\nabcd"); editor.setSelectionRange(6, 6);
  fireEvent.input(editor);
  ui.rerender(<SegmentTextArea {...props} playback={{segment, time: 6}}/>);
  expect(editor.value).toBe("甲\nabcd");
  expect(editor.selectionStart).toBe(6);
  act(() => vi.advanceTimersByTime(500));
  expect(onChange).toHaveBeenCalledWith("甲\nabcd",expect.any(Array));
  ui.rerender(<SegmentTextArea {...props} value={"甲\nabcd"}/>);
  expect(ui.getByRole("textbox")).toBe(editor);
});

it("shows inline differences without saving deleted text and toggles without altering the draft",()=>{
 const {props,ui,editor,onChange}=setup();
 ui.rerender(<SegmentTextArea {...props} comparisonBefore={"甲旧\n乙"}/>);
 expect(editor.querySelector("del")?.textContent).toBe("旧");expect(editor.value).toBe("甲\n乙");
 editor.focus();editor.setSelectionRange(2,2);fireEvent.keyDown(editor,{key:"Backspace"});
 act(()=>vi.advanceTimersByTime(500));expect(onChange).toHaveBeenLastCalledWith("甲乙",expect.any(Array));expect(editor.value).toBe("甲乙");
 ui.rerender(<SegmentTextArea {...props} value="甲乙" comparisonBefore={undefined}/>);
 expect(editor.querySelector("del")).toBeNull();expect(editor.value).toBe("甲乙");
 ui.rerender(<SegmentTextArea {...props} value="甲乙" comparisonBefore={"甲旧\n乙"}/>);
 expect(editor.value).toBe("甲乙");expect(editor.querySelector("del")).not.toBeNull();
});
it("keeps cursor offsets anchored to current text around readonly deletions",()=>{
 const {props,ui,editor}=setup();ui.rerender(<SegmentTextArea {...props} value="甲丙丁" comparisonBefore="甲乙丁"/>);
 editor.focus();editor.setSelectionRange(1,2);expect(editor.selectionStart).toBe(1);expect(editor.selectionEnd).toBe(2);
 fireEvent.keyDown(editor,{key:"Delete"});expect(editor.value).toBe("甲丁");
 act(()=>vi.advanceTimersByTime(500));
 ui.rerender(<SegmentTextArea {...props} value="甲丁" comparisonBefore="甲乙丁"/>);
 ui.rerender(<SegmentTextArea {...props} value="甲丙丁" comparisonBefore="甲乙丁"/>);
 expect(editor.value).toBe("甲丙丁");
});
it("passes exact deletion positions through a debounced draft with repeated text",()=>{
 const {props,ui,editor,onChange}=setup();
 ui.rerender(<SegmentTextArea {...props} value="甲乙甲乙" comparisonBefore="甲乙甲乙"/>);
 editor.focus();editor.setSelectionRange(0,2);fireEvent.keyDown(editor,{key:"Backspace"});
 editor.setSelectionRange(1,2);fireEvent.keyDown(editor,{key:"Backspace"});
 act(()=>vi.advanceTimersByTime(500));
 expect(onChange).toHaveBeenLastCalledWith("甲",[
  {before:"甲乙甲乙",text:"甲乙",start:0,end:2},
  {before:"甲乙",text:"甲",start:1,end:2},
 ]);
});
it("keeps the original selection across IME candidates and flushes the latest composition text",()=>{
 const {props,ui,editor,onChange}=setup();
 ui.rerender(<SegmentTextArea {...props} value="甲乙甲乙"/>);
 editor.focus();editor.setSelectionRange(0,2);fireEvent.compositionStart(editor);
 writeEditorText(editor,"北京甲乙");fireEvent.input(editor);
 act(()=>flushEditorDrafts());
 expect(onChange).toHaveBeenLastCalledWith("北京甲乙",[{before:"甲乙甲乙",text:"北京甲乙",start:0,end:2}]);
 fireEvent.compositionEnd(editor);
 act(()=>vi.advanceTimersByTime(500));
 expect(onChange).toHaveBeenCalledTimes(1);
});
