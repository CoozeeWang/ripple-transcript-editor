// @vitest-environment jsdom
import { useRef, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Topbar, type TopbarProps } from './Topbar';
import { useDismissable } from '../useDismissable';
afterEach(cleanup);
function Fixture({ exportAs = vi.fn(), onReturnToProjects, navigationDisabled }: {exportAs?: TopbarProps['exportAs']; onReturnToProjects?: () => void; navigationDisabled?: boolean}) {
 const [open,setOpen]=useState(false);const ref=useRef<HTMLDivElement>(null);
 useDismissable(ref,open,()=>setOpen(false));
 const otherRef=useRef<HTMLDivElement>(null);const inputRef=useRef<HTMLInputElement>(null);
 const noop=()=>{};
 return <><textarea aria-label="正文" onKeyDown={e=>{if(e.key==='e'&&e.metaKey){e.preventDefault();setOpen(true);}}}/><Topbar
 onReturnToProjects={onReturnToProjects} navigationDisabled={navigationDisabled} audioFilename="合成文稿" dirHandle={null} handleOpenFolder={noop} folderShortcutHint="" openMenuOpen={false} setOpenMenuOpen={noop} openMenuRef={otherRef} recentFolders={[]} handleOpenRecentFolder={noop} importInputRef={inputRef} handleTranscriptFile={noop} selectedAudio={null} loadAudio={noop} audioFiles={[]} viewingOriginal={false} performUndo={noop} performRedo={noop} canUndo={false} canRedo={false} setFindOpen={noop} exportMenuOpen={open} setExportMenuOpen={setOpen} exportMenuRef={ref} exportAs={exportAs} subtitlesAvailable={false} handleSave={noop} openSettings={noop}/></>;
}
it('enters the menu, navigates enabled formats and returns to the shortcut opener',()=>{
 render(<Fixture/>);const editor=screen.getByRole('textbox',{name:'正文'});editor.focus();fireEvent.keyDown(editor,{key:'e',metaKey:true});
 const word=screen.getByRole('menuitem',{name:'Word（.docx）'});expect(document.activeElement).toBe(word);
 fireEvent.keyDown(word,{key:'End'});expect(document.activeElement).toBe(screen.getByRole('menuitem',{name:'Markdown（.md）'}));
 fireEvent.keyDown(document.activeElement!,{key:'ArrowUp'});expect(document.activeElement).toBe(screen.getByRole('menuitem',{name:'JSON（.json）'}));
 fireEvent.keyDown(document.activeElement!,{key:'Home'});expect(document.activeElement).toBe(word);
 fireEvent.keyDown(word,{key:'ArrowUp'});expect(document.activeElement).toBe(screen.getByRole('menuitem',{name:'Markdown（.md）'}));
 fireEvent.keyDown(document.activeElement!,{key:'Escape'});expect(screen.queryByRole('menu')).toBeNull();expect(document.activeElement).toBe(editor);
});
it('opens with ArrowDown from the trigger and closes after choosing a format',()=>{
 const globalKey=vi.fn();window.addEventListener('keydown',globalKey);
 const exportAs=vi.fn();render(<Fixture exportAs={exportAs}/>);const trigger=screen.getByRole('button',{name:'导出'});trigger.focus();fireEvent.keyDown(trigger,{key:'ArrowDown'});
 expect(globalKey).not.toHaveBeenCalled();window.removeEventListener('keydown',globalKey);
 fireEvent.click(screen.getByRole('menuitem',{name:'纯文本（.txt）'}));expect(exportAs).toHaveBeenCalledWith('txt');expect(screen.queryByRole('menu')).toBeNull();expect(document.activeElement).toBe(trigger);
});

it('uses the guarded project return action from the brand and respects navigation locks',()=>{
 const back=vi.fn();const view=render(<Fixture onReturnToProjects={back}/>);
 fireEvent.click(screen.getByRole('button',{name:"Ripple，返回项目"}));expect(back).toHaveBeenCalledTimes(1);
 view.rerender(<Fixture onReturnToProjects={back} navigationDisabled/>);
 fireEvent.click(screen.getByRole('button',{name:"Ripple，返回项目"}));expect(back).toHaveBeenCalledTimes(1);
});
