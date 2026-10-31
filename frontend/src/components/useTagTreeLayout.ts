import { useLayoutEffect, type DependencyList, type RefObject } from 'react';
import { tagEdgeGeometry } from '../lib/tagEdgeGeometry';

/** One observer per tree, never per pointer move. Read all bounds before writing overlays. */
export function useTagTreeLayout(ref: RefObject<HTMLDivElement | null>, dependencies: DependencyList) {
    useLayoutEffect(() => {
        const root = ref.current;
        if (!root) return;
        const rows = [...root.querySelectorAll<HTMLElement>('[data-tag-id]')];
        const scopes = new Map<Element, Map<string, HTMLElement>>();
        for (const row of rows) {
            const scope = row.closest('.group-tags,.tag-membership-tree,.library-list')!;
            if (!scopes.has(scope)) scopes.set(scope, new Map());
            scopes.get(scope)!.set(row.dataset.tagId!, row);
        }
        const sync = () => {
            const changes = rows.flatMap(row => {
                const edge = row.querySelector<HTMLElement>('.tag-tree-elbow');
                if (!edge) return [];
                const guide = edge.parentElement!;
                const child = row.querySelector<HTMLElement>('.tag-pill');
                if (!child) return [() => { guide.style.visibility = 'hidden'; }];
                const scope = row.closest('.group-tags,.tag-membership-tree,.library-list')!;
                const parent = scopes.get(scope)?.get(edge.dataset.guideParent!)?.querySelector<HTMLElement>('.tag-pill');
                const dots = [...row.querySelectorAll<HTMLElement>('.tag-tree-missing')];
                // The checkbox tree has a 21px step; its trunk stays beyond the 13px checkbox.
                const geometry = tagEdgeGeometry(row.getBoundingClientRect(), child.getBoundingClientRect(), parent?.getBoundingClientRect(), Number(edge.dataset.guideFallback), parseFloat(getComputedStyle(child).fontSize), dots.length, row.classList.contains('tag-membership-row') ? 16 : 6);
                return [() => {
                    guide.style.visibility = 'visible';
                    for (const key of ['left', 'top', 'width', 'bottom'] as const) edge.style[key] = `${geometry[key]}px`;
                    dots.forEach((dot, index) => { dot.style.left = `${geometry.dots[index]}px`; dot.style.top = `${geometry.center}px`; });
                }];
            });
            changes.forEach(apply => apply());
        };
        sync();
        const observer = new ResizeObserver(sync);
        observer.observe(root);
        rows.forEach(row => { observer.observe(row); row.querySelectorAll('.tag-pill').forEach(pill => observer.observe(pill)); });
        const mutations = new MutationObserver(records => {
            const pills = records.flatMap(record => [...record.addedNodes, ...record.removedNodes]).flatMap(node => node instanceof Element
                ? [...(node.matches('.tag-pill') ? [node] : []), ...node.querySelectorAll('.tag-pill')] : []);
            if (!pills.length) return;
            pills.filter(pill => root.contains(pill)).forEach(pill => observer.observe(pill));
            sync();
        });
        mutations.observe(root, { childList: true, subtree: true });
        return () => { observer.disconnect(); mutations.disconnect(); };
        // Callers provide only geometry inputs, deliberately excluding drag/hover state.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, dependencies);
}
