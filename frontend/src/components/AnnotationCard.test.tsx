// @vitest-environment jsdom
import {cleanup, fireEvent, render} from "@testing-library/react";
import {afterEach, expect, it, vi} from "vitest";
import {AnnotationCard} from "./AnnotationCard";
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
