import { msg, useInterfaceLanguage } from '../i18n';
import type { ReactNode } from "react";
import type { InterviewDraft, InterviewMetadata } from "../types";
import { keys, toDatetimeLocalValue } from "../lib/format";
import { InlineEdit } from "./InlineEdit";

/** 编辑区头部：标题 + 元数据（时间/地点/标签）内联编辑 + 版本选择与操作。
 *  元数据修改与版本操作通过 props 注入。 */
export interface TranscriptHeaderProps {
  comparisonControls?: ReactNode;
  preparing?: boolean;
  metadata: InterviewMetadata | null;
  segmentCount: number;
  viewingOriginal: boolean;
  activeModelId: string | null;
  versionControls: ReactNode;
  patchMetadata: (patch: Partial<InterviewDraft>) => void;
  forkFromOriginal: (modelId: string) => void;
}

export function TranscriptHeader(props: TranscriptHeaderProps) {
  useInterfaceLanguage();
  const {
    metadata,
    segmentCount,
    versionControls,
    patchMetadata,
  } = props;

  return (
    <>
      <div className="transcript-heading">
        <div>
          {/* 中文标签，与左「说话人」右「批注」同为 section-label 视觉语言。
               text-transform: uppercase 对中文无效，字间距在 CSS 里单独收紧。 */}
          <p className="section-label">{msg('TranscriptHeader.m1066')}</p>
          <h1>
            {props.preparing ? (metadata?.title || msg('TranscriptHeader.m1067')) : <InlineEdit
              value={metadata?.title ?? ""}
              placeholder={msg('TranscriptHeader.m1068')}
              ariaLabel={msg('TranscriptHeader.m1069')}
              display={(value) => <span className="transcript-title-text" title={value}>{value}</span>}
              onCommit={(next) => void patchMetadata({ title: next.trim() || msg('TranscriptHeader.m1070') })}
            />}

          </h1>
          {metadata && !props.preparing && (
            <div className="metadata-summary">
              <InlineEdit
                value={toDatetimeLocalValue(metadata.recorded_at)}
                placeholder={msg('TranscriptHeader.m1071')}
                ariaLabel={msg('TranscriptHeader.m1072')}
                inputType="datetime-local"
                display={(fieldValue) => fieldValue.replace("T", " ")}
                onCommit={(next) => void patchMetadata({ recorded_at: next ? (next.includes("T") ? `${next}:00` : next) : null })}
              />
              <InlineEdit
                value={metadata.location}
                placeholder={msg('TranscriptHeader.m1073')}
                ariaLabel={msg('TranscriptHeader.m1074')}
                onCommit={(next) => void patchMetadata({ location: next })}
              />
              <InlineEdit
                value={metadata.notes}
                placeholder={msg('TranscriptHeader.m1075')}
                ariaLabel={msg('TranscriptHeader.m1076')}
                onCommit={(next) => void patchMetadata({ notes: next })}
              />
            </div>
          )}
        </div>
        {!props.preparing && <div className="transcript-control-row">
          <div className="version-badge-row">
            {versionControls}
            {props.comparisonControls}
          </div>
          <div className="transcript-heading-status">
          <p className="seek-hint">{msg('review.seekHint', { shortcut: keys("0") })}</p>
          <p className="segment-count">{msg('TranscriptHeader.m1078', { count: segmentCount })}</p>
          </div>
        </div>}
      </div>
    </>
  );
}
