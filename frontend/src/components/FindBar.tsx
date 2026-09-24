import { msg, useInterfaceLanguage } from '../i18n';
import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";

import { keys } from "../lib/format";

/** 查找与替换条（Word 风格：默认只有查找，点「替换」才展开替换行）。 */
export interface FindBarProps {
  findQuery: string;
  setFindQuery: Dispatch<SetStateAction<string>>;
  currentMatchIndex: number;
  setCurrentMatchIndex: Dispatch<SetStateAction<number>>;
  matchCount: number;
  showReplace: boolean;
  setShowReplace: Dispatch<SetStateAction<boolean>>;
  replaceValue: string;
  setReplaceValue: Dispatch<SetStateAction<string>>;
  viewingOriginal: boolean;
  setFindOpen: (open: boolean) => void;
  findNext: () => void;
  findPrev: () => void;
  replaceCurrent: (direction?: "next" | "prev") => void;
  replaceAll: () => void;
}

export function FindBar(props: FindBarProps) {
  useInterfaceLanguage();
  const barRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const bar = barRef.current;
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected &&
          (document.activeElement === document.body || bar?.contains(document.activeElement))) previous.focus();
    };
  }, []);
  const {
    findQuery,
    setFindQuery,
    currentMatchIndex,
    setCurrentMatchIndex,
    matchCount,
    showReplace,
    setShowReplace,
    replaceValue,
    setReplaceValue,
    viewingOriginal,
    setFindOpen,
    findNext,
    findPrev,
    replaceCurrent,
    replaceAll,
  } = props;

  const focusReplace = () => {
    setShowReplace(true);
    window.requestAnimationFrame(() => document.getElementById("replace-input")?.focus());
  };

  return (
    <section ref={barRef} className="find-bar" aria-label={msg('FindBar.m0524')}>
      <div className="find-bar__field find-bar__find">
        <input
          id="find-input"
          aria-label={msg('FindBar.m0525')}
          value={findQuery}
          onChange={(event) => {
            setFindQuery(event.target.value);
            setCurrentMatchIndex(-1);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "Enter") {
              event.preventDefault();
              if (event.metaKey || event.ctrlKey) {
                if (showReplace) replaceCurrent();
                else focusReplace();
              } else if (event.shiftKey) {
                // Shift+Enter：向上定位（与 Enter「下一个」对应）。
                findPrev();
              } else {
                findNext();
              }
            }
          }}
          placeholder={msg('FindBar.m0526')}
        />
        <span className="match-count" role="status">
          {findQuery
            ? msg('FindBar.m0527', { v0: matchCount, v1: currentMatchIndex >= 0 ? `（${currentMatchIndex + 1}/${matchCount}）` : "" })
            : msg('FindBar.m0528')}
        </span>
      </div>
      <button type="button" onClick={findPrev} disabled={matchCount === 0} title={msg('FindBar.m0529')}>{msg('FindBar.m0530')}</button>
      <button type="button" onClick={findNext} disabled={matchCount === 0} title={msg('FindBar.m0531')}>{msg('FindBar.m0532')}</button>
      {!viewingOriginal && !showReplace ? (
        <button type="button" onClick={focusReplace} title={msg('FindBar.m0533')}>
          {msg('FindBar.m0534')}</button>
      ) : null}
      {showReplace ? (
        <>
          <div className="find-bar__field find-bar__replace">
            <input
              id="replace-input"
              aria-label={msg('FindBar.m0535')}
              value={replaceValue}
              onChange={(event) => setReplaceValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                if (event.key === "Enter") {
                  event.preventDefault();
                  replaceCurrent();
                }
              }}
              placeholder={msg('FindBar.m0536')}
            />
          </div>
          <button type="button" onClick={() => replaceCurrent()} disabled={matchCount === 0} title={msg('FindBar.m0537', { v0: keys("↵") })}>{msg('FindBar.m0538')}</button>
          <button type="button" onClick={replaceAll} disabled={matchCount === 0}>{msg('FindBar.m0539')}</button>
        </>
      ) : null}
      <button
        className="find-close"
        type="button"
        onClick={() => {
          setFindOpen(false);
          setShowReplace(false);
        }}
        aria-label={msg('FindBar.m0540')}
      >
        ×
      </button>
    </section>
  );
}
