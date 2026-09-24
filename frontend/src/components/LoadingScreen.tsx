import { msg, uiMessage, useInterfaceLanguage } from '../i18n';
import { CopyProblem } from "./CopyProblem";
import type { Dispatch, RefObject, SetStateAction } from "react";

/** 加载/欢迎屏：品牌 + 打开文件夹 + 最近打开 dock + 设置弹层入口。
 *  文件夹域状态与操作 props 注入。 */
export interface LoadingScreenProps {
  loadError: string;
  folderShortcutHint: string;
  handleOpenFolder: () => void;
  recentMenuRef: RefObject<HTMLDivElement | null>;
  recentMenuOpen: boolean;
  setRecentMenuOpen: Dispatch<SetStateAction<boolean>>;
  recentFolders: FileSystemDirectoryHandle[];
  handleOpenRecentFolder: (handle: FileSystemDirectoryHandle) => void;
  settingsModal: React.ReactNode;
  openSettings: () => void;
}

export function LoadingScreen(props: LoadingScreenProps) {
  useInterfaceLanguage();
  const {
    loadError,
    folderShortcutHint,
    handleOpenFolder,
    recentMenuRef,
    recentMenuOpen,
    setRecentMenuOpen,
    recentFolders,
    handleOpenRecentFolder,
    settingsModal,
    openSettings,
  } = props;

  return (
    <main className="loading-screen">
      <section className="welcome-content" aria-label={msg('LoadingScreen.m0544')}>
      <img className="brand-mark" src="/ripple-icon.svg?v=transparent-2" alt="" width={108} height={108} />
      <div className="welcome-identity"><h1>Ripple</h1><p>{msg('LoadingScreen.m0545')}</p></div>
      {loadError && <p className="welcome-error" role="alert">{uiMessage(loadError)} <CopyProblem operation="open" /></p>}
      <div className="welcome">
        <button
          type="button"
          className="welcome-card welcome-card--primary"
          onClick={() => void handleOpenFolder()}
          data-tip={msg('LoadingScreen.m0546', { v0: folderShortcutHint })}
          data-tip-pos="top"
        >
          <svg
            className="welcome-card__icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          <span className="welcome-card__label">{msg('LoadingScreen.m0547')}</span>
        </button>

        <div className="recent-dock" ref={recentMenuRef}>
          <button
            type="button"
            className="recent-dock__btn"
            data-tip={msg('LoadingScreen.m0548')}
            aria-label={msg('LoadingScreen.m0549')}
            aria-expanded={recentMenuOpen}
            aria-haspopup="menu"
            onClick={() => setRecentMenuOpen((open) => !open)}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </button>
          {recentMenuOpen && (
            <div className="recent-pop" role="menu">
              {recentFolders.length === 0 ? (
                <p className="recent-pop__empty">{msg('LoadingScreen.m0550')}</p>
              ) : (
                <ul className="recent-pop__list">
                  {recentFolders.map((h) => (
                    <li key={h.name}>
                      <button
                        type="button"
                        onClick={() => {
                          setRecentMenuOpen(false);
                          void handleOpenRecentFolder(h);
                        }}
                      >
                        <svg
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
                        <span className="recent-pop__name">{h.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
      </section>
      <footer className="welcome-footer">
        <span>{msg('LoadingScreen.m0551')}</span>
        <button type="button" onClick={openSettings}>{msg('LoadingScreen.m0552')}</button>
      </footer>
      {settingsModal}
    </main>
  );
}
