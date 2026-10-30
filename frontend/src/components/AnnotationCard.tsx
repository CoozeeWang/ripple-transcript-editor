import { msg, useInterfaceLanguage } from '../i18n';
import { registerEditorDraft, registerPendingInput } from "../lib/editorDrafts";
import { useEffect, useState, type ReactNode } from "react";
import type { Annotation } from "../types";
import { formatRelativeTime, keys } from "../lib/format";

interface AnnotationCardProps {
  annotation: Annotation;
  readOnly?: boolean;
  onCommit: (text: string) => void;
  onDelete: () => void;
  onJump?: () => void;
  meta?: string;
  isCurrent?: boolean;
}

export function AnnotationCard({ annotation, onCommit, onDelete, onJump, meta, isCurrent, readOnly = false }: AnnotationCardProps) {
  useInterfaceLanguage();
  const [draft, setDraft] = useState(annotation.text);
  const [editing, setEditing] = useState(false);
  if (readOnly && editing) setEditing(false);
  useEffect(() => {
    const isDirty = () => !readOnly && editing && draft.trim() !== annotation.text.trim();
    const flush = () => { if (isDirty()) onCommit(draft.trim()); };
    const unregister = registerEditorDraft(isDirty);
    window.addEventListener("te:flush-drafts", flush);
    return () => { unregister(); window.removeEventListener("te:flush-drafts", flush); };
  }, [editing, draft, annotation.text, onCommit, readOnly]);
  const commit = () => {
    if (readOnly || !editing) return;
    if (draft.trim() !== annotation.text.trim()) onCommit(draft.trim());
    setEditing(false);
  };
  return (
    <div onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) commit();
    }} className={`annotation-card${isCurrent ? " annotation-card--current" : ""}`} data-current={isCurrent ? "true" : undefined}
      tabIndex={editing ? -1 : 0}
      onClick={() => { if (!editing) onJump?.(); }}
      onDoubleClick={(event) => {
        if (readOnly || editing || (event.target as HTMLElement).closest("button")) return;
        setDraft(annotation.text); setEditing(true);
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || editing) return;
        if (event.key === "Enter") { event.preventDefault(); onJump?.(); }
        if (!readOnly && event.key === "F2") { event.preventDefault(); setDraft(annotation.text); setEditing(true); }
      }}
    >
      {(meta || annotation.source === "ai") && (
        <div className="annotation-card-meta">
          {meta && <span>{meta}</span>}
          {annotation.source === "ai" && <span className="annotation-ai-label">{msg("connector.aiAnnotation")}</span>}
        </div>
      )}
      {editing ? <textarea
        autoFocus
        aria-label={msg('AnnotationCard.m0316')}
        className="annotation-text"
        value={draft}
        onChange={(event) => { setDraft(event.target.value); window.dispatchEvent(new Event("te:draft-dirty")); }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            event.stopPropagation();
            commit();
            event.currentTarget.closest<HTMLElement>(".annotation-card")?.focus();
          }
        }}
        rows={2}
      /> : <div className="annotation-text annotation-text--readonly" data-action-tip={msg(readOnly ? 'AnnotationCard.readOnly' : 'AnnotationCard.m0317')}>{annotation.text}</div>}
      <div className="annotation-card-actions">
        <span className="annotation-time">{formatRelativeTime(annotation.createdAt)}</span>
        <span className="annotation-card-buttons">
        {editing && !readOnly && <button type="button" className="annotation-delete annotation-save"
          data-tip={msg('AnnotationCard.saveShortcut', { v0: keys("↵") })}
          onClick={(event) => { event.stopPropagation(); commit(); event.currentTarget.closest<HTMLElement>(".annotation-card")?.focus(); }}>
          {msg('AnnotationCard.save')}
        </button>}
        <button type="button" className="annotation-delete" disabled={readOnly} onClick={(event) => { event.stopPropagation(); onDelete(); }} data-tip={msg('AnnotationCard.m0318')}>
          {msg('AnnotationCard.m0319')}</button>
        </span>
      </div>
    </div>
  );
}

export function AnnotationAddBox({ onSubmit, disabled = false, draftKey = "default", children }: { onSubmit: (text: string) => void; disabled?: boolean; draftKey?: string; children?: ReactNode }) {
  useInterfaceLanguage();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  useEffect(() => registerPendingInput(() => Object.values(drafts).some(text => text.trim().length > 0)), [drafts]);
  const draft = drafts[draftKey] ?? "";
  const setDraft = (text: string) => setDrafts((previous) => ({ ...previous, [draftKey]: text }));
  const submit = () => {
    const text = draft.trim();
    if (disabled || !text) return;
    onSubmit(text);
    setDraft("");
  };
  return (
    <div className="annotation-add">
      {children}
      <textarea
        disabled={disabled}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={msg('AnnotationCard.m0320')}
        aria-label={msg('AnnotationCard.m0321')}
        data-action-tip={msg('AnnotationCard.m0322', { v0: keys("↵") })}
        data-tip-pos="top"
        rows={2}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <button
        type="button"
        className="button button--primary"
        onClick={submit}
        disabled={disabled || !draft.trim()}
      >
        {msg('AnnotationCard.m0323')}</button>
    </div>
  );
}
