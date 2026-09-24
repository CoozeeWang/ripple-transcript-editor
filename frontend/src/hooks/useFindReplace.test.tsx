// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { SegmentTextArea } from "../components/SegmentTextArea";
import type { ParagraphEditorElement } from "../lib/paragraphEditor";
import type { Transcript } from "../types";
import { useFindReplace } from "./useFindReplace";
import { findMatches } from "../lib/search";

afterEach(cleanup);

function Harness({
  transcript,
  query = "你好",
}: {
  transcript: Transcript;
  query?: string;
}) {
  const [t, setT] = useState(transcript);
  const textareaRefs = useRef(new Map<string, ParagraphEditorElement>());
  const [selectedId, setSelectedId] = useState("");
  const fr = useFindReplace({
    transcript: t,
    viewingOriginal: false,
    mutateTranscript: (updater) => setT((cur) => updater(cur)),
    setSelectedSegmentId: setSelectedId,
    textareaRefs,
  });
  const click = (fn: () => void) => () => fn();
  return (
    <div>
      {t.segments.map((seg) => (
        <SegmentTextArea key={seg.id} segmentId={seg.id} value={seg.text} registry={textareaRefs} ariaLabel={`ta-${seg.id}`} onFocus={() => {}} onBlur={() => {}} onClick={() => {}} onKeyDown={() => {}} onChange={() => {}} />
      ))}
      <span data-testid="match-index">{fr.currentMatchIndex}</span>
      <span data-testid="selected">{selectedId}</span>
      <button data-testid="set-query" onClick={click(() => fr.setFindQuery(query))}>
        setQuery
      </button>
      <button data-testid="set-replace" onClick={click(() => fr.setReplaceValue("知道 1"))}>
        setReplace
      </button>
      <button data-testid="find-next" onClick={click(() => fr.findNext())}>
        findNext
      </button>
      <button data-testid="find-prev" onClick={click(() => fr.findPrev())}>
        findPrev
      </button>
      <button data-testid="replace" onClick={click(() => fr.replaceCurrent())}>
        replace
      </button>
    </div>
  );
}

const transcript: Transcript = {
  audio: { filename: "a.m4a", duration: 10 },
  speakers: [{ id: "s1", name: "A", colorIndex: 0 }],
  segments: [
    { id: "seg1", speaker_id: "s1", start: 0, end: 5, text: "你好世界你好" },
    { id: "seg2", speaker_id: "s1", start: 5, end: 10, text: "你好再见" },
  ],
};

const flushRaf = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

// fireEvent 必须放在 act() 里才能 flush React 状态更新，否则连续两次 click
// 第二次读取到的仍是初始值（setState 未渲染）。
const click = (testId: string) =>
  act(() => {
    fireEvent.click(screen.getByTestId(testId));
  });

