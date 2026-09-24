// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayback } from "./usePlayback";
import { attachEditor, type ParagraphEditorElement } from "../lib/paragraphEditor";
import type { Transcript } from "../types";

const transcript: Transcript = {
  audio: {filename: "test.wav", duration: 20}, speakers: [], segments: [
    {id: "a", speaker_id: "s", text: "甲", start: 0, end: 10},
    {id: "b", speaker_id: "s", text: "乙", start: 10, end: 20},
  ],
};
afterEach(() => {cleanup(); localStorage.clear(); vi.restoreAllMocks();});
function setup(editors = new Map<string, ParagraphEditorElement>()) {
  let playback!: ReturnType<typeof usePlayback>;
  let selected = "";
  function Harness() {
    const [selection, setSelection] = useState("a");
    const [active, setActive] = useState("");
    selected = selection;
    playback = usePlayback({transcript, mutateTranscript: () => {}, activeSegmentId: active,
      setActiveSegmentId: setActive, setSelectedSegmentId: setSelection,
      effectiveSelectedSegmentId: selection, textareaRefs: {current: editors}, setLoadError: () => {}});
    return <section data-testid="panel" ref={playback.transcriptPanelRef}>
      <audio ref={playback.audioRef}/>
      <button onClick={() => setSelection("a")}>选择甲</button>
    </section>;
  }
  const ui = render(<Harness/>);
  act(() => playback.setAudioUrl("test.wav"));
  return {ui, get playback() {return playback;}, get selected() {return selected;}};
}
describe("one current segment for playback and side panels", () => {
  it("updates selection immediately on seek and retains it after pause", () => {
    const app = setup();
    act(() => app.playback.seekTo(12));
    expect(app.selected).toBe("b");
    act(() => app.playback.setIsPlaying(false));
    expect(app.selected).toBe("b");
  });
  it("follows time updates across segments, including paused scrubbing", () => {
    const app = setup();
    act(() => {
      app.playback.audioRef.current!.currentTime = 11;
      app.playback.updateCurrentSegment();
    });
    expect(app.selected).toBe("b");
    act(() => {
      app.playback.audioRef.current!.currentTime = 2;
      app.playback.updateCurrentSegment();
    });
    expect(app.selected).toBe("a");
  });
  it("scrolling pauses viewport follow without changing the current segment", () => {
    const app = setup();
    act(() => {app.playback.seekTo(12); app.playback.setIsPlaying(true);});
    fireEvent.scroll(app.ui.getByTestId("panel"));
    expect(app.selected).toBe("b");
    expect(app.playback.followingPaused).toBe(true);
    act(() => app.playback.setIsPlaying(false));
    fireEvent.click(app.ui.getByText("选择甲"));
    fireEvent.scroll(app.ui.getByTestId("panel"));
    expect(app.selected).toBe("a");
  });
  it("retains the last current segment across a gap in the audio", () => {
    const app = setup();
    act(() => app.playback.seekTo(12));
    act(() => {
      app.playback.audioRef.current!.currentTime = 20;
      app.playback.updateCurrentSegment();
    });
    expect(app.selected).toBe("b");
  });
});

function mockAudio(app: ReturnType<typeof setup>) {
  const audio = app.playback.audioRef.current!;
  let paused = true;
  Object.defineProperty(audio, "paused", {configurable: true, get: () => paused});
  const play = vi.spyOn(audio, "play").mockImplementation(() => { paused = false; return Promise.resolve(); });
  const pause = vi.spyOn(audio, "pause").mockImplementation(() => { paused = true; });
  return {audio, play, pause};
}
it("both playback controls restart from the recorded cursor after an explicit pause", () => {
  const app = setup();
  const {audio} = mockAudio(app);
  act(() => {app.playback.recordEditorCursor("b", 0, true); app.playback.togglePlayFromCursor();});
  expect(audio.currentTime).toBe(10);
  audio.currentTime = 13;
  act(() => app.playback.togglePlayback());
  expect(audio.paused).toBe(true);
  act(() => app.playback.togglePlayFromCursor());
  expect(audio.currentTime).toBe(10);
  audio.currentTime = 15;
  act(() => app.playback.togglePlayFromCursor());
  act(() => app.playback.togglePlayback());
  expect(audio.currentTime).toBe(10);
  act(() => app.playback.togglePlayback());
  // Explicit click on the same earlier position should seek again.
  act(() => {app.playback.recordEditorCursor("b", 0, true); app.playback.togglePlayback();});
  expect(audio.currentTime).toBe(10);
});
it("a progress-bar seek supersedes the old cursor and changing audio clears cursor memory", () => {
  const app = setup();
  const {audio} = mockAudio(app);
  act(() => {app.playback.recordEditorCursor("b", 0, true); app.playback.seekTo(4); app.playback.togglePlayback();});
  expect(audio.currentTime).toBe(4);
  act(() => app.playback.togglePlayback());
  act(() => app.playback.recordEditorCursor("b", 0, true));
  act(() => app.playback.setAudioUrl("another.wav"));
  audio.currentTime = 0;
  act(() => app.playback.togglePlayFromCursor());
  expect(audio.currentTime).toBe(0);
});
it("rapid start-pause-start ignores the superseded play rejection", async () => {
  const app = setup();
  const {audio, play, pause} = mockAudio(app);
  let rejectFirst!: (reason: unknown) => void;
  play.mockImplementationOnce(() => new Promise<void>((_, reject) => {rejectFirst = reject;}));
  act(() => app.playback.togglePlayback());
  act(() => app.playback.togglePlayback());
  expect(pause).toHaveBeenCalledTimes(1);
  act(() => app.playback.togglePlayback());
  await act(async () => rejectFirst(new DOMException("interrupted", "AbortError")));
  expect(audio.paused).toBe(false);
  act(() => app.playback.togglePlayback());
  expect(audio.paused).toBe(true);
});

