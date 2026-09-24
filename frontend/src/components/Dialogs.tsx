import { keys } from '../lib/format';
import { msg, uiMessage, useInterfaceLanguage } from '../i18n';
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { trapDialogFocus, useDialogEntryFocus } from '../lib/dialogFocus';

import type { DeletePrompt } from "../hooks/useVersions";
import type { MatchPrompt } from "../hooks/useImport";
import type { MergePrompt } from "../hooks/useEditor";

/* 四个独立浮层：合并说话人确认、为转录命名、永久删除确认、转录-音频匹配。
 * 每个都是纯展示 + 回调注入，不持有任何跨领域状态。 */

export interface MergeDialogProps {
  prompt: MergePrompt;
  dialogRef: RefObject<HTMLDivElement | null>;
  setPrompt: Dispatch<SetStateAction<MergePrompt | null>>;
  confirmMerge: () => void;
}

export function MergeDialog({ prompt, dialogRef, setPrompt, confirmMerge }: MergeDialogProps) {
  useInterfaceLanguage();
  useDialogEntryFocus(dialogRef);
  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="interview-dialog merge-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="merge-dialog-title"
        onKeyDown={trapDialogFocus}
      >
        <header className="dialog-header">
          <div>
            <p className="section-label">{msg('Dialogs.m0461')}</p>
            <h2 id="merge-dialog-title">
              {prompt.trigger === "rename" ? msg('Dialogs.m0462') : msg('Dialogs.m0463')}
            </h2>
          </div>
          <button type="button" onClick={() => setPrompt(null)} aria-label={msg('Dialogs.m0464')}>×</button>
        </header>
        <p className="merge-prompt-text">
          {msg(prompt.trigger === "rename" ? 'extra.mergeRename' : 'extra.merge', { source: prompt.sourceName, target: prompt.targetName })}
        </p>
        <footer className="dialog-actions">
          <button data-dialog-initial-focus className="button button--secondary" type="button" onClick={() => setPrompt(null)}>
            {msg('Dialogs.m0474')}</button>
          <button className="button button--primary" type="button" onClick={confirmMerge}>
            {msg('Dialogs.m0475')}</button>
        </footer>
      </section>
    </div>
  );
}

export interface NamingModalProps {
  value: string;
  error: string | null;
  setError: Dispatch<SetStateAction<string | null>>;
  busy: boolean;
  repairs: string[];
  setRepairs: (repairs: string[]) => void;
  modalRef: RefObject<HTMLDivElement | null>;
  setOpen: (open: boolean) => void;
  confirmNaming: (value: string) => void;
}

export function NamingModal(props: NamingModalProps) {
  useInterfaceLanguage();
  const {
    value,
    error,
    setError,
    busy,
    repairs,
    setRepairs,
    modalRef,
    setOpen,
    confirmNaming,
  } = props;
  const [draft, setDraft] = useState(value);
  const titleId=useId();
  useDialogEntryFocus(modalRef);

  return (
    <div className="overlay">
      <div
        ref={modalRef}
        className="naming-modal"
        onKeyDown={trapDialogFocus}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h3 id={titleId}>{msg('Dialogs.m0476')}</h3>
        <input
          aria-label={msg('Dialogs.m0477')}
          data-dialog-initial-focus
          type="text"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229 && !busy) void confirmNaming(draft);
          }}
        />
        {repairs.length > 0 && (
          <div className="naming-modal__repairs">
            <p>{msg('Dialogs.m0478')}</p>
            <ul>
              {repairs.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}
        {error && <p className="naming-modal__error" role="alert">{uiMessage(error)}</p>}
        <div className="modal-actions">
          <button type="button" onClick={() => void confirmNaming(draft)} disabled={busy}>
            {busy ? msg('Dialogs.m0479') : msg('Dialogs.m0480')}
          </button>
          <button
            type="button"
            onClick={() => {
              setRepairs([]);
              setError("");
              setOpen(false);
            }}
          >
            {msg('Dialogs.m0481')}</button>
        </div>
      </div>
    </div>
  );
}

export interface DeleteDialogProps {
  prompt: DeletePrompt;
  dialogRef: RefObject<HTMLDivElement | null>;
  setPrompt: (prompt: DeletePrompt | null) => void;
  confirmDelete: () => void;
}

