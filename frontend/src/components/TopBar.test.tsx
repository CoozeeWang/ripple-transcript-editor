// @vitest-environment jsdom
import { useRef, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Topbar, type TopbarProps } from './Topbar';
import { msg, setInterfaceLanguage } from '../i18n';
import { useDismissable } from '../useDismissable';
afterEach(()=>{cleanup();setInterfaceLanguage('zh-CN');});
function Fixture({ exportAs = vi.fn(), onReturnToProjects, navigationDisabled, scopes=false, visibleCount=3, projectFiles,aiActionHint,handleSave=vi.fn() }: {aiActionHint?:string;handleSave?:()=>void;scopes?:boolean;visibleCount?:number;projectFiles?:()=>void;exportAs?: TopbarProps['exportAs']; onReturnToProjects?: () => void; navigationDisabled?: boolean}) {
 const [open,setOpen]=useState(false);const[scope,setScope]=useState<'full'|'visible'>('full');const ref=useRef<HTMLDivElement>(null);
 useDismissable(ref,open,()=>setOpen(false));
 const otherRef=useRef<HTMLDivElement>(null);const inputRef=useRef<HTMLInputElement>(null);
 const noop=()=>{};
 return <><textarea aria-label="正文" onKeyDown={e=>{if(e.key==='e'&&e.metaKey){e.preventDefault();setOpen(true);}}}/><Topbar
 onReturnToProjects={onReturnToProjects} navigationDisabled={navigationDisabled} audioFilename="合成文稿" dirHandle={null} handleOpenFolder={noop} folderShortcutHint="" openMenuOpen={false} setOpenMenuOpen={noop} openMenuRef={otherRef} recentFolders={[]} handleOpenRecentFolder={noop} importInputRef={inputRef} handleTranscriptFile={noop} selectedAudio={null} loadAudio={noop} audioFiles={[]} viewingOriginal={false} performUndo={noop} performRedo={noop} canUndo={false} canRedo={false} setFindOpen={noop} exportMenuOpen={open} setExportMenuOpen={setOpen} exportMenuRef={ref} exportAs={exportAs} exportScope={scope} setExportScope={scopes?setScope:undefined} visibleCount={visibleCount} exportProjectFiles={projectFiles} aiActionHint={aiActionHint} handleSave={handleSave} openSettings={noop}/></>;
}
it('enters the menu, navigates enabled formats and returns to the shortcut opener',()=>{
 render(<Fixture/>);const editor=screen.getByRole('textbox',{name:'正文'});editor.focus();fireEvent.keyDown(editor,{key:'e',metaKey:true});
 const word=screen.getByRole('menuitemradio',{name:'Word'});expect(document.activeElement).toBe(word);
 fireEvent.keyDown(word,{key:'End'});expect(document.activeElement).toBe(screen.getByRole('menuitem',{name:'导出'}));
 fireEvent.keyDown(document.activeElement!,{key:'ArrowUp'});expect(document.activeElement).toBe(screen.getByRole('menuitemradio',{name:'Markdown'}));
 fireEvent.keyDown(document.activeElement!,{key:'Home'});expect(document.activeElement).toBe(word);
 fireEvent.keyDown(word,{key:'ArrowUp'});expect(document.activeElement).toBe(screen.getByRole('menuitem',{name:'导出'}));
 fireEvent.keyDown(document.activeElement!,{key:'Escape'});expect(screen.queryByRole('menu')).toBeNull();expect(document.activeElement).toBe(editor);
});
it('opens with ArrowDown from the trigger and closes after choosing a format',()=>{
 const globalKey=vi.fn();window.addEventListener('keydown',globalKey);
 const exportAs=vi.fn();render(<Fixture exportAs={exportAs}/>);const trigger=screen.getByRole('button',{name:'导出'});trigger.focus();fireEvent.keyDown(trigger,{key:'ArrowDown'});
 expect(globalKey).not.toHaveBeenCalled();window.removeEventListener('keydown',globalKey);
 fireEvent.click(screen.getByRole('menuitemradio',{name:'纯文本'}));expect(exportAs).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('menuitem',{name:'导出'}));expect(exportAs).toHaveBeenCalledWith('txt',{tags:true,highlights:false,annotations:true});expect(screen.queryByRole('menu')).toBeNull();expect(document.activeElement).toBe(trigger);
});

it('uses the guarded project return action from the brand and respects navigation locks',()=>{
 const back=vi.fn();const view=render(<Fixture onReturnToProjects={back}/>);
 fireEvent.click(screen.getByRole('button',{name:"Ripple，返回项目"}));expect(back).toHaveBeenCalledTimes(1);
 view.rerender(<Fixture onReturnToProjects={back} navigationDisabled/>);
 fireEvent.click(screen.getByRole('button',{name:"Ripple，返回项目"}));expect(back).toHaveBeenCalledTimes(1);
});

