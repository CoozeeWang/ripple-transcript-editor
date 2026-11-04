// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Segment } from '../types';
import { useTagFilterReadingPosition } from './useTagFilterReadingPosition';
import { readingViewport } from '../lib/readingViewport';

afterEach(() => { cleanup(); document.body.replaceChildren(); vi.unstubAllGlobals(); });
function fixture(width = 360) {
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1)); vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const segments: Segment[] = Array.from({ length: 100 }, (_, i) => ({ id: String(i + 1), text: 'Synthetic paragraph', speaker_id: 's', start: i, end: i + 1 }));
  const filtered = segments.filter((_, i) => (i + 1) % 5 === 0);
  let shown = filtered, currentWidth = width;
  const panel = document.createElement('section'); document.body.append(panel); panel.scrollTop = 600;
  panel.getBoundingClientRect = () => ({ top: 20, bottom: 320, height: 300, width: currentWidth } as DOMRect);
  panel.scrollTo = vi.fn((options?: ScrollToOptions | number, y?: number) => { panel.scrollTop = typeof options === 'number' ? y ?? 0 : options?.top ?? 0; });
  const paint = (next: Segment[]) => {
    shown = next;
    panel.replaceChildren(...shown.map((segment, index) => {
      const row = document.createElement('article'); row.id = 'segment-' + segment.id; row.className = 'segment'; row.innerHTML = '<p class="rt-para">Synthetic paragraph</p>';
      row.getBoundingClientRect = (row.firstChild as HTMLElement).getBoundingClientRect = () => {
        const height = currentWidth < 300 ? 150 : 100, top = 20 + index * height - panel.scrollTop;
        return { top, bottom: top + height, height, width: currentWidth } as DOMRect;
      };
      return row;
    }));
  };
  paint(filtered);
  vi.stubGlobal('document', document);
  document.elementFromPoint = (_x, y) => [...panel.children].find(row => { const r = row.getBoundingClientRect(); return r.top <= y && r.bottom > y; }) ?? null;
  const ref = { current: panel }, props = { context: 'one', active: true, segments, projection: filtered };
  const hook = renderHook(p => useTagFilterReadingPosition(ref, p.context, true, p.active, p.segments, p.projection), { initialProps: props });
  const row = (id: string) => panel.querySelector<HTMLElement>(`#segment-${id}`)!;
  const point = (id: string) => {
    const target = row(id), r = target.getBoundingClientRect(), event = new Event('pointermove', { bubbles: true });
    Object.defineProperties(event, { clientX: { value: 40 }, clientY: { value: r.top + 10 } }); target.dispatchEvent(event);
  };
  const leave = () => panel.dispatchEvent(new Event('pointerleave'));
  const change = (next: Segment[], active = false, all = segments, context = 'one', capture = true) => {
    if (capture) act(() => hook.result.current.preserve(!active));
    paint(next); hook.rerender({ context, active, segments: all, projection: next });
  };
  return { panel, segments, filtered, hook, point, leave, row, change, paint, setWidth: (value: number) => { currentWidth = value; } };
}

