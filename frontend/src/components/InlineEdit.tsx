import { msg, useInterfaceLanguage } from '../i18n';
import {DateTimeInput} from "./DateTimeInput";
import {validDateTime} from "../lib/dateTime";
import { registerEditorDraft } from "../lib/editorDrafts";
import { type ReactNode, useEffect, useRef, useState } from "react";

export interface InlineEditProps {
  value: string;
  doubleClick?: boolean;
  disabled?: boolean;
  onCommit: (next: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  inputType?: string;
  multiline?: boolean;
  display?: (value: string) => ReactNode;
}

export function InlineEdit({
  value,
  doubleClick = false,
  disabled = false,
  onCommit,
  placeholder = "",
  ariaLabel,
  className = "",
  inputType = "text",
  multiline = false,
  display,
}: InlineEditProps) {
  useInterfaceLanguage();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [dateError,setDateError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const element = multiline ? textareaRef.current : inputRef.current;
    if (editing && element) {
      element.focus();
      try {
        element.setSelectionRange(0, element.value.length);
      } catch {
        // Inputs such as datetime-local do not support setSelectionRange;
        // selection is irrelevant for those types, so ignore the error.
      }
    }
  }, [editing, multiline]);

  const startEdit = () => {
    if (disabled) return;
    setDraft(value);
    setDateError(false);
    setEditing(true);
  };
  const commit = () => {
    if((inputType==="datetime-local" || inputType==="date") && !validDateTime(draft)){setDateError(true);return;}
    setEditing(false);
    if (draft !== value) onCommit(draft);
  };
  const cancel = () => {
    setEditing(false);
    setDraft(value);
  };

  useEffect(() => {
    const isDirty = () => editing && draft !== value && ((inputType!=="datetime-local" && inputType!=="date") || validDateTime(draft));
    const flush = () => { if (isDirty()) onCommit(draft); };
    const unregister = registerEditorDraft(isDirty);
    window.addEventListener("te:flush-drafts", flush);
    return () => { unregister(); window.removeEventListener("te:flush-drafts", flush); };
  }, [editing, draft, value, onCommit, inputType]);

  if (editing) {
    if((inputType==="datetime-local" || inputType==="date"))return <span className="inline-date-edit">
      <DateTimeInput includeTime={inputType!=="date"} value={draft} label={ariaLabel ?? msg('InlineEdit.m0541')} onCommit={commit} onCancel={cancel}
        onChange={next=>{setDraft(next);setDateError(false);window.dispatchEvent(new Event("te:draft-dirty"));}}/>
      {dateError && <span className="inline-date-error" role="alert">{msg('InlineEdit.m0542')}</span>}
    </span>;
    if (multiline) {
      return (
        <textarea
          ref={textareaRef}
          className="inline-edit__input"
          aria-label={ariaLabel}
          value={draft}
          rows={3}
          onChange={(event) => { setDraft(event.target.value); window.dispatchEvent(new Event("te:draft-dirty")); }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "Escape") {
              event.preventDefault();
              cancel();
            }
            event.stopPropagation();
          }}
        />
      );
    }
    return (
      <input
        ref={inputRef}
        className="inline-edit__input"
        type={inputType}
        aria-label={ariaLabel}
        value={draft}
        onChange={(event) => { setDraft(event.target.value); window.dispatchEvent(new Event("te:draft-dirty")); }}
        onBlur={commit}
        onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancel();
          }
          event.stopPropagation();
        }}
      />
    );
  }

  return (
    <span
      className={`inline-edit ${className}`}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={doubleClick ? undefined : startEdit}
      onDoubleClick={doubleClick ? startEdit : undefined}
      aria-disabled={disabled}
      title={doubleClick ? msg('InlineEdit.m0543') : undefined}
      onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          startEdit();
        }
      }}
    >
      {value ? (display ? display(value) : value) : <span className="inline-edit__placeholder">{placeholder}</span>}
    </span>
  );
}
