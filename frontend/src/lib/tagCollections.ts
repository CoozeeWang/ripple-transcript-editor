import type { Transcript } from '../types';
import {
    descendantTagIds, hierarchyLibrary, isTagLibrary, normalizeTagName, segmentTagIds,
    setTagPath, splitTagPath, tagAncestors, tagParentId, tagPath, TagTreeError,
    type ProjectTag, type TagLibrary,
} from './tags';

/** Definitions live in the project; these explicit memberships belong to one saved version. */
/** order may retain invisible real ancestors as branch-position anchors, never as group members. */
export interface VersionTagGroup { id: string; name: string; tagIds: string[]; order?:string[] }
export interface TagCollection { schemaVersion: 1; tagIds: string[]; groups: VersionTagGroup[]; levelOrder?:string[];ungroupedOrder?:string[] }
export interface TagConsumer { id: string; label: string; transcript: Transcript }
const key = (name: string) => normalizeTagName(name).toLowerCase();
const unique = (ids: readonly string[]) => [...new Set(ids)];
const identity = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(id);

export class TagCollectionConflict extends Error {
    constructor(readonly consumer: string, readonly paths: readonly string[]) {
        super('tag_collection_name_conflict'); this.name = 'TagCollectionConflict';
    }
}
export class TagMergeRequired extends Error {
    constructor(readonly sourceId: string, readonly targetId: string, readonly path: string, readonly affected: number) {
        super('tag_merge_confirmation_required'); this.name = 'TagMergeRequired';
    }
}

/** Safe, read-only upgrade. A caller persists this only with an explicit transaction. */
export function projectTagCatalog(source: TagLibrary): TagLibrary {
    const library = hierarchyLibrary(source);
    const legacyGroups = library.legacyGroups ?? (library.schemaVersion !== 3 && library.groups.length ? { groups: library.groups,
        memberships: library.tags.filter(tag => tag.groupIds.length).map(tag => ({ tagId: tag.id, groupIds: tag.groupIds })) } : undefined);
    const catalog: TagLibrary = { schemaVersion: 3, tags: library.tags.map(tag => ({ ...tag, groupIds: [] })), groups: [], ...(legacyGroups ? { legacyGroups } : {}) };
    if (!isTagLibrary(catalog)) throw new TagTreeError('invalid_tree');
    return catalog;
}

export function isTagCollection(value: unknown): value is TagCollection {
    if (!value || typeof value !== 'object') return false;
    const c = value as TagCollection;
    const order=(ids:unknown)=>ids===undefined||Array.isArray(ids)&&ids.every(identity)&&unique(ids).length===ids.length;
    return c.schemaVersion === 1 && Array.isArray(c.tagIds) && c.tagIds.every(identity)
        && order(c.levelOrder)&&order(c.ungroupedOrder)
        && unique(c.tagIds).length === c.tagIds.length && Array.isArray(c.groups)
        && new Set(c.groups.map(group => group?.id)).size === c.groups.length
        && c.groups.every(group => group && identity(group.id) && typeof group.name === 'string'
            && !!normalizeTagName(group.name) && group.name.length <= 120
            && Array.isArray(group.tagIds) && group.tagIds.every(id => identity(id) && c.tagIds.includes(id))
            && unique(group.tagIds).length === group.tagIds.length&&order(group.order)&&(!group.order||group.order.every(id=>c.tagIds.includes(id))));
}

export function withAncestors(library: TagLibrary, ids: readonly string[]): string[] {
    const valid = new Set(library.tags.map(tag => tag.id));
    const result = new Set<string>();
    for (const id of ids) {
        if (!valid.has(id)) throw new TagTreeError('invalid_tree', id);
        result.add(id);
        for (const ancestor of tagAncestors(library, id)) result.add(ancestor.id);
    }
    return [...result];
}

