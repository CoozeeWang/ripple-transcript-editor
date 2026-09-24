// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useComparisonReadingPosition } from "./useComparisonReadingPosition";

afterEach(() => { cleanup(); document.body.replaceChildren(); });
function setup() {
  const panel = document.createElement("section");
  panel.innerHTML = '<article class="segment segment--selected" id="segment-old"></article><article class="segment" id="segment-reading"><p class="rt-para">正在看的段落</p></article>';
  document.body.append(panel);
  panel.scrollTop = 1000;
  let top = -20, height = 100;
  panel.getBoundingClientRect = () => ({ top: 0, bottom: 500, height: 500 } as DOMRect);
  const selected = panel.children[0] as HTMLElement;
  selected.getBoundingClientRect = () => ({ top: -900, bottom: -500, height: 400 } as DOMRect);
  const segment = panel.children[1] as HTMLElement;
  const rect = () => ({ top, bottom: top + height, height } as DOMRect);
  segment.getBoundingClientRect = rect;
  (segment.firstChild as HTMLElement).getBoundingClientRect = rect;
  panel.scrollTo = vi.fn((options?: ScrollToOptions | number) => {
    const next = typeof options === "number" ? options : options?.top ?? 0;
    top -= next - panel.scrollTop;
    panel.scrollTop = next;
  });
  const ref = { current: panel }, dir = {};
  const initialProps = { directory: dir, context: "A", shown: false, loading: false, baseline: null as unknown };
  const hook = renderHook(p => useComparisonReadingPosition(ref, p.directory, p.context, p.shown, p.loading, p.baseline), { initialProps });
  return { panel, hook, initialProps, shift: (t: number, h = 100) => { top = t; height = h; }, replaceParagraph: () => {
    segment.innerHTML = '<p class="rt-para">带修改痕迹的段落</p>';
    (segment.firstChild as HTMLElement).getBoundingClientRect = rect;
  } };
}

it("keeps the visible paragraph through async loading and replaced text nodes, then hiding", () => {
  const { panel, hook, initialProps, shift, replaceParagraph } = setup();
  act(() => hook.result.current());
  hook.rerender({ ...initialProps, shown: true, loading: true });
  expect(panel.scrollTop).toBe(1000);
  shift(380, 200); replaceParagraph();
  hook.rerender({ ...initialProps, shown: true, baseline: {} });
  expect(panel.scrollTop).toBe(1420); // preserve the 20% reading position in the paragraph
  act(() => hook.result.current());
  shift(-440);
  hook.rerender(initialProps);
  expect(panel.scrollTop).toBe(1000);
});

it("does not restore an old anchor in another document or directory", () => {
  const { panel, hook, initialProps, shift } = setup();
  act(() => hook.result.current());
  shift(400);
  hook.rerender({ ...initialProps, context: "B", shown: true, baseline: {} });
  expect(panel.scrollTo).not.toHaveBeenCalled();
  act(() => hook.result.current());
  hook.rerender({ ...initialProps, directory: {}, shown: true, baseline: {} });
  expect(panel.scrollTo).not.toHaveBeenCalled();
});

it("does not pull the reader back if they scroll while the comparison loads", () => {
  const { panel, hook, initialProps, shift } = setup();
  act(() => hook.result.current());
  hook.rerender({ ...initialProps, shown: true, loading: true });
  vi.mocked(panel.scrollTo).mockClear();
  act(() => panel.dispatchEvent(new Event("wheel")));
  shift(400);
  hook.rerender({ ...initialProps, shown: true, baseline: {} });
  expect(panel.scrollTo).not.toHaveBeenCalled();
});
