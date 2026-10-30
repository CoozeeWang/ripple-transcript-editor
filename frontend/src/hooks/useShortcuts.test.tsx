// @vitest-environment jsdom
import { cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useShortcuts, type UseShortcutsDeps } from "./useShortcuts";

const platform = vi.hoisted(() => ({mac: true}));
vi.mock("../lib/format", () => ({get IS_MAC() {return platform.mac;}}));
afterEach(() => {cleanup(); document.body.replaceChildren(); vi.restoreAllMocks();});
function setup(mac = true, viewingOriginal = false, disabled = false) {
  platform.mac = mac;
  const removeSegment = vi.fn();
  const noop = () => {};
  const deps: UseShortcutsDeps = {
    disabled,
    transcript: {audio: {filename: "test.wav", duration: 2}, speakers: [], segments: [
      {id: "a", speaker_id: "s", start: 0, end: 1, text: "甲"},
      {id: "b", speaker_id: "s", start: 1, end: 2, text: "乙"},
    ]}, viewingOriginal, removeSegment, findOpen: false, effectiveSelectedSegmentId: "a",
    audioUrl: "", skipSeconds: 3, audioRef: {current: null}, performUndo: vi.fn(),
    performRedo: vi.fn(), setFindOpen: vi.fn(), setShowReplace: noop, setExportMenuOpen: vi.fn(),
    togglePlayFromCursor: vi.fn(), handleOpenFolder: vi.fn(), togglePlayback: vi.fn(), seekTo: noop,
    mergeWithNext: noop, setSelectedSegmentId: noop,
  };
  renderHook(() => useShortcuts(deps));
  return {deps, removeSegment, combo: {key: "Backspace", shiftKey: true, metaKey: mac, ctrlKey: !mac}};
}
describe("delete segment shortcut", () => {
  it.each([true, false])("uses the platform modifier and flushes drafts before deleting (mac=%s)", mac => {
    const {removeSegment, combo} = setup(mac);
    const calls: string[] = [];
    const flush = () => calls.push("flush");
    window.addEventListener("te:flush-drafts", flush);
    removeSegment.mockImplementation(() => calls.push("delete"));
    const confirm = vi.spyOn(window, "confirm");
    fireEvent.keyDown(window, combo);
    expect(removeSegment).toHaveBeenCalledWith("a");
    expect(calls).toEqual(["flush", "delete"]);
    expect(confirm).not.toHaveBeenCalled();
    window.removeEventListener("te:flush-drafts", flush);
    fireEvent.keyDown(window, {...combo, metaKey: !mac, ctrlKey: mac});
    fireEvent.keyDown(window, {...combo, shiftKey: false});
    fireEvent.keyDown(window, {...combo, repeat: true});
    expect(removeSegment).toHaveBeenCalledTimes(1);
  });
  it("deletes the focused editor's segment and not a stale selected segment", () => {
    const {removeSegment, combo} = setup();
    const editor = document.createElement("div");
    editor.dataset.transcriptEditor = "true"; editor.dataset.segmentId = "b";
    const child = editor.appendChild(document.createElement("span"));
    document.body.append(editor);
    fireEvent.keyDown(child, combo);
    expect(removeSegment).toHaveBeenCalledExactlyOnceWith("b");
  });
  it("does not delete from other fields, dialogs, IME composition or original view", () => {
    const {removeSegment, combo} = setup();
    for (const tag of ["input", "textarea", "select"]) {
      const el = document.createElement(tag); document.body.append(el);
      fireEvent.keyDown(el, combo);
    }
    const dialog = document.createElement("div"); dialog.setAttribute("role", "dialog");
    const button = dialog.appendChild(document.createElement("button")); document.body.append(dialog);
    fireEvent.keyDown(button, combo);
    fireEvent.keyDown(window, {...combo, isComposing: true});
    expect(removeSegment).not.toHaveBeenCalled();
    cleanup();
    const original = setup(true, true);
    fireEvent.keyDown(window, original.combo);
    expect(original.removeSegment).not.toHaveBeenCalled();
  });
});

it("does not delete the source document while formal AI review is active",()=>{const {removeSegment,combo}=setup(true,false,true);fireEvent.keyDown(window,combo);expect(removeSegment).not.toHaveBeenCalled();});

it("isolates editor shortcuts while a dialog is open and restores them after closing", () => {
  const {deps} = setup();
  const dialog = document.createElement("dialog");
  dialog.setAttribute("open", ""); document.body.append(dialog);
  const button = dialog.appendChild(document.createElement("button"));
  for (const target of [button, window]) {
    for (const key of ["z", "f", "e", "0", "o"]) fireEvent.keyDown(target, {key, metaKey: true});
    fireEvent.keyDown(target, {key: " ", code: "Space"});
  }
  for (const callback of [deps.performUndo, deps.setFindOpen, deps.setExportMenuOpen, deps.togglePlayFromCursor, deps.handleOpenFolder, deps.togglePlayback]) expect(callback).not.toHaveBeenCalled();
  dialog.remove();
  fireEvent.keyDown(window, {key: "z", metaKey: true});
  expect(deps.performUndo).toHaveBeenCalledOnce();
});

