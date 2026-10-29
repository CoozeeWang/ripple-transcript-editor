// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AnnotationAddBox } from './AnnotationCard';
import { hasPendingInputs, hasEditorDrafts, installEditorCompositionTracking, isEditorComposing } from '../lib/editorDrafts';
afterEach(cleanup);
it('keeps unsubmitted annotations separate from auto-save and protects hidden per-segment drafts',()=>{
 const ui=render(<AnnotationAddBox draftKey="a" onSubmit={vi.fn()}/>);
 fireEvent.change(ui.getByRole('textbox'),{target:{value:'Synthetic draft'}});
 expect(hasPendingInputs()).toBe(true);expect(hasEditorDrafts()).toBe(false);
 ui.rerender(<AnnotationAddBox draftKey="b" onSubmit={vi.fn()}/>);
 expect(hasPendingInputs()).toBe(true);
 ui.rerender(<AnnotationAddBox draftKey="a" onSubmit={vi.fn()}/>);
 fireEvent.click(ui.getByRole('button'));
 expect(hasPendingInputs()).toBe(false);
 ui.unmount();expect(hasPendingInputs()).toBe(false);
});
it('detects active composition but does not retain detached editors',()=>{
 const dispose=installEditorCompositionTracking();const ui=render(<textarea aria-label="Synthetic input"/>);const input=ui.getByRole('textbox');
 fireEvent.compositionStart(input);expect(isEditorComposing()).toBe(true);
 fireEvent.compositionEnd(input);expect(isEditorComposing()).toBe(false);
 fireEvent.compositionStart(input);ui.unmount();expect(isEditorComposing()).toBe(false);dispose();
});
