// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { assertEditorReadyForAI, installEditorCompositionTracking } from './editorDrafts';
it('preserves an in-progress IME draft and flushes only after composition ends', () => {
  const stop = installEditorCompositionTracking();
  const editor = document.createElement('textarea'); document.body.append(editor);
  const flushed = vi.fn(); window.addEventListener('te:flush-drafts', flushed);
  try {
    editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    expect(() => assertEditorReadyForAI()).toThrow('finish_composition'); expect(flushed).not.toHaveBeenCalled();
    editor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    assertEditorReadyForAI(); expect(flushed).toHaveBeenCalledTimes(1);
  } finally { stop(); editor.remove(); window.removeEventListener('te:flush-drafts', flushed); }
});
