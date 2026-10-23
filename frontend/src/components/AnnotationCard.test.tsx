// @vitest-environment jsdom
import {cleanup, fireEvent, render} from "@testing-library/react";
import {afterEach, expect, it, vi} from "vitest";
import {setInterfaceLanguage} from "../i18n";
import {AnnotationCard, AnnotationAddBox} from "./AnnotationCard";
afterEach(cleanup);
it("starts read-only, jumps on click, edits on double click and commits on blur",()=>{
 const onJump=vi.fn(),onCommit=vi.fn(),onDelete=vi.fn();
 const ui=render(<AnnotationCard annotation={{id:"a",text:"批注内容",createdAt:new Date().toISOString()}} onJump={onJump} onCommit={onCommit} onDelete={onDelete}/>);
 expect(ui.queryByRole("textbox")).toBeNull();
 fireEvent.click(ui.getByText("批注内容"));
 expect(onJump).toHaveBeenCalledTimes(1);
 fireEvent.doubleClick(ui.getByText("批注内容"));
 const editor=ui.getByRole("textbox");
 expect(document.activeElement).toBe(editor);
 fireEvent.click(editor);
 expect(onJump).toHaveBeenCalledTimes(1);
 fireEvent.change(editor,{target:{value:"修改后的批注"}});
 fireEvent.blur(editor);
 expect(onCommit).toHaveBeenCalledWith("修改后的批注");
 expect(ui.queryByRole("textbox")).toBeNull();
 fireEvent.click(ui.getByText("删除"));
 expect(onDelete).toHaveBeenCalledTimes(1);
 expect(onJump).toHaveBeenCalledTimes(1);
});
it('identifies AI-created annotations while ordinary notes have no AI badge', () => {
 const note={id:'ai',text:'合成分析',createdAt:'2026-01-01',source:'ai' as const};
 const ui=render(<AnnotationCard annotation={note} onCommit={vi.fn()} onDelete={vi.fn()} />);
 expect(ui.getByText('AI 批注')).toBeTruthy();
 ui.rerender(<AnnotationCard annotation={{...note,source:undefined}} onCommit={vi.fn()} onDelete={vi.fn()} />);
 expect(ui.queryByText('AI 批注')).toBeNull();
});

it('keeps an original annotation readable and navigable while blocking edits',()=>{
 const onJump=vi.fn(),onCommit=vi.fn(),onDelete=vi.fn(),onSubmit=vi.fn();
 const ui=render(<><AnnotationCard readOnly annotation={{id:'synthetic',text:'Synthetic original annotation',createdAt:'2026-01-01'}} onJump={onJump} onCommit={onCommit} onDelete={onDelete}/><AnnotationAddBox disabled onSubmit={onSubmit}/></>);
 const text=ui.getByText('Synthetic original annotation');
 fireEvent.click(text);expect(onJump).toHaveBeenCalledOnce();
 fireEvent.doubleClick(text);fireEvent.keyDown(text.closest('.annotation-card')!,{key:'F2'});
 expect(ui.queryByRole('textbox',{name:'编辑批注'})).toBeNull();
 expect((ui.getByRole('button',{name:'删除'}) as HTMLButtonElement).disabled).toBe(true);
 expect((ui.getByRole('textbox',{name:'给当前片段添加批注'}) as HTMLTextAreaElement).disabled).toBe(true);
 fireEvent.click(ui.getByRole('button',{name:'删除'}));
 fireEvent.keyDown(ui.getByRole('textbox',{name:'给当前片段添加批注'}),{key:'Enter',metaKey:true});
 expect(onCommit).not.toHaveBeenCalled();expect(onDelete).not.toHaveBeenCalled();expect(onSubmit).not.toHaveBeenCalled();
});

it.each(['metaKey', 'ctrlKey'])('saves edits once with %s+Enter and ignores composition', (modifier) => {
 const commit=vi.fn();
 const ui=render(<AnnotationCard annotation={{id:'a',text:'Before',createdAt:'2026-01-01'}} onCommit={commit} onDelete={vi.fn()}/>);
 fireEvent.doubleClick(ui.getByText('Before'));
 const editor=ui.getByRole('textbox');
 fireEvent.change(editor,{target:{value:'After'}});
 fireEvent.keyDown(editor,{key:'Enter',[modifier]:true,isComposing:true});
 expect(commit).not.toHaveBeenCalled();
 fireEvent.keyDown(editor,{key:'Enter',[modifier]:true});
 expect(commit).toHaveBeenCalledExactlyOnceWith('After');
 expect(ui.queryByRole('textbox')).toBeNull();
 expect(document.activeElement).toBe(ui.container.querySelector('.annotation-card'));
});

it('allows keyboard focus on Save without prematurely closing the editor', () => {
 const commit=vi.fn(), jump=vi.fn();
 const ui=render(<AnnotationCard annotation={{id:'a',text:'Before',createdAt:'2026-01-01'}} onCommit={commit} onDelete={vi.fn()} onJump={jump}/>);
 fireEvent.doubleClick(ui.getByText('Before'));
 const editor=ui.getByRole('textbox'), save=ui.getByRole('button',{name:'保存'});
 fireEvent.change(editor,{target:{value:'After'}});
 fireEvent.blur(editor,{relatedTarget:save});
 expect(commit).not.toHaveBeenCalled();
 fireEvent.click(save);
 expect(commit).toHaveBeenCalledExactlyOnceWith('After');
 expect(jump).not.toHaveBeenCalled();
});

it.each([['zh-CN','保存'],['zh-TW','儲存'],['en','Save']] as const)('exposes Save in %s and leaves plain Enter as a newline', async (language, label) => {
 await setInterfaceLanguage(language);
 try {
  const commit=vi.fn();
  const ui=render(<AnnotationCard annotation={{id:'a',text:'Before',createdAt:'2026-01-01'}} onCommit={commit} onDelete={vi.fn()}/>);
  fireEvent.doubleClick(ui.getByText('Before'));
  expect(ui.getByRole('button',{name:label})).toBeTruthy();
  fireEvent.keyDown(ui.getByRole('textbox'),{key:'Enter'});
  expect(commit).not.toHaveBeenCalled();
 } finally { cleanup(); await setInterfaceLanguage('zh-CN'); }
});
