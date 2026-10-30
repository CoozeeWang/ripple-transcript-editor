import {TagInput} from './TagInput';
import {TagPill} from './TagPill';
import {TagAddButton} from './TagAddButton';
import type {ProjectTag} from '../lib/tags';
import { useSegmentDrag } from "../hooks/useSegmentDrag";
import { isEditorComposing } from "../lib/editorDrafts";
import { msg, useInterfaceLanguage } from '../i18n';
import type { TextEdit } from "../lib/transcriptOps";
import type { ComparisonDecision } from "../lib/comparisonReview";
import { revisionFor } from "../lib/revisions";
import { speakerColorStyle, SPEAKER_PALETTE } from "../lib/speakers";
import { flushEditorDrafts } from "../lib/editorDrafts";
import type { ParagraphEditorElement } from "../lib/paragraphEditor";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { nativeDesktopAvailable } from '../lib/desktopFs';
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import type { Segment, Speaker } from "../types";
import { setPlaybackHighlight } from "../lib/playbackHighlight";
import { activeWordRange, reanchorCharacters, timeForCharacter } from "../lib/transcriptOps";
import { editorSnapshot } from "../lib/paragraphEditor";
import { formatTime, IS_MAC, keys } from "../lib/format";
import { highlightFindOccurrences } from "../lib/highlight";
import { SegmentTextArea } from "./SegmentTextArea";

/** 单段渲染：说话人下拉 + 文字编辑（草稿/播放高亮/只读三态）+ 时间戳 + 操作图标。
 *  所有跨领域状态与操作通过 props 注入。 */
export interface SegmentItemProps {
  tagDropTarget?:boolean;
  tagPaths?: Record<string,string>;
  onAddTagId?: (segmentId:string,tagId:string)=>Promise<void>;
  tags?: ProjectTag[];
  availableTags?: ProjectTag[];
  tagRenameEnabled?: boolean;
  onRenameTag?: (id: string, name: string) => Promise<void>;
  registerTagEntry?: (id: string, open: (() => void) | null) => void;
  tagWriteDisabled?:boolean;
  onAddTag?: (segmentId:string,name:string)=>Promise<void>;
  onRemoveTag?: (segmentId:string,id:string)=>void;
  nativeDragSegment?: (id: string) => Promise<void>;
  copySegment?: (id: string) => void;
  dragSegment?: (id: string, transfer: DataTransfer) => void;
  timeAligned?: boolean;
  comparisonBefore?: string;
  comparisonBase?: string;
  comparisonAccepted?: string[];
  onComparisonDecision?: (decision:ComparisonDecision)=>void;
  segment: Segment;
  index: number;
  totalSegments: number;
  speakers: Speaker[];
  effectiveSelectedSegmentId: string;
  isPlaying: boolean;
  currentTime: number;
  findQuery: string;
  audioUrl: string;
  viewingOriginal: boolean;
  audioRef: { current: HTMLAudioElement | null };
  textareaRefs: { current: Map<string, ParagraphEditorElement> };
  editingRef: { current: boolean };
  setSelectedSegmentId: (id: string) => void;
  seekTo: (time: number, playing?: boolean) => void;
  recordEditorCursor: (segmentId: string, charIndex: number, explicit?: boolean) => void;
  addSpeaker: (assignSegmentId?: string) => void;
  updateSegment: (segmentId: string, changes: Partial<Segment>, groupKey?: string, edits?: TextEdit[]) => void;
  removeSegment: (segmentId: string) => void;
  splitSegment: (segmentId: string, cursorPosition: number, currentText?: string) => void;
  mergeWithNext: (segmentId: string) => void;
  handleEditorKeydown: (
    event: ReactKeyboardEvent<ParagraphEditorElement>,
    segmentId: string,
  ) => void;
}

