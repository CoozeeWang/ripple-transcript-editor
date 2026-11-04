import { isTagLibrary, tagTreeRows, type TagLibrary } from './tags';
import { projectTagCatalog, type TagConsumer } from './tagCollections';
import { dragSiblingOrder, reorderVersionTags, sortVersionTagsByName } from './tagOrdering';

export interface TreeOrderSource { id: string; label: string; order: string[] }
export interface TreeOrderPlan { sources: TreeOrderSource[]; conflict: boolean; order: string[] | null; baselineId?: string }
const complete = (library: TagLibrary, order: readonly string[]) => {
    const valid = new Set(library.tags.map(tag => tag.id));
    return tagTreeRows(library, undefined, 'manual', 1, () => 0, [...new Set(order.filter(id => valid.has(id)))]).map(row => row.tag.id);
};
/** Read fresh version metadata, never a previously captured manuscript snapshot. */
export function planProjectTreeOrder(library: TagLibrary, consumers: readonly TagConsumer[], baselineId?: string): TreeOrderPlan {
    if (library.schemaVersion === 4) return { sources: [], conflict: false, order: [...library.treeOrder!] };
    const sources = consumers.filter(row => row.transcript.tagCollection?.levelOrder?.length).map(row => ({
        id: row.id, label: row.label, order: complete(library, row.transcript.tagCollection!.levelOrder!),
    }));
    const unique = new Set(sources.map(row => JSON.stringify(row.order)));
    const baseline = baselineId && sources.find(row => row.id === baselineId);
    if (baselineId && !baseline) throw Error('tag_order_baseline_changed');
    const conflict = unique.size > 1;
    return { sources, conflict, baselineId: baseline ? baseline.id : undefined,
        order: baseline ? baseline.order : conflict ? null : sources[0]?.order ?? complete(library, []) };
}
export function initializeProjectTreeOrder(source: TagLibrary, consumers: readonly TagConsumer[], baselineId?: string): TagLibrary {
    if (source.schemaVersion === 4) return source;
    const plan = planProjectTreeOrder(source, consumers, baselineId);
    if (!plan.order) throw Error('tag_order_baseline_required');
    const library: TagLibrary = { ...projectTagCatalog(source), schemaVersion: 4, treeOrder: plan.order };
    if (!isTagLibrary(library)) throw Error('tag_order_invalid');
    return library;
}
export function carryProjectTreeOrder(library: TagLibrary, order: readonly string[]): TagLibrary {
    if (library.schemaVersion !== 4) return library;
    const next = complete(library, order);
    return JSON.stringify(next) === JSON.stringify(library.treeOrder) ? library : { ...library, treeOrder: next };
}
const collection = (library: TagLibrary) => {
    if (library.schemaVersion !== 4) throw Error('tag_order_upgrade_required');
    return { schemaVersion: 1 as const, tagIds: library.tags.map(tag => tag.id), groups: [], levelOrder: library.treeOrder };
};
export function reorderProjectTree(library: TagLibrary, parentId: string | null, ids: readonly string[]): TagLibrary {
    return carryProjectTreeOrder(library, reorderVersionTags(library, collection(library), 'level', parentId, ids).levelOrder!);
}
export function dragProjectTree(library: TagLibrary, id: string, anchor: string | null, after: boolean): TagLibrary {
    return carryProjectTreeOrder(library, dragSiblingOrder(library, collection(library), 'level', id, anchor, after).levelOrder!);
}
export function sortProjectTree(library: TagLibrary): TagLibrary {
    return carryProjectTreeOrder(library, sortVersionTagsByName(library, collection(library), 'level').levelOrder!);
}
