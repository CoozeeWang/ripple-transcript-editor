import { msg, useInterfaceLanguage } from '../i18n';
import type { TextEdit } from "../lib/transcriptOps";
import type { ComparisonDecision } from "../lib/comparisonReview";
import { revisionFor } from "../lib/revisions";
import { speakerColorStyle, SPEAKER_PALETTE } from "../lib/speakers";
import { flushEditorDrafts } from "../lib/editorDrafts";
import type { ParagraphEditorElement } from "../lib/paragraphEditor";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
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

  return (
    <article
      className={`segment segment--speaker-${speakerColorIndex} ${isSelected && isPlayingSegment ? "segment--active" : ""} ${isSelected ? "segment--selected" : ""}`}
      style={speakerColorStyle(speakerEntry, false, Math.max(0, speakers.findIndex(s => s.id === segment.speaker_id)))}
      id={`segment-${segment.id}`}
      onClick={() => {
        setSelectedSegmentId(segment.id);
        if (props.timeAligned !== false) seekTo(segment.start);
      }}
    >
      <div className="segment-speaker" title={speakerEntry?.name ?? segment.speaker_id}>
        <span aria-hidden="true">{speakerEntry?.name ?? segment.speaker_id}</span>
      <select
        aria-label={msg('SegmentItem.m0944')}
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
          data-tip={props.timeAligned === false ? msg('SegmentItem.m0946') : audioUrl ? msg('SegmentItem.m0947') : msg('SegmentItem.m0948')}
        >
          {timeRange}
        </button>
        <div className="segment-text-hit-area" onPointerDownCapture={captureTextPointer} onClickCapture={seekFromText}>
        {viewingOriginal ? (
          <div ref={readonlyRef} className="segment-text-readonly comparison-text" aria-label={msg('SegmentItem.m0949', { v0: timeRange })}>
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
          <span>{String(index + 1).padStart(2, "0")}</span>
          {(segment.annotations?.length ?? 0) > 0 && (
            <span className="annotation-badge" data-tip={msg('SegmentItem.m0951', { v0: segment.annotations!.length })}>
              {segment.annotations!.length}
            </span>
          )}
        </div>
        <div className="segment-actions__icons">
          {!viewingOriginal ? (
            <>
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
          ) : null}
        </div>
      </div>
      {isSelected && (
        <span className="segment-link-arrow" aria-hidden="true" data-tip={msg('SegmentItem.m0958')} />
      )}
    </article>
  );
});
