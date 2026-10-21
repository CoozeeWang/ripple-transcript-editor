import { msg, useInterfaceLanguage } from '../i18n';
import { registerEditorDraft } from "../lib/editorDrafts";
import { useEffect, useState } from "react";
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
  return (
    <div className={`annotation-card${isCurrent ? " annotation-card--current" : ""}`} data-current={isCurrent ? "true" : undefined}
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
        onBlur={() => {
          setEditing(false);
          if (draft.trim() !== annotation.text.trim()) onCommit(draft.trim());
        }}
        rows={2}
      /> : <div className="annotation-text annotation-text--readonly" title={msg(readOnly ? 'AnnotationCard.readOnly' : 'AnnotationCard.m0317')}>{annotation.text}</div>}
      <div className="annotation-card-actions">
        <span className="annotation-time">{formatRelativeTime(annotation.createdAt)}</span>
        <button type="button" className="annotation-delete" disabled={readOnly} onClick={(event) => { event.stopPropagation(); onDelete(); }} data-tip={msg('AnnotationCard.m0318')}>
          {msg('AnnotationCard.m0319')}</button>
      </div>
    </div>
  );
}

export function AnnotationAddBox({ onSubmit, disabled = false }: { onSubmit: (text: string) => void; disabled?: boolean }) {
  useInterfaceLanguage();
  const [draft, setDraft] = useState("");
  const submit = () => {
    const text = draft.trim();
    if (disabled || !text) return;
    onSubmit(text);
    setDraft("");
  };
  return (
    <div className="annotation-add">
      <textarea
        disabled={disabled}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={msg('AnnotationCard.m0320')}
        aria-label={msg('AnnotationCard.m0321')}
        data-tip={msg('AnnotationCard.m0322', { v0: keys("↵") })}
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
