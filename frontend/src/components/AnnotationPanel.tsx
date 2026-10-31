import { msg, useInterfaceLanguage } from '../i18n';
import type { Dispatch, RefObject, SetStateAction, ReactNode } from "react";

import type { Highlight, Segment, Transcript } from "../types";
import { formatTime, keys } from "../lib/format";
import type { HighlightGroup } from "../lib/highlights";
import { AnnotationAddBox, AnnotationCard } from "./AnnotationCard";
import { PanelTabIcon } from './PanelTabIcon';

/** 面板顶部的两个页签。高亮页是全文清单，没有「当前片段 / 全部」这层切换。 */
export type PanelTab = "annotation" | "highlight" | "tags";

/** 批注栏：批注 / 高亮 两个页签 + 各自的列表。
 *  跨领域状态（transcript/选中与焦点片段/隐藏说话人）与操作全部 props 注入。 */
export interface AnnotationPanelProps {
  tagsPanel?: ReactNode;
  tagCount?: number;
  transcript: Transcript | null;
  readOnly?: boolean;
  pending?:boolean;
  readOnlyMessage?: string;
  annotationView: "selected" | "all";
  setAnnotationView: Dispatch<SetStateAction<"selected" | "all">>;
  panelTab: PanelTab;
  setPanelTab: (tab: PanelTab) => void;
  currentSegment: Segment | undefined;
  currentSegmentId: string;
  hiddenSpeakerIds: Set<string>;
  annotationListRef: RefObject<HTMLDivElement | null>;
  /** 批注栏是否收起（右侧窄条态）。与说话人栏各自独立持久化。 */
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  highlightGroups: HighlightGroup[];
  highlightCount: number;
  setSelectedSegmentId: (id: string) => void;
  seekTo: (time: number, playing?: boolean) => void;
  updateAnnotation: (segmentId: string, annotationId: string, text: string) => void;
  deleteAnnotation: (segmentId: string, annotationId: string) => void;
  addAnnotation: (segmentId: string, text: string) => void;
  onJumpToHighlight: (segment: Segment, highlight: Highlight) => void;
  onRemoveHighlight: (segmentId: string, highlightId: string) => void;
}

