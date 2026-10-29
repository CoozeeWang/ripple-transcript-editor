// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { TagsPanel } from './TagsPanel';
import type { TagLibrary } from '../lib/tags';
const initial: TagLibrary = { schemaVersion: 1, tags: [{ id: 't1', name: 'Topic', groupIds: ['g1', 'g2'] }], groups: [{ id: 'g1', name: 'Parent', parentId: null }, { id: 'g2', name: 'Child', parentId: 'g1' }] };
beforeEach(() => { vi.stubGlobal('ResizeObserver', class {
    observe() { }
    disconnect() { }
}); HTMLDialogElement.prototype.showModal = function () { this.open = true; }; HTMLDialogElement.prototype.close = function () { this.open = false; }; HTMLElement.prototype.setPointerCapture = () => { }; HTMLElement.prototype.releasePointerCapture = () => { }; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function mount() { const filter = vi.fn(), changed = vi.fn(); function Harness() { const [library, setLibrary] = useState(initial); return <TagsPanel library={library} onChange={async (next) => { changed(next); setLibrary(next); }} readOnly={false} filter={null} onFilter={filter} currentCount={() => 1} projectCounts={new Map([['t1', 2]])} countError={false} retryCounts={() => { }}/>; } const view = render(<Harness />); return { ...view, filter, changed }; }
const pointer = (el: Element, type: string, x: number, y: number, meta = false) => { const e = new Event(type, { bubbles: true, cancelable: true }); Object.assign(e, { pointerId: 1, clientX: x, clientY: y, button: 0, metaKey: meta, ctrlKey: meta }); fireEvent(el, e); };
describe('production tags panel', () => {
    it('filters only from the pill, never row/count/delete; cancel preserves data', async () => { const h = mount(), pill = screen.getByRole('button', { name: '标签: Topic' }), row = pill.closest('.library-tag-row')!; fireEvent.click(row); fireEvent.click(row.querySelector('.tag-count')!); expect(h.filter).not.toHaveBeenCalled(); fireEvent.click(pill); expect(h.filter).toHaveBeenCalledWith('t1'); fireEvent.click(screen.getByRole('button', { name: '删除项目标签: Topic' })); fireEvent.click(screen.getByRole('button', { name: '取消' })); expect(h.changed).not.toHaveBeenCalled(); });
    it('cycles groups/tags independently and resumes full expansion after local change', async () => { const h = mount(); fireEvent.click(screen.getByRole('button', { name: '分组' })); const cycle = h.container.querySelector('.group-cycle')!; expect(cycle.getAttribute('title')).toBeNull(); expect(cycle.getAttribute('data-tip')).toBeNull(); fireEvent.click(cycle); expect(h.container.querySelectorAll('.library-pill')).toHaveLength(2); fireEvent.click(cycle); expect(h.container.querySelectorAll('.library-pill')).toHaveLength(0); expect(h.container.querySelectorAll('[data-tag-group]')).toHaveLength(2); fireEvent.click(cycle); expect(h.container.querySelectorAll('[data-tag-group]')).toHaveLength(1); fireEvent.click(h.container.querySelector('[data-tag-group="g1"] .group-collapse')!); fireEvent.click(cycle); expect(h.container.querySelectorAll('.library-pill')).toHaveLength(2); expect(h.filter).not.toHaveBeenCalled(); expect(h.changed).not.toHaveBeenCalled(); });
    it('removes group membership only and preserves the tag in its other group', async () => { const h = mount(); fireEvent.click(screen.getByRole('button', { name: '分组' })); fireEvent.click(h.container.querySelector('[data-tag-group="g2"] .group-tag-remove')!); await waitFor(() => expect(h.changed).toHaveBeenCalled()); expect(h.changed.mock.calls[0][0].tags).toEqual([{ ...initial.tags[0], groupIds: ['g1'] }]); expect(h.filter).not.toHaveBeenCalled(); });
    it('outdents a child to its parent sibling using a line, including modifier release, and rejects cycles', async () => {
        const h = mount();
        fireEvent.click(screen.getByRole('button', { name: '分组' }));
        const parent = h.container.querySelector('[data-tag-group="g1"]>.tag-group-header')!, child = h.container.querySelector('[data-tag-group="g2"]>.tag-group-header')!, name = child.querySelector('.group-toggle')!;
        parent.getBoundingClientRect = () => ({ left: 10, top: 100, height: 28 } as DOMRect);
        child.getBoundingClientRect = () => ({ left: 34, top: 160, height: 28 } as DOMRect);
        document.elementFromPoint = vi.fn(() => child);
        pointer(name, 'pointerdown', 65, 172, true);
        pointer(name, 'pointermove', 36, 172, false);
        expect(h.container.querySelector('[data-tag-group="g1"].drop-after')).not.toBeNull();
        pointer(name, 'pointerup', 36, 172, false);
        await waitFor(() => expect(h.changed).toHaveBeenCalled());
        expect(h.changed.mock.calls[0][0].groups.find((g: {
            id: string;
        }) => g.id === 'g2').parentId).toBeNull();
        h.changed.mockClear();
        pointer(name, 'pointerdown', 65, 172, true);
        pointer(name, 'pointermove', 36, 172, false);
        fireEvent.keyDown(window, { key: 'Escape' });
        pointer(name, 'pointerup', 36, 172, false);
        expect(h.changed).not.toHaveBeenCalled();
    });
});
