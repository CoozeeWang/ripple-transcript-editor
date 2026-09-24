// @vitest-environment jsdom
import {expect,it} from "vitest";
import {writeComparisonText} from "./comparisonText";
import {editorSnapshot} from "./paragraphEditor";
import {revisionFor} from "./revisions";
it("preserves current paragraph breaks and excludes deleted ones",()=>{
 const root=document.createElement("div");
 expect(revisionFor("甲旧\n乙",{id:"s",text:"甲\n乙",reason:""}).parts.filter(p=>p.changed).map(p=>p.before)).toEqual(["旧"]);
 writeComparisonText(root,"甲\n乙","甲旧\n乙");
 expect(root.querySelector("del")?.textContent).toBe("旧");expect(editorSnapshot(root).text).toBe("甲\n乙");
 writeComparisonText(root,"甲乙","甲旧\n乙");expect(editorSnapshot(root).text).toBe("甲乙");
});