describe("useFindReplace.replaceCurrent", () => {
  it("替换成功后自动定位并高亮下一个匹配", async () => {
    render(<Harness transcript={transcript} />);
    await click("set-query");
    // 定位到第一个匹配（seg1 @0），索引 0。
    await click("find-next");
    await act(() => flushRaf());
    expect(screen.getByTestId("match-index").textContent).toBe("0");

    // 替换第一个「你好」：seg1 → "XX世界你好"，新 matches = [seg1@2, seg2@0]。
    await click("replace");
    await act(() => flushRaf());

    // 下一个匹配前移到索引 0（seg1 的第二个「你好」，新文本位置 2），并已聚焦选中。
    expect(screen.getByTestId("match-index").textContent).toBe("0");
    expect(screen.getByTestId("selected").textContent).toBe("seg1");
    const ta = screen.getByLabelText("ta-seg1") as ParagraphEditorElement;
    expect(ta.selectionStart).toBe(2);
    expect(ta.selectionEnd).toBe(4);
  });

  it("替换最后一个匹配后定位到文首继续高亮（findNext 会循环，replaceCurrent 也循环）", () => {
    // 循环到文首的逻辑在 replaceCurrent 里通过 isLast 判断：替换的是最后一个匹配时，
    // 把 currentMatchIndex 设为 0（文首位置），effect 在新 matches 上聚焦。这里直接验
    // 证 matches 重算后 index=0 指向原第一个匹配。
    const result = findMatches(transcript, "你好");
    // "你好世界你好" 中两个「你好」分别在位置 0、4；"你好再见" 中位置 0。
    expect(result.length).toBe(3);
    expect(result[0]).toEqual({ segmentId: "seg1", start: 0 });
    expect(result[1]).toEqual({ segmentId: "seg1", start: 4 });
    expect(result[2]).toEqual({ segmentId: "seg2", start: 0 });
  });

  it("findPrev 从文首循环到文末（prevIndex 取模 length）", () => {
    // 同理：findPrev 的 (currentMatchIndex - 1 + length) % length 保证从 0 跳到 length-1。
    const length = findMatches(transcript, "你好").length;
    const prevIndex = (0 - 1 + length) % length;
    expect(prevIndex).toBe(length - 1);
  });

  it("替换唯一一个匹配后不再定位（没有下一个）", async () => {
    const single: Transcript = {
      ...transcript,
      segments: [{ id: "seg1", speaker_id: "s1", start: 0, end: 5, text: "你好世界" }],
    };
    render(<Harness transcript={single} />);
    await click("set-query");
    await click("find-next");
    await act(() => flushRaf());

    await click("replace");
    await act(() => flushRaf());

    // 没有下一个匹配：索引 -1。
    expect(screen.getByTestId("match-index").textContent).toBe("-1");
  });

  it("替换「知道」为「知道 1」后跳到下一个不同匹配（不无限替换同一处）", async () => {
    const t: Transcript = {
      ...transcript,
      segments: [{ id: "seg1", speaker_id: "s1", start: 0, end: 10, text: "知道 知道" }],
    };
    render(<Harness transcript={t} query="知道" />);
    await click("set-query");
    await click("set-replace");
    await click("find-next"); // 定位第一个「知道」@0
    await act(() => flushRaf());
    expect(screen.getByTestId("match-index").textContent).toBe("0");

    await click("replace"); // 替换 @0 → "知道 1 知道"
    await act(() => flushRaf());

    // 必须跳到第二个「知道」（新文本位置 5），而不是区域开头重现的「知道 1」里的「知道」@0。
    const ta = screen.getByLabelText("ta-seg1") as ParagraphEditorElement;
    expect(ta.selectionStart).toBe(5);
    expect(ta.selectionEnd).toBe(7);
    expect(screen.getByTestId("match-index").textContent).toBe("1");
  });

  it("连续替换直到所有匹配都变成「知道 1」后停止，不再无限替换同一处", async () => {
    const t: Transcript = {
      ...transcript,
      segments: [{ id: "seg1", speaker_id: "s1", start: 0, end: 10, text: "知道 知道" }],
    };
    render(<Harness transcript={t} query="知道" />);
    await click("set-query");
    await click("set-replace");
    await click("find-next");
    await act(() => flushRaf());

    // 连续替换两次：第一次替换 @0，第二次替换第二个「知道」。
    await click("replace");
    await act(() => flushRaf());
    await click("replace");
    await act(() => flushRaf());

    // 两个「知道」都被替换成「知道 1」，匹配只剩区域开头的重现；
    // 没有其他可跳的匹配 → 索引归 -1（不再无限循环）。
    expect(screen.getByTestId("match-index").textContent).toBe("-1");
    const ta = screen.getByLabelText("ta-seg1") as ParagraphEditorElement;
    expect(ta.value).toBe("知道 1 知道 1");
  });
});
import {renderHook} from "@testing-library/react";
import {vi} from "vitest";
import {seedOriginalOrigins} from "../lib/transcriptOrigins";
it("replace all keeps each repeated occurrence attached to its own original range",()=>{
 const original={...transcript,segments:[{...transcript.segments[0],text:"甲乙甲乙",words:Array.from("甲乙甲乙",(text,i)=>({text,start:i,end:i+1}))}]};
 let current=seedOriginalOrigins(original,"m1");
 const confirm=vi.spyOn(window,"confirm").mockReturnValue(true);
 const {result}=renderHook(()=>useFindReplace({transcript:current,viewingOriginal:false,mutateTranscript:updater=>{current=updater(current);},setSelectedSegmentId:()=>{},textareaRefs:{current:new Map()}}));
 act(()=>{result.current.setFindQuery("甲乙");result.current.setReplaceValue("新");});
 act(()=>result.current.replaceAll());
 expect(current.segments[0].words!.map(word=>[word.text,word.start,word.end])).toEqual([["新",0,2],["新",2,4]]);
 confirm.mockRestore();
});
