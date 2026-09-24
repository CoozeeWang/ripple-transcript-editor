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
