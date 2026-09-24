// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { attachEditor, editorSnapshot, writeEditorText } from "./paragraphEditor";

afterEach(() => { document.body.replaceChildren(); window.getSelection()?.removeAllRanges(); });
function editor(text: string) {
  const el = attachEditor(document.createElement("div"));
  el.contentEditable = "true";
  document.body.append(el);
  writeEditorText(el, text);
  return el;
}
describe("paragraph editor plain text and selection", () => {
  it.each(["", "甲\n乙", "\n甲\n\n乙\n", "甲😀\n乙", "a  b\t c"])("round trips text without extra blank lines: %j", text => {
    const el = editor(text);
    expect(el.value).toBe(text);
    for (let index = 0; index <= text.length; index++) {
      el.setSelectionRange(index, index);
      expect([el.selectionStart, el.selectionEnd]).toEqual([index, index]);
    }
    el.setSelectionRange(0, text.length);
    expect(el.selectionEnd).toBe(text.length);
  });
  it("maps a selection across paragraphs, including UTF-16 emoji offsets", () => {
    const el = editor("甲😀\n乙丙");
    el.setSelectionRange(1, 5);
    expect(el.selectionStart).toBe(1);
    expect(el.selectionEnd).toBe(5);
    expect(el.value.slice(el.selectionStart, el.selectionEnd)).toBe("😀\n乙");
  });
  it("reads native Enter and paste DOM with empty paragraph placeholders", () => {
    const el = editor("");
    el.innerHTML = '<div>甲</div><div><br></div><div>乙<br>丙<br></div>';
    expect(editorSnapshot(el).text).toBe("甲\n\n乙\n丙");
  });
  it("treats pasted markup as text when initializing", () => {
    const el = editor('<img src=x onerror=alert(1)>\n正文');
    expect(el.querySelector('img')).toBeNull();
    expect(el.value).toBe('<img src=x onerror=alert(1)>\n正文');
  });
});
