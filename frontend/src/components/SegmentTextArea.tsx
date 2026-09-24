import { msg, useInterfaceLanguage } from '../i18n';
import { createPortal } from "react-dom";
import { comparisonParts, type ComparisonDecision } from "../lib/comparisonReview";
import { writeComparisonText } from "../lib/comparisonText";
import type { Segment } from "../types";
import { activeWordRange, type TextEdit } from "../lib/transcriptOps";
import { setPlaybackHighlight } from "../lib/playbackHighlight";
import { setManuscriptHighlights } from "../lib/manuscriptHighlight";
import { attachEditor } from "../lib/paragraphEditor";
import type { ParagraphEditorElement } from "../lib/paragraphEditor";
import { flushEditorDrafts, registerEditorDraft } from "../lib/editorDrafts";
import {
  type FocusEvent as ReactFocusEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { isHighlightShortcut } from "../lib/highlights";

// 片段文字编辑框：本地草稿，避免每次按键都触发全局状态重算。
//
// 浏览器管理段落 DOM；仅外部文本变化时重建，撤销仍由应用历史统一处理。
export function SegmentTextArea({
  comparisonBefore,
  comparisonBase = "",
  comparisonAccepted,
  onComparisonDecision,
  segmentId,
  highlights,
  playback,
  value,
  registry,
  ariaLabel,
  onFocus,
  onBlur,
  onClick,
  onKeyDown,
  onChange,
}: {
  comparisonBefore?: string;
  comparisonBase?: string;
  comparisonAccepted?: string[];
  onComparisonDecision?: (decision:ComparisonDecision)=>void;
  segmentId: string;
  highlights?: Segment["highlights"];
  playback?: { segment: Segment; time: number };
  value: string;
  registry: React.MutableRefObject<Map<string, ParagraphEditorElement>>;
  ariaLabel: string;
  onFocus: () => void;
  onBlur: (event: ReactFocusEvent<ParagraphEditorElement>) => void;
  onClick: (event: ReactMouseEvent<ParagraphEditorElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<ParagraphEditorElement>) => void;
  onChange: (next: string, edits?:TextEdit[]) => void;
}) {
  useInterfaceLanguage();
  const ref = useRef<ParagraphEditorElement | null>(null);
  const [activeChange, setActiveChange] = useState<{key:string; before:string; text:string; base:string; left:number; top:number}|null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const reviewRef = useRef({accepted:comparisonAccepted, interactive:Boolean(onComparisonDecision)});
  useLayoutEffect(() => {reviewRef.current = {accepted:comparisonAccepted, interactive:Boolean(onComparisonDecision)};}, [comparisonAccepted,onComparisonDecision]);
  const comparisonRef = useRef(comparisonBefore);
  const paintedComparison = useRef<{before:string|undefined; accepted:typeof comparisonAccepted; interactive:boolean} | undefined>(undefined);
  useLayoutEffect(() => { comparisonRef.current = comparisonBefore; }, [comparisonBefore]);
  const paint = () => {
    const editor=ref.current;if(!editor || composingRef.current)return;
    const focused=document.activeElement===editor, start=focused?editor.selectionStart:0,end=focused?editor.selectionEnd:0;
    writeComparisonText(editor,draftRef.current,comparisonRef.current,reviewRef.current.accepted,reviewRef.current.interactive);
    paintedComparison.current={before:comparisonRef.current,...reviewRef.current};
    if(focused)editor.setSelectionRange(start,end);
  };
  const commitTimerRef = useRef<number | null>(null);
  const composingRef = useRef(false);
  // 记录「最后一次提交给父级的值」，用于区分 value 变化来源：
  // 自己 commit 引起的 value 回写不覆盖防抖窗口内新输入的草稿，
  // 否则输入/删除的最后一个字会在回写时被旧值覆盖（看起来像被撤销）。
  const lastCommittedRef = useRef(value);
  const draftRef = useRef(value);
  const editsRef=useRef<TextEdit[]>([]);
  const compositionEditRef=useRef<Omit<TextEdit,"text">|null>(null);
  const selectionRef=useRef<{start:number;end:number}|null>(null);
  const captureSelection=()=>{const editor=ref.current;if(editor)selectionRef.current={start:editor.selectionStart,end:editor.selectionEnd};};
  const recordDraft=(text:string,selection=selectionRef.current)=>{
    const before=draftRef.current;
    if(text!==before)editsRef.current.push({before,text,start:selection?.start??-1,end:selection?.end??-1});
    draftRef.current=text;selectionRef.current=null;
  };

  const flushComposition=()=>{
    const pending=compositionEditRef.current;
    if(pending && pending.before!==draftRef.current){
      editsRef.current.push({...pending,text:draftRef.current});
      compositionEditRef.current={before:draftRef.current,start:pending.start,
        end:pending.start+draftRef.current.length-(pending.before.length-(pending.end-pending.start))};
    }
  };
  const startComposition = () => {
        setActiveChange(null);
        captureSelection();
        compositionEditRef.current={before:draftRef.current,start:selectionRef.current?.start??-1,end:selectionRef.current?.end??-1};
        composingRef.current = true;
        if (commitTimerRef.current) window.clearTimeout(commitTimerRef.current);
      };
  const endComposition = () => {
        composingRef.current = false;
        draftRef.current=ref.current?.value??"";flushComposition();compositionEditRef.current=null;selectionRef.current=null;
        scheduleCommit();
      };
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        const navigation = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key);
        if(!composingRef.current && !navigation)captureSelection();
        if(selectionRef.current && selectionRef.current.start===selectionRef.current.end){
          if(event.key==="Backspace" && selectionRef.current.start>0)selectionRef.current.start-=Array.from(draftRef.current.slice(0,selectionRef.current.start)).at(-1)!.length;
          else if(event.key==="Delete" && selectionRef.current.end<draftRef.current.length)selectionRef.current.end+=Array.from(draftRef.current.slice(selectionRef.current.end))[0].length;
        }
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Escape" && activeChange) {event.preventDefault();event.stopPropagation();setActiveChange(null);return;}
        if ((event.key === "Enter" || event.key === " ") && (event.target as HTMLElement).closest("[data-comparison-change]")) {
          event.preventDefault();event.stopPropagation();openChange(event.target as HTMLElement);return;
        }
        setActiveChange(null);
        const key = event.key;
        const isSplit = key === "Enter" && (event.ctrlKey || event.metaKey);
        const isJump = key === "ArrowUp" || key === "ArrowDown";
        // 高亮要按「提交后」的文本算范围，否则选区对的是草稿、写进去的却是对旧文本算的偏移。
        if (isSplit || isJump || isHighlightShortcut(event)) {
          // 在父级处理跳转/拆分/高亮前先提交最新草稿，避免读到旧状态。
          commit();
        }
        if (comparisonRef.current !== undefined && !event.metaKey && !event.ctrlKey && !event.altKey && (key === "Backspace" || key === "Delete")) {
          const editor=ref.current!;const text=editor.value;
          let start=editor.selectionStart,end=editor.selectionEnd;
          if(start===end){if(key==="Backspace" && start>0) start-=Array.from(text.slice(0,start)).at(-1)!.length;
            else if(key==="Delete" && end<text.length) end+=Array.from(text.slice(end))[0].length;}
          event.preventDefault();recordDraft(text.slice(0,start)+text.slice(end),{start,end});
          writeComparisonText(editor,draftRef.current,comparisonRef.current,reviewRef.current.accepted,reviewRef.current.interactive);editor.setSelectionRange(start,start);
          window.dispatchEvent(new Event("te:draft-dirty"));scheduleCommit();return;
        }
        onKeyDown(event as unknown as ReactKeyboardEvent<ParagraphEditorElement>);
        if (!event.defaultPrevented && event.key === "Enter") {
          event.preventDefault();
          document.execCommand("insertParagraph");
        }
        if ((event.metaKey || event.ctrlKey) && ["b", "i", "u"].includes(event.key.toLowerCase())) {
          event.preventDefault();
        }
      };
  const handleCut = (event: ReactClipboardEvent<HTMLDivElement>) => {
        captureSelection();
        if (comparisonRef.current === undefined) return;
        const editor=ref.current!,start=editor.selectionStart,end=editor.selectionEnd,text=editor.value;
        event.preventDefault();event.clipboardData.setData("text/plain",text.slice(start,end));
        recordDraft(text.slice(0,start)+text.slice(end),{start,end});paint();editor.setSelectionRange(start,start);
        window.dispatchEvent(new Event("te:draft-dirty"));scheduleCommit();
      };
  const handleInput = () => {
        setActiveChange(null);
        if(composingRef.current)draftRef.current=ref.current?.value??"";
        else recordDraft(ref.current?.value ?? "");
        window.dispatchEvent(new Event("te:draft-dirty"));
        if (!composingRef.current) scheduleCommit();
      };

  // 外部 value 变化时同步本地草稿（undo/redo/导入/拆分/合并/说话人改派等）。
  // 仅当 value 不是自己上一次提交的值时才同步——自己提交的回写要么与草稿一致、
  // 要么草稿已有更新的未提交内容，覆盖反而丢字。
  useEffect(() => {
    if (value !== lastCommittedRef.current) {
      lastCommittedRef.current = value;
      draftRef.current = value;editsRef.current=[];selectionRef.current=null;compositionEditRef.current=null;
      if (commitTimerRef.current) window.clearTimeout(commitTimerRef.current);
      if (ref.current) {
        const editor = ref.current;
        const focused = document.activeElement === editor;
        const start = focused ? editor.selectionStart : 0;
        const end = focused ? editor.selectionEnd : 0;
        writeComparisonText(editor, value, comparisonRef.current,reviewRef.current.accepted,reviewRef.current.interactive);
        if (focused) editor.setSelectionRange(start, end);
      }
    }
  }, [value]);

  const commit = useCallback(() => {
    if (commitTimerRef.current) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    flushComposition();
    if (draftRef.current !== lastCommittedRef.current) {
      lastCommittedRef.current = draftRef.current;
      const edits=editsRef.current;editsRef.current=[];
      onChange(draftRef.current,edits);
      if (comparisonRef.current !== undefined) paint();
    }
  }, [onChange]);

  useEffect(() => () => {
    if (commitTimerRef.current) window.clearTimeout(commitTimerRef.current);
  }, []);

  useEffect(() => {
    const flush = () => commit();
    window.addEventListener("te:flush-drafts", flush);
    return () => window.removeEventListener("te:flush-drafts", flush);
  }, [commit]);

  useEffect(() => registerEditorDraft(() => draftRef.current !== lastCommittedRef.current), []);

  const setRef = (element: HTMLDivElement | null) => {
    if (element) {
      const initialized = Object.hasOwn(element, "value");
      const editor = attachEditor(element);
      ref.current = editor;
      if (!initialized) {
        writeComparisonText(editor, draftRef.current, comparisonRef.current, reviewRef.current.accepted, reviewRef.current.interactive);
        paintedComparison.current={before:comparisonRef.current,...reviewRef.current};
      }
      registry.current.set(segmentId, editor);
    } else {
      ref.current = null;
      registry.current.delete(segmentId);
    }
  };

  useLayoutEffect(() => {
    const editor = ref.current;
    if (!editor) return;
    const range = playback
      ? activeWordRange({ ...playback.segment, text: editor.value }, playback.time)
      : null;
    setPlaybackHighlight(editor, range);
    return () => setPlaybackHighlight(editor, null);
  }, [playback]);

  useLayoutEffect(() => {
    const previous=paintedComparison.current;
    if (previous && previous.before===comparisonBefore && previous.accepted===comparisonAccepted &&
        previous.interactive===Boolean(onComparisonDecision)) return;
    paint();
  }, [comparisonBefore, comparisonAccepted, onComparisonDecision]);
  useLayoutEffect(() => {
    const editor = ref.current;
    if (!editor || !highlights?.length) return;
    const paintMarks = () => setManuscriptHighlights(editor, highlights);
    paintMarks();
    const observer = new MutationObserver(paintMarks);
    observer.observe(editor, {subtree:true, childList:true, characterData:true});
    return () => { observer.disconnect(); setManuscriptHighlights(editor, []); };
  }, [highlights, value]);
  useEffect(() => {
    if (!activeChange) return;
    const outside = (event:PointerEvent) => {if (!menuRef.current?.contains(event.target as Node)) setActiveChange(null);};
    const escape = (event:KeyboardEvent) => {if(event.key === "Escape")setActiveChange(null);};
    document.addEventListener("pointerdown",outside);document.addEventListener("keydown",escape);
    return () => {document.removeEventListener("pointerdown",outside);document.removeEventListener("keydown",escape);};
  }, [activeChange]);
  const openChange = (target:HTMLElement) => {
    const marked = target.closest<HTMLElement>("[data-comparison-change]");
    const key = marked?.dataset.comparisonChange;
    if (!marked || !key || comparisonBefore === undefined || !onComparisonDecision || composingRef.current) return;
    const rect = marked.getBoundingClientRect();
    flushEditorDrafts();
    const text = ref.current?.value ?? "";
    if (!comparisonParts(comparisonBefore,text).some(p=>p.changed && p.key===key)) return;
    setActiveChange({key,before:comparisonBefore,text,base:comparisonBase,
      left:Math.max(8,Math.min(rect.left,window.innerWidth-156)),top:Math.max(8,Math.min(rect.bottom+6,window.innerHeight-52))});
  };
  const decide = (choice:"accept"|"reject") => {
    if (!activeChange || composingRef.current || activeChange.base !== comparisonBase || activeChange.before !== comparisonBefore) return;
    flushEditorDrafts();
    if (ref.current?.value !== activeChange.text) {setActiveChange(null);return;}
    onComparisonDecision?.({...activeChange, segmentId, choice});
    setActiveChange(null);
    ref.current?.focus({preventScroll:true});
  };

  const scheduleCommit = () => {
    if (commitTimerRef.current) window.clearTimeout(commitTimerRef.current);
    commitTimerRef.current = window.setTimeout(() => commit(), 400);
  };

  return (
    <>
    <div
      ref={setRef}
      aria-label={ariaLabel}
      data-transcript-editor="true"
      data-segment-id={segmentId}
      className={`segment-text-editor${comparisonBefore !== undefined ? " comparison-text" : ""}`}
      role="textbox"
      aria-multiline="true"
      contentEditable
      suppressContentEditableWarning
      onCompositionStart={startComposition}
      onCompositionEnd={endComposition}
      onFocus={onFocus}
      onBlur={(event) => {
        commit();
        onBlur(event as unknown as ReactFocusEvent<ParagraphEditorElement>);
      }}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("[data-comparison-change]")) {event.stopPropagation();openChange(event.target as HTMLElement);}
        else {setActiveChange(null);onClick(event as unknown as ReactMouseEvent<ParagraphEditorElement>);}
      }}
      onKeyDown={handleKeyDown}
      onCopy={(event) => {
        if (comparisonRef.current === undefined) return;
        const editor=ref.current!;event.preventDefault();
        event.clipboardData.setData("text/plain",editor.value.slice(editor.selectionStart,editor.selectionEnd));
      }}
      onCut={handleCut}
      onPaste={(event) => {
        captureSelection();
        event.preventDefault();
        document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
      }}
      onDrop={(event) => event.preventDefault()}
      onInput={handleInput}
    />
    {activeChange && activeChange.base === comparisonBase && activeChange.before === comparisonBefore && activeChange.text === value && createPortal(
      <div ref={menuRef} data-comparison-menu="true" className="comparison-change-menu" role="group" aria-label={msg('SegmentTextArea.m0969')}
        style={{left:activeChange.left,top:activeChange.top}} onMouseDown={event=>event.preventDefault()} onClick={event=>event.stopPropagation()}>
        <button type="button" onClick={()=>decide("accept")}>{msg('SegmentTextArea.m0970')}</button>
        <button type="button" onClick={()=>decide("reject")}>{msg('SegmentTextArea.m0971')}</button>
      </div>, document.body)}
    </>
  );
}