export function AnnotationPanel(props: AnnotationPanelProps) {
  useInterfaceLanguage();
  const {
    transcript,
    readOnly = false,
    annotationView,
    setAnnotationView,
    panelTab,
    setPanelTab,
    currentSegment,
    currentSegmentId,
    hiddenSpeakerIds,
    annotationListRef,
    collapsed,
    setCollapsed,
    highlightGroups,
    highlightCount,
    setSelectedSegmentId,
    seekTo,
    updateAnnotation,
    deleteAnnotation,
    addAnnotation,
    onJumpToHighlight,
    onRemoveHighlight,
  } = props;

  const jumpTo = (segment: Segment) => {
    setSelectedSegmentId(segment.id);
    seekTo(segment.start);
    window.requestAnimationFrame(() => {
      const target = document.getElementById(`segment-${segment.id}`);
      const panel = target?.closest<HTMLElement>(".transcript-panel");
      if (!panel || !target) return;
      const top = panel.scrollTop + target.getBoundingClientRect().top
        - panel.getBoundingClientRect().top - panel.clientHeight / 2 + target.clientHeight / 2;
      panel.scrollTo({ top: Math.max(0, top), behavior: "instant" });
    });
  };

  const annotationCount = (transcript?.segments ?? []).reduce(
    (total, segment) => total + (segment.annotations?.length ?? 0),
    0,
  );

  // 收起态：32px 窄条（贴右边缘），只放展开箭头。
  // 刻意不放数量徽章：收起态只承担「展开入口」职责，条数在展开后头部可见。
  if (collapsed) {
    return (
      <button
        type="button"
        className="annotation-rail"
        aria-label={msg('AnnotationPanel.m0324')}
        onClick={() => setCollapsed(false)}
      >
        <svg
          className="annotation-rail__chevron"
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {/* chevrons-left：y 范围 7-17（ink 12×10），与右侧栏的 chevrons-right
              及说话人栏 rail 的 chevron 完全同尺寸。 */}
          <path d="m11 17-5-5 5-5" />
          <path d="m18 17-5-5 5-5" />
        </svg>

      </button>
    );
  }

  return (
    <aside className={"annotation-panel"+(props.tagsPanel?" annotation-panel--tags-enabled":"")}>
      {/* 顶栏顺序（左→右）：双箭头收起按钮 → 页签（批注 / 标签 / 高亮，仅当前页签显示名称与条数）。
          页签取代了原来的「批注」标题 + 条数徽章——否则标题与页签会把同一条
          信息显示两遍。justify-content 覆盖成 flex-start（见
          .annotation-panel .panel-heading），不用 space-between 分散。 */}
      <div className="panel-heading">
        <button
          type="button"
          className="annotation-collapse-btn"
          aria-label={msg('AnnotationPanel.m0325')}
          onClick={() => setCollapsed(true)}
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {/* chevrons-right：收起批注栏 = 往右折。y 范围 7-17（ink 12×10）。 */}
            <path d="m6 17 5-5-5-5" />
            <path d="m13 17 5-5-5-5" />
          </svg>
        </button>
        <div className="panel-tabs">
          {([
            {tab:'annotation' as const,name:msg('AnnotationPanel.m0326'),count:annotationCount},
            ...(props.tagsPanel?[{tab:'tags' as const,name:msg('tags.title'),count:props.tagCount??0}]:[]),
            {tab:'highlight' as const,name:msg('AnnotationPanel.m0327'),count:highlightCount},
          ]).map(item=><button key={item.tab} type="button" className={panelTab===item.tab?'is-active':''} aria-label={`${item.name} ${item.count}`} data-tip={item.name} onClick={()=>setPanelTab(item.tab)}>
            <PanelTabIcon kind={item.tab}/>
            {panelTab===item.tab&&<>{item.name}<span className="panel-tabs__count">{item.count}</span></>}
          </button>)}
        </div>
      </div>

      {panelTab==='tags'?props.tagsPanel:<div className="annotation-editing-content" inert={props.pending} aria-busy={props.pending}>
      {readOnly && <p className="annotation-empty" role="note">{props.readOnlyMessage ?? msg('AnnotationPanel.readOnly')}</p>}
      {panelTab === "annotation" ? (
        <>
          <div className="annotation-view-toggle">
            <button
              type="button"
              className={annotationView === "selected" ? "is-active" : ""}
              onClick={() => setAnnotationView("selected")}
            >
              {msg('AnnotationPanel.m0328')}</button>
            <button
              type="button"
              className={annotationView === "all" ? "is-active" : ""}
              onClick={() => setAnnotationView("all")}
            >
              {msg('AnnotationPanel.m0329')}</button>
          </div>

          {annotationView === "selected" ? (
            <div className="annotation-body">
              {currentSegment ? (
                <>
                  <div className="annotation-segment-label">
                    <button
                      type="button"
                      className="annotation-jump"
                      onClick={() => jumpTo(currentSegment)}
                    >
                      {formatTime(currentSegment.start)}–{formatTime(currentSegment.end)}
                    </button>
                    <span>
                      {msg('AnnotationPanel.m0330', { v0: transcript!.segments.findIndex((s) => s.id === currentSegment.id) + 1 })}
                    </span>
                  </div>
                  <div className="annotation-list" ref={annotationListRef}>
                    {(currentSegment.annotations ?? []).length === 0 ? (
                      <p className="annotation-empty">{msg('AnnotationPanel.m0331')}</p>
                    ) : (
                      (currentSegment.annotations ?? []).map((annotation) => (
                        <AnnotationCard readOnly={readOnly}
                          key={annotation.id}
                          annotation={annotation}
                          isCurrent
                          onJump={() => jumpTo(currentSegment)}
                          onCommit={(text) => updateAnnotation(currentSegment.id, annotation.id, text)}
                          onDelete={() => deleteAnnotation(currentSegment.id, annotation.id)}
                        />
                      ))
                    )}
                  </div>
                  <AnnotationAddBox draftKey={currentSegment.id} disabled={readOnly} onSubmit={(text) => addAnnotation(currentSegment.id, text)} />
                </>
              ) : (
                <p className="annotation-empty">{msg('AnnotationPanel.m0332')}</p>
              )}
            </div>
          ) : (
            <div className="annotation-body">
            <div className="annotation-list annotation-list--all" ref={annotationListRef}>
              {transcript?.segments
                .filter((segment) => !hiddenSpeakerIds.has(segment.speaker_id))
                .flatMap((segment, index) =>
                  (segment.annotations ?? []).map((annotation) => ({ segment, annotation, index })),
                ).length === 0 ? (
                <p className="annotation-empty">{msg('AnnotationPanel.m0333')}</p>
              ) : (
                transcript!.segments
                  .filter((segment) => !hiddenSpeakerIds.has(segment.speaker_id))
                  .flatMap((segment, index) =>
                    (segment.annotations ?? []).map((annotation) => (
                      <AnnotationCard readOnly={readOnly}
                        key={annotation.id}
                        annotation={annotation}
                        meta={msg('AnnotationPanel.m0334', { v0: formatTime(segment.start), v1: index + 1 })}
                        isCurrent={segment.id === currentSegmentId}
                        onJump={() => jumpTo(segment)}
                        onCommit={(text) => updateAnnotation(segment.id, annotation.id, text)}
                        onDelete={() => deleteAnnotation(segment.id, annotation.id)}
                      />
                    )),
                  )
              )}
            </div>
            {currentSegment ? <AnnotationAddBox draftKey={currentSegment.id} disabled={readOnly} onSubmit={(text) => addAnnotation(currentSegment.id, text)}>
              <div className="annotation-add-target">
                <span>{msg('AnnotationPanel.m0330', { v0: transcript!.segments.findIndex((s) => s.id === currentSegment.id) + 1 })}</span>
                <span>{formatTime(currentSegment.start)}–{formatTime(currentSegment.end)}</span>
              </div>
            </AnnotationAddBox> : <p className="annotation-empty">{msg('AnnotationPanel.m0332')}</p>}
            </div>
          )}
        </>
      ) : (
        <div className="annotation-list highlight-list" ref={annotationListRef}>
          {highlightGroups.length === 0 ? (
            <p className="annotation-empty">{msg('review.highlightHint', { shortcut: keys("H", true) })}</p>
          ) : (
            highlightGroups.map((group) => {
              const isCurrent = group.segment.id === currentSegmentId;
              return (
                <div
                  className={`hl-card${isCurrent ? " hl-card--current" : ""}`}
                  key={group.segment.id}
                  data-current={isCurrent ? "true" : undefined}
                  onClick={() => onJumpToHighlight(group.segment, group.items[0].highlight)}
                >
                  <button
                    type="button"
                    className="hl-card__meta"
                    onClick={(event) => {
                      event.stopPropagation();
                      onJumpToHighlight(group.segment, group.items[0].highlight);
                    }}
                  >
                    {formatTime(group.segment.start)} {msg('AnnotationPanel.m0337', { segment: group.index + 1 })}
                    {group.items.length > 1 ? msg('AnnotationPanel.m0338', { count: group.items.length }) : ""}
                  </button>
                  {group.items.map(({ highlight, snippet }) => (
                    <div
                      className="hl-row"
                      key={highlight.id}
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        event.stopPropagation();
                        onJumpToHighlight(group.segment, highlight);
                      }}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onJumpToHighlight(group.segment, highlight);
                        }
                      }}
                    >
                      <span className="hl-row__text">
                        {snippet.leadingEllipsis ? "…" : null}
                        {snippet.before}
                        <mark className="hl-mark">{snippet.marked}</mark>
                        {snippet.after}
                        {snippet.trailingEllipsis ? "…" : null}
                      </span>
                      <button
                        type="button"
                        className="hl-del"
                        disabled={readOnly}
                        aria-label={msg('AnnotationPanel.m0339')}
                        data-tip={msg('AnnotationPanel.m0340')}
                        onClick={(event) => {
                          event.stopPropagation();
                          onRemoveHighlight(group.segment.id, highlight.id);
                        }}
                      >
                        <svg
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
                          <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              );
            })
          )}
        </div>
      )}
      </div>}
    </aside>
  );
}
