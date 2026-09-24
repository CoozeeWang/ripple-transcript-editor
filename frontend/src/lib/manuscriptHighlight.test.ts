// @vitest-environment jsdom
import {afterEach, expect, it, vi} from "vitest";
import {setManuscriptHighlights} from "./manuscriptHighlight";
import {writeComparisonText} from "./comparisonText";
import {attachEditor} from "./paragraphEditor";

afterEach(()=>vi.unstubAllGlobals());
it("paints current text across paragraphs and excludes displayed deletions without changing selection",()=>{
  const registry = new Map();
  vi.stubGlobal("CSS", {highlights:registry});
  vi.stubGlobal("Highlight", class {priority=0; constructor(...ranges:Range[]){Object.assign(this,{ranges});}});
  const root=attachEditor(document.createElement("div"));
  document.body.append(root);
  writeComparisonText(root,"甲新\n乙","甲旧\n乙");
  root.setSelectionRange(1,2);
  const html=root.innerHTML;
  setManuscriptHighlights(root,[{start:1,end:4}]);
  expect(registry.get("transcript-mark").ranges.map((r:Range)=>r.toString()).join("")).toBe("新乙");
  expect(root.innerHTML).toBe(html);
  expect([root.selectionStart,root.selectionEnd]).toEqual([1,2]);
  setManuscriptHighlights(root,[]);
  expect(registry.has("transcript-mark")).toBe(false);
  root.remove();
});
