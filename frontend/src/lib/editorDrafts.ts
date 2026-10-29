import { flushSync } from "react-dom";

const composing = new Set<EventTarget>();
export function installEditorCompositionTracking() {
  const start = (event: CompositionEvent) => { if (event.target) composing.add(event.target); };
  const end = (event: CompositionEvent) => { if (event.target) composing.delete(event.target); };
  document.addEventListener('compositionstart', start, true);
  document.addEventListener('compositionend', end, true);
  return () => { document.removeEventListener('compositionstart', start, true); document.removeEventListener('compositionend', end, true); composing.clear(); };
}
export function isEditorComposing() {
  return [...composing].some(target => target instanceof Node && target.isConnected);
}
export function assertEditorReadyForAI() {
  for (const target of composing) if (target instanceof Node && target.isConnected) throw Error('finish_composition_before_ai_editing');
  flushEditorDrafts();
}

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

// Inputs requiring explicit submission must not be auto-saved as transcript edits.
const pendingInputs = new Set<() => boolean>();
export function registerPendingInput(isPending: () => boolean) {
  pendingInputs.add(isPending);
  return () => { pendingInputs.delete(isPending); };
}
export function hasPendingInputs() { return [...pendingInputs].some(isPending => isPending()); }
