import { LanguageControl } from './LanguageControl';
import { msg, useInterfaceLanguage } from '../i18n';
import { ProjectIcon } from './ProjectIcon';
import { exportFormats, type ExportFormat } from '../lib/export';
import { useEffect, type ChangeEvent, type Dispatch, type RefObject, type SetStateAction } from "react";

import type { AudioFileEntry } from "../localStore";
import { IS_MAC, keys } from "../lib/format";

/** 顶栏：品牌 + 文件夹/音频切换 + 撤销重做/查找/导出/设置/保存。
 *  依赖密集（跨 useFolder/useVersions/useFindReplace/useTranscription 等域），
 *  全部通过 props 注入。 */
export interface TopbarProps {
  taskOnly?: boolean;
  projectMode?: boolean;
  projectLabel?: string;
  onReturnToProjects?: () => void;
  navigationDisabled?: boolean;
  // 品牌/文件
  audioFilename: string;
  // 文件夹
  dirHandle: FileSystemDirectoryHandle | null;
  handleOpenFolder: () => void;
  folderShortcutHint: string;
  openMenuOpen: boolean;
  setOpenMenuOpen: Dispatch<SetStateAction<boolean>>;
  openMenuRef: RefObject<HTMLDivElement | null>;
  recentFolders: FileSystemDirectoryHandle[];
  handleOpenRecentFolder: (handle: FileSystemDirectoryHandle) => void;
  importInputRef: RefObject<HTMLInputElement | null>;
  handleTranscriptFile: (event: ChangeEvent<HTMLInputElement>) => void;
  // 音频切换
  selectedAudio: string | null;
  loadAudio: (name: string) => void;
  audioFiles: AudioFileEntry[];
  viewingOriginal: boolean;
  // 工具栏
  performUndo: () => void;
  performRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  setFindOpen: Dispatch<SetStateAction<boolean>>;
  exportMenuOpen: boolean;
  setExportMenuOpen: Dispatch<SetStateAction<boolean>>;
  exportMenuRef: RefObject<HTMLDivElement | null>;
  exportAs: (format: ExportFormat) => void;
  subtitlesAvailable?: boolean;
  exportProjectFiles?: () => void;
  handleSave: () => void;
  openSettings: () => void;
  openAIEditing?: () => void;
}

