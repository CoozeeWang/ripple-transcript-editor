export interface TagEdgeBox { left: number; top: number; width: number; height: number }
/** Coordinates relative to the child's row; only a real, visible ancestor is an anchor. */
export function tagEdgeGeometry(row: TagEdgeBox, child: TagEdgeBox, parent: TagEdgeBox | undefined, fallbackLeft: number, fontSize: number, missing: number, anchorOffset = 6) {
    const center = child.top + child.height / 2 - row.top;
    const left = parent ? parent.left + Math.min(anchorOffset, parent.width / 2) - row.left : fallbackLeft;
    const end = child.left - row.left;
    const top = parent ? parent.top + parent.height - row.top
        : Math.min(center - 2, child.top - row.top + fontSize * .5);
    const start = Math.min(left + 4, end);
    return { left: left - .5, top, width: Math.max(0, end - left + .5), bottom: row.height - center - .5, center,
        dots: Array.from({ length: missing }, (_, index) => start + (end - start) * (index + .5) / missing) };
}