for (const width of [220, 360]) it(`restores the recent hovered paragraph after leaving the panel to clear a filter at width ${width}`, () => {
  const f = fixture(width), id = width < 300 ? '30' : '45';
  f.point(id); f.leave(); const before = f.row(id).getBoundingClientRect().top;
  f.change(f.segments); expect(f.row(id).getBoundingClientRect().top).toBe(before);
  expect(f.panel.scrollTop).toBeGreaterThan(600);
});
it('uses the current reading anchor after scrolling beyond an old hover, independently of focus', () => {
  const f = fixture(); f.point('45'); f.leave(); f.panel.scrollTop = 700;
  act(() => f.panel.dispatchEvent(new Event('scroll')));
  const input = document.createElement('input'); document.body.append(input); input.focus();
  const before = f.row('40').getBoundingClientRect().top; f.change(f.segments);
  expect(f.row('40').getBoundingClientRect().top).toBe(before); expect(document.activeElement).toBe(input);
});
it('resolves a stationary pointer after scrolling before the pointer leaves', () => {
  const f = fixture(); f.point('45'); f.panel.scrollTop += 100; f.leave();
  const before = f.row('50').getBoundingClientRect().top; f.change(f.segments);
  expect(f.row('50').getBoundingClientRect().top).toBe(before);
});
it('ignores an old hover after wrapping width changes', () => {
  const f = fixture(); f.point('45'); f.leave(); f.setWidth(220);
  readingViewport(f.panel).capture(); const before = f.row('25').getBoundingClientRect().top;
  f.change(f.segments); expect(f.row('25').getBoundingClientRect().top).toBe(before);
});
it('keeps the last reading anchor through an empty filtered result', () => {
  const f = fixture(); const before = f.row('35').getBoundingClientRect().top;
  f.change([], true, f.segments, 'one', false); f.change(f.segments);
  expect(f.row('35').getBoundingClientRect().top).toBe(before);
});
it('resolves merged IDs and falls back to a rendered neighbour after deletion', () => {
  for (const merged of [true, false]) {
    const f = fixture(); f.point('45'); f.leave(); const before = f.row('45').getBoundingClientRect().top;
    const next = f.segments.filter(s => s.id !== '45').map(s => merged && s.id === '44' ? { ...s, mergedFrom: ['45'] } : s);
    f.change(next, false, next); expect(f.row(merged ? '44' : '46').getBoundingClientRect().top).toBe(before);
    f.hook.unmount(); f.panel.remove();
  }
});
it('preserves a neighbouring result when a tag edit removes the hovered row while the filter stays active', () => {
  const f = fixture(); f.point('45'); f.leave(); const before = f.row('45').getBoundingClientRect().top;
  f.change(f.filtered.filter(s => s.id !== '45'), true);
  expect(f.row('40').getBoundingClientRect().top).toBe(before);
});
it('does not restore into a newly opened version', () => {
  const f = fixture(); f.point('45'); f.leave(); f.change(f.segments, false, f.segments, 'two');
  expect(f.panel.scrollTo).not.toHaveBeenCalled();
});
it('keeps a row-header hover at the row boundary instead of adding the first paragraph inset', () => {
  const f = fixture(), row = f.row('45'), paragraph = row.firstElementChild!;
  paragraph.getBoundingClientRect = () => { const r = row.getBoundingClientRect(); return { ...r, top: r.top + 17, height: r.height - 17 } as DOMRect; };
  f.point('45'); f.leave(); const before = row.getBoundingClientRect().top;
  f.change(f.filtered.filter(s => s.id !== '45'), true);
  expect(f.row('40').getBoundingClientRect().top).toBe(before);
});
it('records pointer moves without layout reads or whole-panel queries', () => {
  const f = fixture(), row = f.row('45'), rect = vi.spyOn(row, 'getBoundingClientRect'), query = vi.spyOn(f.panel, 'querySelectorAll');
  for (let i = 0; i < 120; i++) {
    const event = new Event('pointermove', { bubbles: true });
    Object.defineProperties(event, { clientX: { value: 40 }, clientY: { value: 230 } }); row.dispatchEvent(event);
  }
  expect(rect).not.toHaveBeenCalled(); expect(query).not.toHaveBeenCalled();
});
it('ignores a departed hover when content reflow moved that paragraph without a scroll event', () => {
  const f = fixture(); f.point('45'); f.leave();
  const row = f.row('45'), rect = row.getBoundingClientRect.bind(row);
  row.getBoundingClientRect = (row.firstElementChild as HTMLElement).getBoundingClientRect = () => { const r = rect(); return { ...r, top: r.top + 20, bottom: r.bottom + 20 } as DOMRect; };
  const before = f.row('35').getBoundingClientRect().top; f.change(f.segments);
  expect(f.row('35').getBoundingClientRect().top).toBe(before);
});
it('does not reuse a hover from a previous filter session', () => {
  const f = fixture(); f.point('45'); f.leave(); f.change(f.segments);
  f.change(f.filtered, true, f.segments, 'one', false); f.panel.scrollTop = 600;
  readingViewport(f.panel).capture(); const before = f.row('35').getBoundingClientRect().top;
  f.change(f.segments); expect(f.row('35').getBoundingClientRect().top).toBe(before);
});