/** Legacy definitions remain in the project. Actual associations and grouped tags retain their IDs. */
export function versionTagCollection(transcript: Transcript, source: TagLibrary): TagCollection {
    if (transcript.tagCollection !== undefined) {
        if (!isTagCollection(transcript.tagCollection)) throw new TagTreeError('invalid_tree');
        return transcript.tagCollection;
    }
    const definitions = hierarchyLibrary(source);
    const library = definitions.legacyGroups ? { ...definitions, groups: definitions.legacyGroups.groups,
        tags: definitions.tags.map(tag => ({ ...tag, groupIds: definitions.legacyGroups!.memberships.find(item => item.tagId === tag.id)?.groupIds ?? [] })) } : definitions;
    const known = new Set(library.tags.map(tag => tag.id)), ids = withAncestors(library,
        unique([...transcript.segments.flatMap(segmentTagIds).filter(id => known.has(id)), ...library.tags.filter(tag => tag.groupIds.length).map(tag => tag.id)]));
    const included = new Set(ids);
    return { schemaVersion: 1, tagIds: ids, groups: library.groups.map(group => ({
        id: group.id, name: group.name,
        tagIds: library.tags.filter(tag => included.has(tag.id) && tag.groupIds.includes(group.id)).map(tag => tag.id),
    })) };
}

export function validateTagCollection(library: TagLibrary, collection: TagCollection, consumer = ''): void {
    if (!isTagLibrary(library) || !isTagCollection(collection)) throw new TagTreeError('invalid_tree');
    const ids = new Set(collection.tagIds), names = new Map<string, string>();
    for (const id of collection.tagIds) {
        const tag = library.tags.find(tag => tag.id === id);
        if (!tag || tagAncestors(library, id).some(ancestor => !ids.has(ancestor.id))) throw new TagTreeError('invalid_tree');
        const prior = names.get(key(tag.name));
        if (prior && prior !== id) throw new TagCollectionConflict(consumer, [tagPath(library, prior), tagPath(library, id)]);
        names.set(key(tag.name), id);
    }
}

export function admitTags(library: TagLibrary, collection: TagCollection, ids: readonly string[], consumer = ''): TagCollection {
    const next = { ...collection, tagIds: withAncestors(library, unique([...collection.tagIds, ...ids])) };
    validateTagCollection(library, next, consumer);
    return next;
}

/** UI projection only: group IDs never become shared definition data. */
export function collectionLibrary(catalog: TagLibrary, collection: TagCollection): TagLibrary {
    return { ...catalog, groups: collection.groups.map(group => ({ id: group.id, name: group.name, parentId: null })),
        tags: catalog.tags.map(tag => ({ ...tag, groupIds: collection.groups.filter(group => group.tagIds.includes(tag.id)).map(group => group.id) })) };
}

export function collectionFromLibrary(library: TagLibrary, before: TagCollection, consumer = ''): TagCollection {
    const groups = library.groups.map(group => {
        const tagIds=library.tags.filter(tag=>tag.groupIds.includes(group.id)).map(tag=>tag.id),display=new Set(withAncestors(library,tagIds));
        const order=before.groups.find(old=>old.id===group.id)?.order;
        return{id:group.id,name:group.name,tagIds,...(order?{order:order.filter(id=>display.has(id))}:{})};
    });
    const admitted = admitTags(library, before, groups.flatMap(group => group.tagIds), consumer);
    return { ...admitted, groups };
}

/** Remove only this version's admitted branch; unused ancestors outside it remain admitted. */
export function removeVersionTagBranch(library: TagLibrary, transcript: Transcript, id: string): Transcript {
    const before = versionTagCollection(transcript, library);
    const removed = new Set(descendantTagIds(library, id).filter(id => before.tagIds.includes(id)));
    if (!removed.size) return transcript;
    const collection: TagCollection = { ...before, tagIds: before.tagIds.filter(id => !removed.has(id)),
        groups: before.groups.map(group => ({ ...group, tagIds: group.tagIds.filter(id => !removed.has(id)),...(group.order?{order:group.order.filter(id=>!removed.has(id))}:{}) })) };
    validateTagCollection(library, collection);
    return { ...transcript, tagCollection: collection,
        segments: transcript.segments.map(segment => segment.tagIds?.some(id => removed.has(id))
            ? { ...segment, tagIds: segment.tagIds.filter(id => !removed.has(id)) } : segment) };
}