it('replaces the two scope choices with formats, supports Back and separates other project files',()=>{
 const exported=vi.fn(),project=vi.fn();render(<Fixture scopes exportAs={exported} projectFiles={project}/>);fireEvent.click(screen.getByRole('button',{name:'导出'}));expect(screen.getAllByRole('menuitem')).toHaveLength(2);expect(screen.queryByRole('menuitemradio',{name:'Word'})).toBeNull();fireEvent.click(screen.getByRole('menuitem',{name:'导出当前显示片段（3 个片段）'}));expect(screen.queryByRole('menuitem',{name:'导出完整转录稿'})).toBeNull();expect(screen.getByRole('menuitemradio',{name:'Word'})).toBeTruthy();expect(document.querySelector('[role="separator"]')).toBeTruthy();fireEvent.click(screen.getByRole('menuitem',{name:'返回上一步'}));expect(screen.getAllByRole('menuitem')).toHaveLength(2);fireEvent.click(screen.getByRole('menuitem',{name:'导出完整转录稿'}));fireEvent.click(screen.getByRole('menuitem',{name:'导出项目中的其他文件'}));expect(project).toHaveBeenCalledOnce();expect(exported).not.toHaveBeenCalled();
});
it('disables zero displayed results rather than silently falling back to a full export',()=>{
 const exported=vi.fn();render(<Fixture scopes visibleCount={0} exportAs={exported}/>);fireEvent.click(screen.getByRole('button',{name:'导出'}));const empty=screen.getByRole('menuitem',{name:'导出当前显示片段（0 个片段）'});expect((empty as HTMLButtonElement).disabled).toBe(true);fireEvent.click(empty);expect(screen.queryByRole('menuitemradio',{name:'Word'})).toBeNull();expect(exported).not.toHaveBeenCalled();
});
it('presents Back as lightweight navigation with a noninteractive range label, keeping format keyboard navigation',()=>{
 render(<Fixture scopes/>);fireEvent.click(screen.getByRole('button',{name:'导出'}));fireEvent.click(screen.getByRole('menuitem',{name:'导出当前显示片段（3 个片段）'}));const back=screen.getByRole('menuitem',{name:'返回上一步'});expect(back.className).toBe('export-step-back');expect(document.querySelector('.export-step-scope')?.textContent).toBe('当前显示片段（3 个）');expect(document.activeElement).toBe(back);fireEvent.keyDown(back,{key:'ArrowDown'});expect(document.activeElement).toBe(screen.getByRole('menuitemradio',{name:'Word'}));fireEvent.keyDown(document.activeElement!,{key:'Home'});fireEvent.click(back);expect(screen.getByRole('menuitem',{name:'导出完整转录稿'})).toBe(document.activeElement);
});
it('disables save and all export entry points while the current AI request owns the version',()=>{
 const exportAs=vi.fn(),handleSave=vi.fn();const {rerender}=render(<Fixture exportAs={exportAs} handleSave={handleSave} aiActionHint="Synthetic request must stop first"/>);
 const trigger=screen.getByRole('button',{name:'导出'}),save=screen.getByRole('button',{name:'保存当前转录稿'});
 expect(trigger).toHaveProperty('disabled',true);expect(save).toHaveProperty('disabled',true);
 expect(save.getAttribute('aria-description')).toBe('Synthetic request must stop first');
 fireEvent.click(save);fireEvent.click(trigger);fireEvent.keyDown(trigger,{key:'ArrowDown'});expect(screen.queryByRole('menu')).toBeNull();expect(handleSave).not.toHaveBeenCalled();expect(exportAs).not.toHaveBeenCalled();
 rerender(<Fixture exportAs={exportAs} handleSave={handleSave}/>);fireEvent.click(screen.getByRole('button',{name:'保存当前转录稿'}));expect(handleSave).toHaveBeenCalledTimes(1);fireEvent.click(screen.getByRole('button',{name:'导出'}));expect(screen.getByRole('menu')).toBeTruthy();
});
it('retains independent supported marking selections by format across reopening',()=>{
 const exported=vi.fn();render(<Fixture exportAs={exported}/>);fireEvent.click(screen.getByRole('button',{name:'导出'}));
 expect(screen.getAllByRole('menuitemcheckbox')).toHaveLength(3);fireEvent.click(screen.getByRole('menuitemcheckbox',{name:'标签'}));
 fireEvent.click(screen.getByRole('menuitemradio',{name:'纯文本'}));expect(screen.getAllByRole('menuitemcheckbox')).toHaveLength(2);fireEvent.click(screen.getByRole('menuitemcheckbox',{name:'批注'}));
 fireEvent.click(screen.getByRole('menuitemradio',{name:'Word'}));expect(screen.getByRole('menuitemcheckbox',{name:'标签'})).toHaveProperty('checked',false);expect(screen.getByRole('menuitemcheckbox',{name:'高亮'})).toHaveProperty('checked',true);
 fireEvent.keyDown(screen.getByRole('menuitemradio',{name:'Word'}),{key:'Escape'});fireEvent.click(screen.getByRole('button',{name:'导出'}));expect(screen.getByRole('menuitemcheckbox',{name:'标签'})).toHaveProperty('checked',false);
 fireEvent.click(screen.getByRole('menuitemradio',{name:'纯文本'}));fireEvent.click(screen.getByRole('menuitem',{name:'导出'}));expect(exported).toHaveBeenCalledWith('txt',{tags:true,highlights:false,annotations:false});
});

it.each(['zh-CN','zh-TW','en'] as const)('offers only supported formats after AI protection ends (%s)', language=>{
 setInterfaceLanguage(language);
 const view=render(<Fixture aiActionHint={msg('aiEditing.inUse')}/>);
 const trigger=document.querySelector<HTMLButtonElement>('.export-menu > button')!;
 expect(trigger.disabled).toBe(true);
 view.rerender(<Fixture/>);
 fireEvent.click(trigger);
 expect(screen.getAllByRole('menuitemradio')).toHaveLength(5);
 expect(screen.queryByRole('menuitemradio',{name:'SRT'})).toBeNull();
 expect(screen.queryByRole('menuitemradio',{name:'VTT'})).toBeNull();
 expect(screen.getByRole('menuitemradio',{name:'Word'})).toHaveProperty('disabled',false);
});