export function Topbar(props: TopbarProps) {
  useInterfaceLanguage();
  const {
    dirHandle,
    handleOpenFolder,
    folderShortcutHint,
    openMenuOpen,
    setOpenMenuOpen,
    openMenuRef,
    recentFolders,
    handleOpenRecentFolder,
    importInputRef,
    handleTranscriptFile,
    selectedAudio,
    loadAudio,
    audioFiles,
    viewingOriginal,
    performUndo,
    performRedo,
    canUndo,
    canRedo,
    setFindOpen,
    exportMenuOpen,
    setExportMenuOpen,
    exportMenuRef,
    exportAs,
    handleSave,
    openSettings,
  } = props;

  useEffect(() => {
    if (!exportMenuOpen) return;
    const previous = document.activeElement;
    const menu = exportMenuRef.current?.querySelector<HTMLElement>('[role="menu"]');
    menu?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected &&
          (document.activeElement === document.body || menu?.contains(document.activeElement))) previous.focus();
    };
  }, [exportMenuOpen, exportMenuRef]);

  const Brand = props.onReturnToProjects ? "button" : "div";

  return (
    <header className={`topbar${props.projectMode ? " topbar--project" : ""}`}>
      <div className="topbar-identity">
      <Brand className="brand" type={props.onReturnToProjects ? "button" : undefined}
        onClick={props.onReturnToProjects} disabled={props.onReturnToProjects ? props.navigationDisabled : undefined}
        aria-label={props.onReturnToProjects ? msg('Topbar.m1031') : undefined}
        title={props.onReturnToProjects ? msg('Topbar.m1032') : undefined}>
        <img className="brand-mark" src="/ripple-icon.svg?v=transparent-2" alt="Ripple" width={80} height={80} />
        <div>
          <p className="product-name">Ripple</p>
          <p className="file-name">Transcription Editor</p>
        </div>
      </Brand>

      {props.onReturnToProjects && <button type="button" className="topbar-project"
        onClick={props.onReturnToProjects} disabled={props.navigationDisabled}
        aria-label={props.projectLabel ? msg('Topbar.m1033', { v0: props.projectLabel }) : msg('Topbar.m1034')}
        title={props.projectLabel ? msg('Topbar.m1035', { v0: props.projectLabel }) : msg('Topbar.m1036')}>
        <ProjectIcon kind="project" />
        <span>{props.projectLabel || msg('Topbar.m1037')}</span>
      </button>}
      </div>
      {!props.projectMode && <div className="interview-context">
        {!dirHandle ? (
          <button type="button" className="button button--primary" onClick={() => void handleOpenFolder()} data-tip={msg('Topbar.m1038', { v0: folderShortcutHint })}>
            {msg('Topbar.m1039')}</button>
        ) : (
          <>
            <div className="open-menu" ref={openMenuRef}>
              <button
                type="button"
                className="button button--secondary button--icon"
                onClick={() => setOpenMenuOpen((open) => !open)}
                aria-haspopup="true"
                aria-expanded={openMenuOpen}
                data-tip={msg('Topbar.m1040')}
              >
                <svg
                  className="ctrl-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
                </svg>
                <span className="caret" aria-hidden="true">▾</span>
              </button>
              {openMenuOpen && (
                <ul className="menu-list" role="menu">
                  {recentFolders.length > 0 && (
                    <li className="menu-list__section">
                      <span className="menu-list__title">{msg('Topbar.m1041')}</span>
                      <ul className="menu-recent-list">
                        {recentFolders.map((h) => (
                          <li key={h.name}>
                            <button
                              type="button"
                              role="menuitem"
                              className="menu-recent-item"
                              onClick={() => {
                                setOpenMenuOpen(false);
                                void handleOpenRecentFolder(h);
                              }}
                            >
                              <svg
                                className="recent-list__icon"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                              >
                                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                              </svg>
                              <span className="recent-list__name">{h.name}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </li>
                  )}
                  {recentFolders.length > 0 && (
                    <li className="menu-divider" role="separator" aria-hidden="true" />
                  )}
                  <li className="menu-list__section">
                    <span className="menu-list__title">{msg('Topbar.m1042')}</span>
                    <ul className="menu-recent-list">
                      <li>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setOpenMenuOpen(false);
                            void handleOpenFolder();
                          }}
                        >
                          <svg
                            className="menu-list__icon"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                          </svg>
                          {msg('Topbar.m1043')}</button>
                      </li>
                      <li>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setOpenMenuOpen(false);
                            importInputRef.current?.click();
                          }}
                        >
                          <svg
                            className="menu-list__icon"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M12 3v10M8 9l4 4 4-4M4 17h16" />
                          </svg>
                          {msg('Topbar.m1044')}</button>
                      </li>
                    </ul>
                  </li>
                </ul>
              )}
            </div>
            <div className="interview-switcher-wrap">
              <svg
                className="audio-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" x2="12" y1="19" y2="22" />
              </svg>
              <select
                className="interview-switcher"
                aria-label={msg('Topbar.m1045')}
                value={selectedAudio ?? ""}
                onChange={(event) => void loadAudio(event.target.value)}
              >
                {audioFiles.map((entry) => (
                  <option value={entry.name} key={entry.name}>
                    {entry.name}
                    {entry.hasEdited ? msg('Topbar.m1046') : entry.hasOriginal ? msg('Topbar.m1047') : msg('Topbar.m1048')}
                  </option>
                ))}
              </select>
            </div>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleTranscriptFile}
              style={{ display: "none" }}
            />
          </>
        )}
      </div>}
      <div className="toolbar">
        {!props.taskOnly && <>
        {props.openAIEditing && <button type="button" className="button button--secondary button--icon button--ai" onClick={props.openAIEditing} data-tip={msg('Topbar.m1049')} aria-label={msg('Topbar.m1050')}>
          <svg className="toolbar-button-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 2 15 9 22 12 15 15 12 22 9 15 2 12 9 9Z" />
          </svg>
        </button>}
        {!viewingOriginal ? (
        <div className="history-controls" aria-label={msg('Topbar.m1051')}>
          <button
            type="button"
            onClick={performUndo}
            disabled={!canUndo}
            data-tip={msg('Topbar.m1052', { v0: keys("Z") })}
            aria-label={msg('Topbar.m1053')}
          >
            <svg
              className="toolbar-button-icon"
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
              <path d="M9 14 4 9 9 4" />
              <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11" />
            </svg>
          </button>
          <button
            type="button"
            onClick={performRedo}
            disabled={!canRedo}
            data-tip={msg('Topbar.m1054', { v0: keys("Z", true) })}
            aria-label={msg('Topbar.m1055')}
          >
            <svg
              className="toolbar-button-icon"
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
              <path d="m15 14 5-5-5-5" />
              <path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5v0A5.5 5.5 0 0 0 9.5 20H13" />
            </svg>
          </button>
        </div>
        ) : null}
        <button
          className="button button--secondary button--icon"
          type="button"
          onClick={() => {
            setFindOpen((open) => !open);
            window.requestAnimationFrame(() => document.getElementById("find-input")?.focus());
          }}
          data-tip={msg('Topbar.m1056', { v0: keys("F") })}
        >
          <svg
            className="toolbar-button-icon"
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
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </button>
        <div className="export-menu" ref={exportMenuRef}>
          <button
            className="button button--secondary button--icon"
            type="button"
            onClick={() => setExportMenuOpen((open) => !open)}
            onKeyDown={event => {
              if (event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); setExportMenuOpen(true); }
            }}
            aria-label={msg('Topbar.m1057')}
            aria-haspopup="menu"
            aria-expanded={exportMenuOpen}
            data-tip={msg('Topbar.m1058', { v0: IS_MAC ? keys("E") : keys("E", true) })}
          >
            <svg
              className="toolbar-button-icon"
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
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <path d="M7 10l5 5 5-5" />
              <path d="M12 15V3" />
            </svg>
          </button>
          {exportMenuOpen && (
            <ul className="menu-list" role="menu" aria-label={msg('Topbar.m1059')} onKeyDown={event => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (event.key === 'Tab') { setExportMenuOpen(false); return; }
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault(); event.stopPropagation();
              const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));
              if (!items.length) return;
              const index = items.indexOf(document.activeElement as HTMLButtonElement);
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
              items[next].focus();
            }}>
              {exportFormats().map(([label, format]) => (
                <li key={format}>
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    disabled={(format === 'srt' || format === 'vtt') && !props.subtitlesAvailable}
                    title={(format === 'srt' || format === 'vtt') && !props.subtitlesAvailable ? msg('Topbar.m1060') : undefined}
                    onClick={() => {
                      setExportMenuOpen(false);
                      void exportAs(format);
                    }}
                  >
                    {label}
                  </button>
                </li>
              ))}
              {props.exportProjectFiles && <li><button type="button" role="menuitem" tabIndex={-1} onClick={() => { setExportMenuOpen(false); props.exportProjectFiles?.(); }}>{msg('Topbar.m1061')}</button></li>}
            </ul>
          )}
        </div>
        </>}
        <button
          className="icon-button"
          type="button"
          onClick={() => void handleSave()}
          data-tip={msg('Topbar.m1064', { v0: keys("S") })}
          aria-label={msg('Topbar.m1065')}
        >
          <svg
            className="toolbar-button-icon"
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
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2Z" />
            <path d="M8 21v-8h8v8M8 3v5h7" />
          </svg>
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={openSettings}
          data-tip={msg('Topbar.m1062')}
          aria-label={msg('Topbar.m1063')}
        >
          <svg
            className="toolbar-button-icon"
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
          </svg>
        </button>
        <LanguageControl />
      </div>
    </header>
  );
}
