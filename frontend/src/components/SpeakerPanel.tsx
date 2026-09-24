import { msg, useInterfaceLanguage } from '../i18n';
import type { Dispatch, RefObject, SetStateAction } from "react";

import { SpeakerColorPicker } from "./SpeakerColorPicker";
import type { Speaker, Transcript } from "../types";
import { SPEAKER_PALETTE, normalizeSpeakerName, speakerAccent, speakerColorStyle } from "../lib/speakers";
import type { MergePrompt } from "../hooks/useEditor";

/** 说话人侧栏：收起窄条 + 说话人卡片列表（改名/隐藏/合并/删除）+ 添加按钮。
 *  所有跨领域状态与操作通过 props 注入，本组件只做展示与交互编排。 */
export interface SpeakerPanelProps {
  speakers: Speaker[];
  hiddenSpeakerIds: Set<string>;
  viewingOriginal: boolean;
  mergeMenuFor: string | null;
  setMergeMenuFor: (id: string | null) => void;
  mergeMenuRef: RefObject<HTMLDivElement | null>;
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  mutateTranscript: (
    updater: (current: Transcript) => Transcript,
    groupKey?: string,
  ) => void;
  toggleHideSpeaker: (id: string) => void;
  setMergePrompt: Dispatch<SetStateAction<MergePrompt | null>>;
  deleteSpeaker: (id: string) => void;
  addSpeaker: (assignSegmentId?: string) => void;
  hasEnglishSpeakerTemplate: boolean;
  normalizeEnglishSpeakerTemplates: () => void;
}