it("typing leaves playback running but pause/resume starts from the updated caret", () => {
  const editor = document.createElement("div");
  editor.tabIndex = 0;
  editor.textContent = "乙";
  document.body.append(editor);
  const field = attachEditor(editor);
  const app = setup(new Map([["b", field]]));
  const {audio} = mockAudio(app);
  editor.focus();
  field.setSelectionRange(0, 0);
  act(() => app.playback.togglePlayback());
  expect(audio.currentTime).toBe(10);
  field.setSelectionRange(1, 1);
  audio.currentTime = 13;
  expect(audio.paused).toBe(false);
  expect(audio.currentTime).toBe(13);
  act(() => app.playback.togglePlayback());
  expect(audio.currentTime).toBe(13);
  act(() => app.playback.togglePlayback());
  expect(audio.currentTime).toBe(20);
  editor.remove();
});

it("button pause uses the latest caret recorded on editor blur", () => {
  const app = setup();
  const {audio} = mockAudio(app);
  act(() => app.playback.togglePlayback());
  audio.currentTime = 13;
  act(() => app.playback.recordEditorCursor("b", 1));
  expect(audio.currentTime).toBe(13);
  expect(audio.paused).toBe(false);
  act(() => app.playback.togglePlayback());
  act(() => app.playback.togglePlayback());
  expect(audio.currentTime).toBe(20);
});
it("without an editor cursor pause/resume keeps the audio position", () => {
  const app = setup();
  const {audio} = mockAudio(app);
  act(() => app.playback.togglePlayback());
  audio.currentTime = 7;
  act(() => app.playback.togglePlayback());
  act(() => app.playback.togglePlayback());
  expect(audio.currentTime).toBe(7);
});

it("starting at an editing caret preserves the viewport across playback and pause/restart", () => {
  const editor = document.createElement("div");
  editor.tabIndex = 0;
  editor.textContent = "乙";
  const field = attachEditor(editor);
  const app = setup(new Map([["b", field]]));
  const panel = app.ui.getByTestId("panel");
  const segment = document.createElement("article");
  segment.id = "segment-b";
  segment.append(editor);
  panel.append(segment);
  panel.scrollTop = 320;
  Object.defineProperty(panel, "clientHeight", {value: 600});
  vi.spyOn(segment, "getBoundingClientRect").mockReturnValue({top: 100, height: 2400} as DOMRect);
  const scroll = vi.fn();
  panel.scrollTo = scroll;
  const {audio} = mockAudio(app);
  editor.focus();
  field.setSelectionRange(0, 0);
  act(() => app.playback.togglePlayFromCursor());
  act(() => app.playback.setIsPlaying(true));
  expect(audio.currentTime).toBe(10);
  expect(app.playback.followingPaused).toBe(true);
  expect(scroll.mock.calls).toEqual([[{top: 320, behavior: "instant"}]]);
  act(() => {app.playback.togglePlayback(); app.playback.setIsPlaying(false);});
  act(() => app.playback.togglePlayFromCursor());
  act(() => app.playback.setIsPlaying(true));
  expect(scroll.mock.calls).toEqual([
    [{top: 320, behavior: "instant"}], [{top: 320, behavior: "instant"}],
  ]);
  expect(document.activeElement).toBe(editor);
  expect(field.selectionStart).toBe(0);
  // 用户明确要求回到播放位置时仍可恢复跟随。
  act(() => app.playback.resumeFollow());
  expect(app.playback.followingPaused).toBe(false);
  expect(scroll).toHaveBeenLastCalledWith(expect.objectContaining({behavior: "smooth"}));
});
