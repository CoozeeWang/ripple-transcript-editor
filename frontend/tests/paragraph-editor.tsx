import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { SegmentTextArea } from "../src/components/SegmentTextArea";
import { type ParagraphEditorElement } from "../src/lib/paragraphEditor";
import { flushEditorDrafts } from "../src/lib/editorDrafts";
import { renderHighlightedText } from "../src/lib/highlight";
import "../src/styles.css";

export function Check() {
  const [text, setText] = useState("第一段文字，用来检查自动折行后的行距。".repeat(5) + "\n第二段文字，应有额外段间距。\n第三段😀高亮与光标检查。");
  const [range, setRange] = useState([0, 0]);
  const registry = useRef(new Map<string, ParagraphEditorElement>());
  const noop = () => {};
  return <main style={{maxWidth: 650, margin: "40px auto"}}>
    <h1>段落编辑回归测试（测试数据）</h1>
    <div className="segment" style={{display: "block"}}><SegmentTextArea segmentId="test" value={text} registry={registry} ariaLabel="测试正文" onFocus={noop} onBlur={e => setRange([e.currentTarget.selectionStart, e.currentTarget.selectionEnd])} onClick={noop} onKeyDown={noop} onChange={setText}/></div>
    <button onClick={() => flushEditorDrafts()}>保存测试草稿</button>
    <button onClick={() => {const el=registry.current.get("test")!; el.focus(); el.setSelectionRange(text.indexOf("第二段"), text.indexOf("第二段")+3);}}>选中第二段</button>
    <p>选区：{range.join("–")}</p><pre aria-label="已保存文本" style={{whiteSpace: "pre-wrap"}}>{JSON.stringify(text)}</pre>
    <h2>播放排版</h2><div className="segment-text-rendered">{renderHighlightedText(text, null)}</div>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Check/>);