export function SpeakerPanel(props: SpeakerPanelProps) {
  useInterfaceLanguage();
  const {
    speakers,
    hiddenSpeakerIds,
    viewingOriginal,
    mergeMenuFor,
    setMergeMenuFor,
    mergeMenuRef,
    collapsed,
    setCollapsed,
    mutateTranscript,
    toggleHideSpeaker,
    setMergePrompt,
    deleteSpeaker,
    addSpeaker,
    hasEnglishSpeakerTemplate,
    normalizeEnglishSpeakerTemplates,
  } = props;

  if (collapsed) {
    const count = speakers.length;
    return (
      <button
        type="button"
        className="speaker-rail"
        aria-label={msg('SpeakerPanel.m1011', { v0: count })}
        onClick={() => setCollapsed(false)}
      >
        {/* 展开箭头置顶，下方仅保留说话人图标。 */}
        <svg
          className="speaker-rail__chevron"
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
          {/* chevrons-right：右向双箭头，与展开态收起按钮的 chevrons-left
              完全同尺寸（16px）同粗细（2.25）同透明度，只是方向相反。
              两态互为镜像，用户一眼看出这是同一个控件的两个方向。 */}
          <path d="m6 17 5-5-5-5" />
          <path d="m13 17 5-5-5-5" />
        </svg>
        <svg
          className="speaker-rail__icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {/* 说话人：一个人形轮廓 + 声波弧线，明确指向「说话人」而非「面板」 */}
          <path d="M15 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" />
          <circle cx="8.5" cy="7" r="3.5" />
          <path d="M16.5 10.5a4 4 0 0 1 0 5" />
          <path d="M19 8a7.5 7.5 0 0 1 0 9" />
        </svg>
      </button>
    );
  }

  return (
    <aside className="speaker-panel">
      <div className="panel-heading">
        <p>{msg('SpeakerPanel.m1012')}</p>
        <span className="panel-heading__meta">
          <span className="panel-heading__count">{speakers.length}</span>
          <button
            type="button"
            className="speaker-collapse-btn"
            aria-label={msg('SpeakerPanel.m1013')}
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
              {/* chevrons-left：左向双箭头，与收起态 rail 的 chevrons-right
                  完全同尺寸（16px）同粗细（2.25），只是方向相反。
                  两态互为镜像：左向 = 收起，右向 = 展开。 */}
              <path d="m11 17-5-5 5-5" />
              <path d="m18 17-5-5 5-5" />
            </svg>
          </button>
        </span>
      </div>
      <div className="speaker-list">
        {speakers.map((speaker, index) => (
          <div
            className={`speaker-card speaker-card--speaker-${(speaker.colorIndex ?? index) % SPEAKER_PALETTE.length}${hiddenSpeakerIds.has(speaker.id) ? " speaker-card--hidden" : ""}${mergeMenuFor === speaker.id ? " speaker-card--menu-open" : ""}`}
            key={speaker.id}
            style={speakerColorStyle(speaker, true, index)}
          >
            {/* speaker-card-name 是 input 的视觉容器：
                overflow: hidden 视觉截断 editing 状态长名字 inline 溢出；
                readOnly 状态由 input text-overflow: ellipsis 负责加省略号。 */}
            <span className="speaker-card-name">
              <input
                value={speaker.name}
                aria-label={msg('SpeakerPanel.m1014', { v0: speaker.name })}
                title={speaker.name}
                readOnly={viewingOriginal}
                onChange={(event) => {
                  const newName = event.target.value;
                  mutateTranscript(
                    (current) => ({
                      ...current,
                      speakers: current.speakers.map((item) =>
                        item.id === speaker.id ? { ...item, name: newName } : item,
                      ),
                    }),
                    `speaker-name:${speaker.id}`,
                  );
                  // 改名后检测是否与某个已存在说话人「同名」（规范化后，忽略半角全角/大小写），
                  // 是则提示合并，而不是在卡片上放一个「合并到」下拉。
                  if (newName.trim()) {
                    const match = speakers.find(
                      (other) =>
                        other.id !== speaker.id &&
                        normalizeSpeakerName(other.name) === normalizeSpeakerName(newName),
                    );
                    if (match) {
                      setMergePrompt({
                        sourceId: speaker.id,
                        targetId: match.id,
                        sourceName: newName,
                        targetName: match.name,
                        trigger: "rename",
                      });
                    }
                  }
                }}
              />
            </span>
            <span className="speaker-actions">
              {!viewingOriginal ? (
              <>
              <SpeakerColorPicker name={speaker.name} color={speakerAccent(speaker,index)} onChange={(color,colorIndex)=>{
                mutateTranscript(current=>({...current,speakers:current.speakers.map(item=>item.id===speaker.id?{...item,color,colorIndex}:item)}),`speaker-color:${speaker.id}`);
              }}/>
              <button
                type="button"
                className="speaker-action speaker-hide-icon"
                aria-label={hiddenSpeakerIds.has(speaker.id) ? msg('SpeakerPanel.m1015', { v0: speaker.name }) : msg('SpeakerPanel.m1016', { v0: speaker.name })}
                data-tip={hiddenSpeakerIds.has(speaker.id) ? msg('SpeakerPanel.m1017') : msg('SpeakerPanel.m1018')}
                onClick={() => toggleHideSpeaker(speaker.id)}
              >
                {hiddenSpeakerIds.has(speaker.id) ? (
                  <svg
                    className="speaker-eye"
                    viewBox="0 0 24 24"
                    width="15"
                    height="15"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <path d="M1 1l22 22" />
                    <path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3 8 10 8a9.12 9.12 0 0 0 5.39-1.6" />
                  </svg>
                ) : (
                  <svg
                    className="speaker-eye"
                    viewBox="0 0 24 24"
                    width="15"
                    height="15"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
              <button
                type="button"
                className="speaker-action speaker-merge-icon"
                aria-label={msg('SpeakerPanel.m1019', { v0: speaker.name })}
                data-tip={msg('SpeakerPanel.m1020')}
                data-tip-pos="top"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  setMergeMenuFor(mergeMenuFor === speaker.id ? null : speaker.id);
                }}
              >
                <svg
                  className="speaker-merge"
                  viewBox="0 0 24 24"
                  width="15"
                  height="15"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {/* 合并：两个相对的方框 + 中间连接线（combine 语义：合二为一） */}
                  <path d="M10 18H5a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3h5" />
                  <path d="M14 6h5a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-5" />
                  <path d="M18 12H6" />
                </svg>
              </button>
              <button
                type="button"
                className="speaker-action speaker-delete-icon"
                aria-label={msg('SpeakerPanel.m1021', { v0: speaker.name })}
                data-tip={msg('SpeakerPanel.m1022')}
                onClick={() => deleteSpeaker(speaker.id)}
              >
                <svg
                  className="speaker-trash"
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
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
              {!viewingOriginal && mergeMenuFor === speaker.id && (
                <div className="speaker-merge-menu" ref={mergeMenuRef} role="menu">
                  <p className="speaker-merge-menu__title">{msg('SpeakerPanel.m1023')}</p>
                  {speakers
                    .filter((other) => other.id !== speaker.id)
                    .map((other) => (
                      <button
                        type="button"
                        role="menuitem"
                        key={other.id}
                        onClick={() => {
                          setMergePrompt({
                            sourceId: speaker.id,
                            targetId: other.id,
                            sourceName: speaker.name,
                            targetName: other.name,
                            trigger: "merge",
                          });
                          setMergeMenuFor(null);
                        }}
                      >
                        {other.name}
                      </button>
                    ))}
                  {speakers.length <= 1 && (
                    <p className="speaker-merge-menu__empty">{msg('SpeakerPanel.m1024')}</p>
                  )}
                </div>
              )}
            </span>
          </div>
        ))}
      </div>
      {!viewingOriginal ? (
        <button
          type="button"
          className="speaker-add"
          onClick={() => addSpeaker()}
          data-tip={msg('SpeakerPanel.m1025')}
        >
          {msg('SpeakerPanel.m1026')}</button>
      ) : null}
      {!viewingOriginal && hasEnglishSpeakerTemplate ? (
        <button
          type="button"
          className="speaker-add speaker-add--minor"
          onClick={normalizeEnglishSpeakerTemplates}
          data-tip={msg('SpeakerPanel.m1027')}
        >
          {msg('SpeakerPanel.m1028')}</button>
      ) : null}
      {viewingOriginal ? (
        <div className="tip">
          <span>{msg('SpeakerPanel.m1029')}</span>
          {msg('SpeakerPanel.m1030')}</div>
      ) : null}
    </aside>
  );
}
