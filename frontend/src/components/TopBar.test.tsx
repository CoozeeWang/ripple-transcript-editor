// @vitest-environment jsdom
import { useRef, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Topbar, type TopbarProps } from './Topbar';
import { useDismissable } from '../useDismissable';
afterEach(cleanup);
function Fixture({ exportAs = vi.fn(), onReturnToProjects, navigationDisabled, scopes=false, visibleCount=3, projectFiles }: {scopes?:boolean;visibleCount?:number;projectFiles?:()=>void;exportAs?: TopbarProps['exportAs']; onReturnToProjects?: () => void; navigationDisabled?: boolean}) {
 const [open,setOpen]=useState(false);const[scope,setScope]=useState<'full'|'visible'>('full');const ref=useRef<HTMLDivElement>(null);
 useDismissable(ref,open,()=>setOpen(false));
 const otherRef=useRef<HTMLDivElement>(null);const inputRef=useRef<HTMLInputElement>(null);
 const noop=()=>{};
 return <><textarea aria-label="正文" onKeyDown={e=>{if(e.key==='e'&&e.metaKey){e.preventDefault();setOpen(true);}}}/><Topbar
 onReturnToProjects={onReturnToProjects} navigationDisabled={navigationDisabled} audioFilename="合成文稿" dirHandle={null} handleOpenFolder={noop} folderShortcutHint="" openMenuOpen={false} setOpenMenuOpen={noop} openMenuRef={otherRef} recentFolders={[]} handleOpenRecentFolder={noop} importInputRef={inputRef} handleTranscriptFile={noop} selectedAudio={null} loadAudio={noop} audioFiles={[]} viewingOriginal={false} performUndo={noop} performRedo={noop} canUndo={false} canRedo={false} setFindOpen={noop} exportMenuOpen={open} setExportMenuOpen={setOpen} exportMenuRef={ref} exportAs={exportAs} exportScope={scope} setExportScope={scopes?setScope:undefined} visibleCount={visibleCount} exportProjectFiles={projectFiles} subtitlesAvailable={false} handleSave={noop} openSettings={noop}/></>;
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

it('replaces the two scope choices with formats, supports Back and separates other project files',()=>{
 const exported=vi.fn(),project=vi.fn();render(<Fixture scopes exportAs={exported} projectFiles={project}/>);fireEvent.click(screen.getByRole('button',{name:'导出'}));expect(screen.getAllByRole('menuitem')).toHaveLength(2);expect(screen.queryByRole('menuitem',{name:'Word（.docx）'})).toBeNull();fireEvent.click(screen.getByRole('menuitem',{name:'导出当前显示片段（3 个片段）'}));expect(screen.queryByRole('menuitem',{name:'导出完整转录稿'})).toBeNull();expect(screen.getByRole('menuitem',{name:'Word（.docx）'})).toBeTruthy();expect(document.querySelector('[role="separator"]')).toBeTruthy();fireEvent.click(screen.getByRole('menuitem',{name:'返回上一步'}));expect(screen.getAllByRole('menuitem')).toHaveLength(2);fireEvent.click(screen.getByRole('menuitem',{name:'导出完整转录稿'}));fireEvent.click(screen.getByRole('menuitem',{name:'导出项目中的其他文件'}));expect(project).toHaveBeenCalledOnce();expect(exported).not.toHaveBeenCalled();
});
it('disables zero displayed results rather than silently falling back to a full export',()=>{
 const exported=vi.fn();render(<Fixture scopes visibleCount={0} exportAs={exported}/>);fireEvent.click(screen.getByRole('button',{name:'导出'}));const empty=screen.getByRole('menuitem',{name:'导出当前显示片段（0 个片段）'});expect((empty as HTMLButtonElement).disabled).toBe(true);fireEvent.click(empty);expect(screen.queryByRole('menuitem',{name:'Word（.docx）'})).toBeNull();expect(exported).not.toHaveBeenCalled();
});
