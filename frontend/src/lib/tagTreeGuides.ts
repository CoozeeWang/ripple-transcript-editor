import { tagAncestors, type TagLibrary } from './tags';

export interface TagGuide { depth: number; parentDepth: number | null; missing: number; continuingDepths: number[] }
/** Edges follow actual membership, never the preceding (possibly unrelated) row. */
export function tagTreeGuides(library: TagLibrary, visibleIds: readonly string[], members?: ReadonlySet<string>): Map<string, TagGuide> {
    const ancestors = new Map(visibleIds.map(id => [id, tagAncestors(library, id).reverse()]));
    const parents = new Map(visibleIds.map(id => [id, [...ancestors.get(id)!].reverse().find(tag => !members || members.has(tag.id))]));
    const lastEdge = new Map<string, number>();
    visibleIds.forEach((id, index) => { const parent = parents.get(id); if (parent) lastEdge.set(parent.id, index); });
    return new Map(visibleIds.map((id, index) => {
        const path = ancestors.get(id)!, parent = parents.get(id), depth = path.length;
        const parentDepth = parent ? path.findIndex(tag => tag.id === parent.id) : null;
        return [id, { depth, parentDepth, missing: depth - (parentDepth === null ? 0 : parentDepth + 1),
            continuingDepths: path.flatMap((tag, d) => (lastEdge.get(tag.id) ?? -1) > index ? [d] : []) }];
    }));
}