export function DeleteDialog({ prompt, dialogRef, setPrompt, confirmDelete }: DeleteDialogProps) {
  useInterfaceLanguage();
  const titleId=useId();
  const cancelRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    const previous=document.activeElement;
    cancelRef.current?.focus();
    return ()=>{if(previous instanceof HTMLElement && previous.isConnected)previous.focus();};
  },[]);
  return (
    <div className="overlay" onClick={() => setPrompt(null)}>
      <div
        ref={dialogRef}
        className="delete-modal"
        onKeyDown={trapDialogFocus}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h3 id={titleId}>
          {prompt.kind === "original"
            ? msg('Dialogs.m0482', { v0: prompt.label })
            : prompt.isLast
              ? msg('Dialogs.m0483', { v0: prompt.label })
              : msg('Dialogs.m0484', { v0: prompt.label })}
        </h3>
        {prompt.kind === "original" ? (
          <>
            <p className="delete-modal__warn">
              {msg('Dialogs.m0485')}</p>
            {prompt.isLast && (
              <p className="delete-modal__warn">
                {msg('Dialogs.m0486')}</p>
            )}
          </>
        ) : prompt.isLast ? (
          <p className="delete-modal__warn">
            {msg('Dialogs.m0487')}</p>
        ) : (
          <p className="delete-modal__warn">{msg('Dialogs.m0488')}</p>
        )}
        <p className="delete-modal__hint">{msg('extra.deleteBackup', { key: keys('E') })}</p>
        <div className="modal-actions">
          <button type="button" className="delete-modal__danger" onClick={() => void confirmDelete()}>
            {msg('Dialogs.m0490')}</button>
          <button ref={cancelRef} type="button" onClick={() => setPrompt(null)}>
            {msg('Dialogs.m0491')}</button>
        </div>
      </div>
    </div>
  );
}

export interface MatchDialogProps {
  prompt: MatchPrompt;
  dialogRef: RefObject<HTMLDivElement | null>;
  setPrompt: Dispatch<SetStateAction<MatchPrompt | null>>;
  finishImport: (choice: string, transcript: import("../types").Transcript) => void;
  confirmMatch: () => void;
}

export function MatchDialog({ prompt, dialogRef, setPrompt, finishImport, confirmMatch }: MatchDialogProps) {
  useInterfaceLanguage();
  const titleId=useId();
  useDialogEntryFocus(dialogRef);
  return (
    <div className="overlay" onClick={() => setPrompt(null)}>
      <div
        ref={dialogRef}
        className="match-modal"
        onKeyDown={trapDialogFocus}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h3 id={titleId}>{prompt.warning ? msg('Dialogs.m0492') : msg('Dialogs.m0493')}</h3>
        {!prompt.warning && (
          <p className="match-modal__hint">
            {prompt.target
              ? msg('Dialogs.m0494', { v0: prompt.sourceName, v1: prompt.target })
              : msg('Dialogs.m0495', { v0: prompt.sourceName })}
          </p>
        )}
        <ul className="match-list">
          {prompt.candidates.map((name) => (
            <li key={name}>
              <button
                type="button"
                className={"match-item" + (name === prompt.choice ? " match-item--active" : "")}
                aria-pressed={name === prompt.choice}
                onClick={() =>
                  setPrompt((prev) => (prev ? { ...prev, choice: name, warning: null } : prev))
                }
              >
                <span className="match-item__radio" aria-hidden="true" />
                <span className="match-item__name">{name}</span>
              </button>
            </li>
          ))}
        </ul>
        {prompt.warning && <p className="match-modal__warning" role="alert">{prompt.warning}</p>}
        <div className="modal-actions">
          {prompt.warning ? (
            <>
              <button
                type="button"
                onClick={() => {
                  const { transcript, choice } = prompt;
                  setPrompt(null);
                  void finishImport(choice, transcript);
                }}
              >
                {msg('Dialogs.m0496')}</button>
              <button data-dialog-initial-focus type="button" onClick={() => setPrompt((prev) => (prev ? { ...prev, warning: null } : prev))}>
                {msg('Dialogs.m0497')}</button>
            </>
          ) : (
            <>
              <button type="button" disabled={prompt.checking} onClick={() => void confirmMatch()}>
                {prompt.checking ? msg('Dialogs.m0498') : msg('Dialogs.m0499')}
              </button>
              <button data-dialog-initial-focus type="button" onClick={() => setPrompt(null)}>
                {msg('Dialogs.m0500')}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
