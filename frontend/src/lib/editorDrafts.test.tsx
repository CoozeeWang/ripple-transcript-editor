// @vitest-environment jsdom
import { useEffect } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { flushEditorDrafts } from './editorDrafts';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('does not force a React flush when opening a document with no pending draft',()=>{
 const errors=vi.spyOn(console,'error').mockImplementation(()=>{});
 function Opening(){useEffect(()=>{flushEditorDrafts();},[]);return null;}
 render(<Opening/>);
 expect(errors.mock.calls.flat().join(' ')).not.toContain('flushSync');
});
