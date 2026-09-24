import { flushSync } from "react-dom";

/** Call at user-action boundaries before reading a transcript snapshot. */
export function flushEditorDrafts() {
  const flush = () => window.dispatchEvent(new Event("te:flush-drafts"));
  if (hasEditorDrafts()) flushSync(flush);
  else flush();
}

const editors = new Set<() => boolean>();
export function registerEditorDraft(isDirty: () => boolean) {
  editors.add(isDirty);
  return () => { editors.delete(isDirty); };
}
export function hasEditorDrafts() {
  return [...editors].some(isDirty => isDirty());
}