describe('whole segment copy shortcut', () => {
 it.each([true,false])('copies only the intended editor or selected segment (mac=%s)', mac => {
  const {deps} = setup(mac);
  const copy = vi.fn(); deps.copySegment = copy;
  const combo = {code:'KeyC',key:'C',shiftKey:true,metaKey:mac,ctrlKey:!mac};
  fireEvent.keyDown(window,combo);
  expect(copy).toHaveBeenLastCalledWith('a');
  const editor=document.createElement('div'); editor.dataset.transcriptEditor='true'; editor.dataset.segmentId='b'; editor.contentEditable='true'; document.body.append(editor);
  fireEvent.keyDown(editor,combo); expect(copy).toHaveBeenLastCalledWith('b');
  const input=document.createElement('input');document.body.append(input);
  for(const options of [{...combo,shiftKey:false},{...combo,isComposing:true},{...combo,repeat:true}]) fireEvent.keyDown(window,options);
  fireEvent.keyDown(input,combo);
  expect(copy).toHaveBeenCalledTimes(2);
 });
});

describe('desktop add-tag command',()=>{
 it.each([true,false])('opens the active segment once per command with platform modifier mac=%s',mac=>{const {deps}=setup(mac);deps.nativeTagShortcut=true;deps.addTag=vi.fn();const calls:string[]=[];const flush=()=>calls.push('flush');window.addEventListener('te:flush-drafts',flush);vi.mocked(deps.addTag).mockImplementation(()=>calls.push('open'));const combo={key:'t',code:'KeyT',metaKey:mac,ctrlKey:!mac};expect(fireEvent.keyDown(window,combo)).toBe(false);expect(deps.addTag).toHaveBeenCalledWith('a');expect(calls).toEqual(['flush','open']);fireEvent.keyDown(window,{...combo,repeat:true});expect(deps.addTag).toHaveBeenCalledTimes(2);fireEvent.keyDown(window,{...combo,metaKey:!mac,ctrlKey:mac});fireEvent.keyDown(window,{...combo,shiftKey:true});expect(deps.addTag).toHaveBeenCalledTimes(2);window.removeEventListener('te:flush-drafts',flush)});
 it('leaves browser new-tab default intact and rejects readonly, hidden, empty, modal and composing contexts',()=>{const {deps}=setup();deps.addTag=vi.fn();const combo={key:'t',code:'KeyT',metaKey:true};expect(fireEvent.keyDown(window,combo)).toBe(true);deps.nativeTagShortcut=true;deps.tagWriteDisabled=true;expect(fireEvent.keyDown(window,combo)).toBe(true);deps.tagWriteDisabled=false;deps.visibleSegmentIds=new Set(['b']);expect(fireEvent.keyDown(window,combo)).toBe(true);deps.visibleSegmentIds=undefined;const segments=deps.transcript!.segments;deps.transcript!.segments=[];expect(fireEvent.keyDown(window,combo)).toBe(true);deps.transcript!.segments=segments;expect(fireEvent.keyDown(window,{...combo,isComposing:true})).toBe(true);const dialog=document.createElement('dialog');dialog.open=true;document.body.append(dialog);expect(fireEvent.keyDown(window,combo)).toBe(true);dialog.remove();expect(deps.addTag).not.toHaveBeenCalled()});
 it('uses the focused body editor, refocuses tag entry and ignores other fields',()=>{const {deps}=setup();deps.nativeTagShortcut=true;deps.addTag=vi.fn();const combo={key:'t',code:'KeyT',metaKey:true};const editor=document.createElement('div');editor.dataset.transcriptEditor='true';editor.dataset.segmentId='b';document.body.append(editor);fireEvent.keyDown(editor,combo);expect(deps.addTag).toHaveBeenLastCalledWith('b');const segment=document.createElement('article');segment.className='segment';segment.id='segment-b';segment.innerHTML='<span class="tag-entry"><input /></span>';document.body.append(segment);fireEvent.keyDown(segment.querySelector('input')!,combo);expect(deps.addTag).toHaveBeenLastCalledWith('b');for(const name of ['input','textarea','select']){const field=document.createElement(name);document.body.append(field);expect(fireEvent.keyDown(field,combo)).toBe(true)}expect(deps.addTag).toHaveBeenCalledTimes(2)});
});
