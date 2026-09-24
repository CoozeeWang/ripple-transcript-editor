// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useOpeningPosition } from "./useOpeningPosition";
import { RESTORE_EDIT_POSITION_KEY } from "../lib/editPosition";
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });
it("waits for document DOM and cancels obsolete opening requests", () => {
  localStorage.setItem(RESTORE_EDIT_POSITION_KEY, "1");
  const callbacks = new Map<number, FrameRequestCallback>();
  let next = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(cb => {callbacks.set(++next,cb);return next;});
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(id => {callbacks.delete(id);});
  const scroll = vi.fn();
  const request = {id:"b"};
  function Harness({ready, target}: {ready:boolean;target:{id:string}|null}) {
    const ref=useRef<HTMLDivElement>(null);
    useOpeningPosition(target,ref,ready);
    return ready ? <div ref={ref} data-testid="panel"><article id="segment-b"/></div> : null;
  }
  const ui=render(<Harness ready={false} target={request}/>);
  expect(callbacks.size).toBe(0);
  ui.rerender(<Harness ready target={request}/>);
  const panel=ui.getByTestId("panel");panel.scrollTo=scroll;
  vi.spyOn(panel,"getBoundingClientRect").mockReturnValue({top:100} as DOMRect);
  vi.spyOn(panel.firstElementChild!,"getBoundingClientRect").mockReturnValue({top:1500} as DOMRect);
  act(() => {for(const cb of callbacks.values()) cb(0);callbacks.clear();});
  expect(scroll).toHaveBeenCalledWith({top:1384,behavior:"instant"});
  ui.rerender(<Harness ready target={{id:"b"}}/>);
  ui.rerender(<Harness ready={false} target={null}/>);
  expect(callbacks.size).toBe(0);
});

it("returns to the document top when restoration is disabled even if the requested segment is hidden", () => {
  localStorage.setItem(RESTORE_EDIT_POSITION_KEY, "0");
  let frame: FrameRequestCallback = () => {};
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(cb => { frame = cb; return 1; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  function Harness() {
    const ref = useRef<HTMLDivElement>(null);
    useOpeningPosition({ id: "hidden" }, ref, true);
    return <div ref={ref} data-testid="panel" />;
  }
  const ui = render(<Harness />);
  const panel = ui.getByTestId("panel");
  panel.scrollTop = 2400;
  panel.scrollTo = vi.fn();
  act(() => frame(0));
  expect(panel.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "instant" });
});