/** Preflight a shared rename/move. Exact-path merges are proposals until explicitly confirmed. */
export function changeSharedTag(source: TagLibrary, id: string, raw: string, consumers: readonly TagConsumer[], merge = false): {
    library: TagLibrary; consumers: TagConsumer[]; remap: ReadonlyMap<string, string>;
} {
    const library = projectTagCatalog(source), parts = splitTagPath(raw), node = library.tags.find(tag => tag.id === id);
    if (!node) throw new TagTreeError('invalid_tree');
    const prefix = parts.slice(0, -1);
    const prepared = prefix.length ? setTagPath(library, prefix.join('/')) : { library, tag: undefined };
    const parentId = prepared.tag?.id ?? null;
    if (parentId && descendantTagIds(library, id).includes(parentId)) throw new TagTreeError('cycle');
    const subtree = new Set(descendantTagIds(library, id)), remap = new Map<string, string>();
    const tags = prepared.library.tags.filter(tag => !subtree.has(tag.id)).map(tag => ({ ...tag }));
    const visit = (tag: ProjectTag, parentId: string | null, name: string) => {
        const match = tags.find(other => tagParentId(other) === parentId && key(other.name) === key(name));
        if (match) remap.set(tag.id, match.id);
        else tags.push({ ...tag, name, parentId });
        const nextParent = match?.id ?? tag.id;
        for (const child of library.tags.filter(child => tagParentId(child) === tag.id)) visit(child, nextParent, child.name);
    };
    visit(node, parentId, parts.at(-1)!);
    const legacyGroups = library.legacyGroups ? { ...library.legacyGroups,
        memberships: [...new Set(library.legacyGroups.memberships.map(item => remap.get(item.tagId) ?? item.tagId))].map(tagId => ({ tagId,
            groupIds: unique(library.legacyGroups!.memberships.filter(item => (remap.get(item.tagId) ?? item.tagId) === tagId).flatMap(item => item.groupIds)) })) } : undefined;
    const next: TagLibrary = { schemaVersion: 3, tags, groups: [], ...(legacyGroups ? { legacyGroups } : {}) };
    if (!isTagLibrary(next)) throw new TagTreeError('invalid_tree');
    const mapped = consumers.map(consumer => {
        const previous = versionTagCollection(consumer.transcript, source);
        const mapIds = (ids: readonly string[]) => unique(ids.map(id => remap.get(id) ?? id));
        const collection: TagCollection = { ...previous, tagIds: withAncestors(next, mapIds(previous.tagIds)),
            ...(previous.levelOrder?{levelOrder:mapIds(previous.levelOrder)}:{}),...(previous.ungroupedOrder?{ungroupedOrder:mapIds(previous.ungroupedOrder)}:{}),
            groups: previous.groups.map(group => ({ ...group, tagIds: mapIds(group.tagIds),...(group.order?{order:mapIds(group.order)}:{}) })) };
        validateTagCollection(next, collection, consumer.label);
        return { ...consumer, transcript: { ...consumer.transcript, tagCollection: collection,
            segments: consumer.transcript.segments.map(segment => {
                if(!segment.tagIds)return segment;
                const ids=mapIds(segmentTagIds(segment));
                return ids.length===segment.tagIds.length&&ids.every((id,i)=>id===segment.tagIds![i])?segment:{...segment,tagIds:ids};
            }) } };
    });
    if (remap.size && !merge) throw new TagMergeRequired(id, remap.get(id)!, raw, remap.size);
    return { library: next, consumers: mapped, remap };
}