export const SegmentItem = memo(function SegmentItem(props: SegmentItemProps) {
  useInterfaceLanguage();
  const [tagInput,setTagInput]=useState(false);
  const {
    segment,
    index,
    totalSegments,
    speakers,
    effectiveSelectedSegmentId,
    isPlaying,
    currentTime,
    findQuery,
    audioUrl,
    viewingOriginal,
    audioRef,
    textareaRefs,
    editingRef,
    setSelectedSegmentId,
    seekTo,
    recordEditorCursor,
    addSpeaker,
    updateSegment,
    removeSegment,
    splitSegment,
    mergeWithNext,
    handleEditorKeydown,
  } = props;

  const tagFooter = useRef<HTMLDivElement>(null), closingTag = useRef(false), restoreTag = useRef(false);
  const tagOpener = useRef<{ element: HTMLElement | null; editor?: ParagraphEditorElement; start: number; end: number } | null>(null);
  const openTagEntry = useCallback(() => {
    if (viewingOriginal || props.tagWriteDisabled || !props.onAddTag) return;
    const existing = tagFooter.current?.querySelector<HTMLInputElement>('.tag-entry input');
    if (existing) { existing.focus({ preventScroll: true }); return; }
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const editor = textareaRefs.current.get(segment.id), fromEditor = editor && (active === editor || (active && editor.contains(active)));
    tagOpener.current = { element: active, editor: fromEditor ? editor : undefined, start: fromEditor ? editor.selectionStart : 0, end: fromEditor ? editor.selectionEnd : 0 };
    if (fromEditor) recordEditorCursor(segment.id, editor.selectionStart);
    flushEditorDrafts(); setSelectedSegmentId(segment.id); closingTag.current = false; setTagInput(true);
  }, [viewingOriginal, props.tagWriteDisabled, props.onAddTag, textareaRefs, segment.id, recordEditorCursor, setSelectedSegmentId]);
  const registerTagEntry = props.registerTagEntry;
  useLayoutEffect(() => { registerTagEntry?.(segment.id, openTagEntry); return () => registerTagEntry?.(segment.id, null); }, [registerTagEntry, segment.id, openTagEntry]);
  useLayoutEffect(() => {
    if (tagInput || !restoreTag.current) return;
    restoreTag.current = false;
    const previous = tagOpener.current;
    if (previous?.element?.isConnected) {
      previous.element.focus({ preventScroll: true }); previous.editor?.setSelectionRange(previous.start, previous.end);
    } else tagFooter.current?.querySelector<HTMLButtonElement>('[data-add-tag]')?.focus({ preventScroll: true });
  }, [tagInput]);
  const closeTagEntry = (restore: boolean) => { if (closingTag.current) return; closingTag.current = true; restoreTag.current = restore; setTagInput(false); };

  const transferElement = useRef<HTMLElement>(null);
  const {ready: transferReady, start: startTransfer, end: endTransfer} = useSegmentDrag(!!(props.dragSegment || props.nativeDragSegment), transferElement);
  const isSelected = segment.id === effectiveSelectedSegmentId;
  // 用低频的 prop currentTime（onTimeUpdate）判断「是否正在播放的段」；
  // 高亮位置则用段内 rAF 高频跟踪 audio.currentTime，词级跟随才连贯。
  const inWindow = isPlaying && currentTime >= segment.start && currentTime < segment.end;
  const [liveTime, setLiveTime] = useState<number | null>(null);
  const [wasInWindow, setWasInWindow] = useState(inWindow);
  if (wasInWindow !== inWindow) {
    setWasInWindow(inWindow);
    setLiveTime(null);
  }
  useEffect(() => {
    if (!inWindow) return;
    let raf = 0;
    const loop = () => {
      const t = audioRef.current?.currentTime;
      if (typeof t === "number") setLiveTime(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [inWindow, segment.start, segment.end, audioRef]);
  const isPlayingSegment = inWindow;
  const readonlyRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = readonlyRef.current;
    if (!viewingOriginal || !root) return;
    setPlaybackHighlight(root, inWindow ? activeWordRange(segment, liveTime ?? currentTime) : null);
    return () => setPlaybackHighlight(root, null);
  }, [viewingOriginal, inWindow, segment, liveTime, currentTime, findQuery, props.comparisonBefore]);

  const timeRange = props.timeAligned === false ? msg('SegmentItem.m0943', { v0: index + 1 }) : `${formatTime(segment.start)}–${formatTime(segment.end)}`;
  const speakerEntry = speakers.find((speaker) => speaker.id === segment.speaker_id);
  const speakerColorIndex =
    (speakerEntry?.colorIndex ??
      Math.max(0, speakers.findIndex((speaker) => speaker.id === segment.speaker_id))) % SPEAKER_PALETTE.length;

  // 按下鼠标时锁定文字位置。播放跨段可能在 mouseup/click 前替换内部文字层。
  const pointerTextRef = useRef<{ index: number; text: string; x: number; y: number } | null>(null);
  const captureTextPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    pointerTextRef.current = null;
    if (transferReady) return;
    if (event.button !== 0) return;
    const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
    if (!range || !event.currentTarget.contains(range.startContainer)) return;
    const root = event.currentTarget.firstElementChild as HTMLElement | null;
    if (!root) return;
    const snapshot = editorSnapshot(root);
    const index = snapshot.offsets.get(range.startContainer)?.[range.startOffset];
    if (index !== undefined) pointerTextRef.current = {index, text: snapshot.text, x: event.clientX, y: event.clientY};
  };
  const seekFromText = (event: React.MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("[data-comparison-change], [data-comparison-menu]")) return;
    event.stopPropagation();
    const pointer = pointerTextRef.current;
    pointerTextRef.current = null;
    if (pointer && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 4) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    const root = event.currentTarget.firstElementChild as HTMLElement | null;
    if (!root) return;
    const snapshot = editorSnapshot(root);
    const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
    const node = range?.startContainer ?? selection?.focusNode;
    const offset = range?.startOffset ?? selection?.focusOffset;
    const index = pointer?.index ?? (node && offset !== undefined ? snapshot.offsets.get(node)?.[offset] : undefined);
    if (index === undefined) return;
    const text = pointer?.text ?? snapshot.text;
    recordEditorCursor(segment.id, index, true);
    setSelectedSegmentId(segment.id);
    if (!isPlaying || props.timeAligned === false) return;
    flushEditorDrafts();
    seekTo(timeForCharacter({ ...segment, text, words: reanchorCharacters(segment.words, segment.text, text) }, index), true);
  };

  const exportDrag = (event: React.DragEvent) => {
    event.stopPropagation();
    setSelectedSegmentId(segment.id);
    if (props.nativeDragSegment) {
      // Cancel the DOM provider; AppKit owns the standard item and session.
      event.preventDefault();
      startTransfer(true);
      void props.nativeDragSegment(segment.id).finally(endTransfer);
    } else {
      startTransfer();
      props.dragSegment?.(segment.id, event.dataTransfer);
    }
  };

  return (
    <article
      data-tag-drop-enabled={!viewingOriginal&&!props.tagWriteDisabled&&!!props.onAddTagId}
      data-tag-drop-target={props.tagDropTarget||undefined}
      ref={transferElement}
      draggable={transferReady}
      data-transfer-ready={transferReady || undefined}
      data-action-tip={transferReady ? msg('segmentTransfer.drag', {key: IS_MAC ? '⌘' : 'Ctrl'}) : undefined}
      onDragStartCapture={event => {
        if (!transferReady) return;
        if (isEditorComposing() || document.querySelector('[role="dialog"], dialog[open]') || (event.target as Element).closest('button, select, a, input')) { event.preventDefault(); return; }
        exportDrag(event);
      }}
      onClickCapture={event => { if (transferReady) { event.preventDefault(); event.stopPropagation(); } }}
      className={`segment segment--speaker-${speakerColorIndex} ${isSelected && isPlayingSegment ? "segment--active" : ""} ${isSelected ? "segment--selected" : ""}`}
      style={speakerColorStyle(speakerEntry, false, Math.max(0, speakers.findIndex(s => s.id === segment.speaker_id)))}
      id={`segment-${segment.id}`}
      onClick={() => {
        setSelectedSegmentId(segment.id);
        if (props.timeAligned !== false) seekTo(segment.start);
      }}
    >
      <div className="segment-speaker" data-action-tip={speakerEntry?.name ?? segment.speaker_id}>
        <span aria-hidden="true">{speakerEntry?.name ?? segment.speaker_id}</span>
      <select
        aria-label={msg('SegmentItem.m0944')}
        onPointerDown={(event) => {
          event.currentTarget.parentElement?.setAttribute('data-focus-source', 'pointer');
        }}
        onKeyDown={(event) => {
          event.currentTarget.parentElement?.removeAttribute('data-focus-source');
        }}
        onBlur={(event) => {
          event.currentTarget.parentElement?.removeAttribute('data-focus-source');
        }}
        value={segment.speaker_id}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => {
          const value = event.target.value;
          if (value === "__new_speaker__") {
            addSpeaker(segment.id);
          } else {
            updateSegment(segment.id, { speaker_id: value });
          }
        }}
        disabled={viewingOriginal}
      >
        {speakers.map((speaker) => (
          <option value={speaker.id} key={speaker.id}>
            {speaker.name}
          </option>
        ))}
        <option value="__new_speaker__">{msg('SegmentItem.m0945')}</option>
      </select>
      </div>

      <div className="segment-content">
        <button
          className="timestamp"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            seekTo(segment.start, true);
          }}
          disabled={!audioUrl || props.timeAligned === false}
          data-tip={props.timeAligned !== false && audioUrl ? msg('SegmentItem.m0947') : undefined}
          data-action-tip={props.timeAligned === false ? msg('SegmentItem.m0946') : !audioUrl ? msg('SegmentItem.m0948') : undefined}
        >
          {timeRange}
        </button>
        <div className="segment-text-hit-area" onPointerDownCapture={captureTextPointer} onClickCapture={seekFromText}>
        {transferReady && <div className="segment-transfer-surface" draggable aria-hidden="true" />}
        {viewingOriginal ? (
          <div ref={readonlyRef} tabIndex={-1} className="segment-text-readonly comparison-text" aria-label={msg('SegmentItem.m0949', { v0: timeRange })}>
            {props.comparisonBefore !== undefined ? revisionFor(props.comparisonBefore,{id:segment.id,text:segment.text,reason:""}).parts.map((part,i)=><span key={i}>{part.changed && part.before && <del data-comparison-deletion="true">{part.before}</del>}{part.changed?<ins>{part.after}</ins>:part.after}</span>) : segment.text.split("\n").map((line, index) => (
              <p className="rt-para" key={index}>{highlightFindOccurrences(line, findQuery) || <br />}</p>
            ))}
          </div>
        ) : (
          <SegmentTextArea
            highlights={segment.highlights}
            comparisonBefore={props.comparisonBefore}
            comparisonBase={props.comparisonBase}
            comparisonAccepted={props.comparisonAccepted}
            onComparisonDecision={props.onComparisonDecision}
            segmentId={segment.id}
            playback={isPlayingSegment ? { segment, time: liveTime ?? currentTime } : undefined}
            value={segment.text}
            registry={textareaRefs}
            ariaLabel={msg('SegmentItem.m0950', { v0: timeRange })}
            onFocus={() => {
              editingRef.current = true;
              setSelectedSegmentId(segment.id);
              // 聚焦只选择片段；定位留给文字点击或播放操作，避免暂停后重新聚焦跳回段首。
            }}
            onBlur={(event) => {
              editingRef.current = false;
              // 失焦前记录光标位置：播放按钮点击会导致 textarea 失焦，
              // 播放时用记录值从光标处开始。
              recordEditorCursor(segment.id, event.currentTarget.selectionStart);
            }}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => handleEditorKeydown(event, segment.id)}
            onChange={(nextText, edits) => {
              if (nextText.length === 0) {
                removeSegment(segment.id);
                return;
              }
              updateSegment(segment.id, { text: nextText }, `segment-text:${segment.id}`, edits);
            }}
          />
        )}
        </div>
      </div>

      <div className="segment-actions">
        <div className="segment-index">
          {(segment.annotations?.length ?? 0) > 0 && (
            <span className="annotation-badge" data-tip={msg('SegmentItem.m0951', { v0: segment.annotations!.length })}>
              {segment.annotations!.length}
            </span>
          )}
          <span draggable={!!(props.dragSegment || props.nativeDragSegment)} onDragStart={exportDrag} data-action-tip={props.dragSegment || props.nativeDragSegment ? msg("segmentTransfer.drag", {key: IS_MAC ? '⌘' : 'Ctrl'}) : undefined} className="segment-number" style={{ width: `${Math.max(2, String(totalSegments).length)}ch` }}>{String(index + 1).padStart(2, "0")}</span>
        </div>
        </div>
        <div ref={tagFooter} className={'segment-tag-footer' + (tagInput ? ' has-tag-input' : '')}>
          <div className="segment-tag-items">{props.tags?.map(tag=><TagPill key={tag.id} name={tag.name} fullPath={props.tagPaths?.[tag.id]} stopPropagation editingBlockedByFilter={!viewingOriginal&&!props.tagRenameEnabled} renameEnabled={!viewingOriginal && props.tagRenameEnabled} onRename={props.onRenameTag ? name=>props.onRenameTag!(tag.id,name) : undefined} disabled={props.tagWriteDisabled} removeLabel={`${msg('tags.remove')}: ${tag.name}`} onRemove={!viewingOriginal && props.onRemoveTag ? ()=>props.onRemoveTag?.(segment.id,tag.id) : undefined}/>)}</div>
          {tagInput&&!viewingOriginal&&<TagInput availableTags={props.availableTags} assignedIds={props.tags?.map(tag=>tag.id)} onCancel={reason=>closeTagEntry(reason==='escape')} onCommit={async(name,id)=>{await(id&&props.onAddTagId?props.onAddTagId(segment.id,id):props.onAddTag?.(segment.id,name));closeTagEntry(true)}}/>}
        <div className="segment-actions__icons">
          {!viewingOriginal ? (
            <>
              {props.onAddTag&&<TagAddButton type="button" data-add-tag disabled={props.tagWriteDisabled} data-tip={nativeDesktopAvailable()?msg('tags.addShortcut',{key:keys('T')}):msg('tags.add')} aria-label={msg('tags.add')} onClick={e=>{e.stopPropagation();openTagEntry()}}><svg className="segment-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 3h8l10 10-8 8L3 11Z"/><circle cx="7.5" cy="7.5" r="1"/></svg></TagAddButton>}
              <button
                type="button"
                aria-label={msg('SegmentItem.m0952', { v0: keys("↵") })}
                data-tip={msg('SegmentItem.m0953', { v0: keys("↵") })}
                onClick={(event) => {
                  event.stopPropagation();
                  const textarea = textareaRefs.current.get(segment.id);
                  const cursorPosition = textarea?.selectionStart ?? 0;
                  splitSegment(
                    segment.id,
                    cursorPosition > 0 && cursorPosition < segment.text.length
                      ? cursorPosition
                      : Math.round(segment.text.length / 2),
                  );
                }}
              >
                <svg
                  className="segment-action-icon"
                  viewBox="0 0 24 24"
                  width="13"
                  height="13"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {/* 拆分 = Y：一条线向上分叉成两条带曲线的分支 */}
                  <path d="M12 5v7M12 12C9.5 14.5 6 16.5 4 19M12 12C14.5 14.5 18 16.5 20 19" />
                </svg>
              </button>
              <button
                type="button"
                aria-label={msg('SegmentItem.m0954')}
                data-tip={msg('SegmentItem.m0955', { v0: keys("↓") })}
                disabled={index === totalSegments - 1}
                onClick={(event) => {
                  event.stopPropagation();
                  mergeWithNext(segment.id);
                }}
              >
                <svg
                  className="segment-action-icon"
                  viewBox="0 0 24 24"
                  width="13"
                  height="13"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {/* 合并下一段 = 倒 Y：两条曲线向下汇合成一条竖线 */}
                  <path d="M4 5C6.5 7.5 9.5 9.5 12 12M20 5C17.5 7.5 14.5 9.5 12 12M12 12v7" />
                </svg>
              </button>
              {props.copySegment && <button type="button" aria-label={msg('segmentTransfer.copy', {key: keys('C', true)})} data-tip={msg('segmentTransfer.copy', {key: keys('C', true)})} onClick={event => { event.stopPropagation(); props.copySegment?.(segment.id); }}><svg className="segment-action-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/></svg></button>}
              <button
                type="button"
                aria-label={msg('SegmentItem.m0956')}
                data-tip={msg('SegmentItem.m0957', { v0: keys(IS_MAC ? "⌫" : "Backspace", true) })}
                onClick={(event) => {
                  event.stopPropagation();
                  flushEditorDrafts();
                  removeSegment(segment.id);
                }}
              >
                <svg
                  className="segment-action-icon"
                  viewBox="0 0 24 24"
                  width="13"
                  height="13"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M3 6h18" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <path d="M10 11v6M14 11v6" />
                </svg>
              </button>
            </>
          ) : props.copySegment ? <button type="button" aria-label={msg('segmentTransfer.copy', {key: keys('C', true)})} data-tip={msg('segmentTransfer.copy', {key: keys('C', true)})} onClick={event => { event.stopPropagation(); props.copySegment?.(segment.id); }}><svg className="segment-action-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/></svg></button> : null}
        </div>
      </div>
      {isSelected && (
        <span className="segment-link-arrow" aria-hidden="true" data-action-tip={msg('SegmentItem.m0958')} />
      )}
    </article>
  );
});
