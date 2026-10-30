import type { Segment } from '../types';
import { segmentTagIds, tagAncestors, tagPath, type ProjectTag, type TagLibrary } from './tags';

export interface SegmentTagPresentation { tags: ProjectTag[]; paths: Record<string, string> }
export interface TagPresentation {
    available: ProjectTag[];
    segments: Map<string, SegmentTagPresentation>;
}
/** Bounded, per-editor projection cache; no project or transcript is retained after its replacement. */
export function createTagPresenter() {
    let previous: TagPresentation | undefined, tags: TagLibrary['tags'] | undefined, rows: readonly Segment[] | undefined;
    return (library: TagLibrary, segments: readonly Segment[]) => {
        if (library.tags !== tags || segments !== rows) {
            previous = presentSegmentTags(library, segments, previous); tags = library.tags; rows = segments;
        }
        return previous!;
    };
}
const equalItems = <T,>(a: readonly T[] | undefined, b: readonly T[]) => a?.length === b.length && a.every((item, i) => item === b[i]);

/** Group membership is not segment display data. Retain unchanged row props across project publication. */
export function presentSegmentTags(library: TagLibrary, segments: readonly Segment[], previous?: TagPresentation): TagPresentation {
    const oldTags = new Map(previous?.available.map(tag => [tag.id, tag]));
    const next = library.tags.map(tag => {
        const old = oldTags.get(tag.id);
        return old && old.name === tag.name && old.parentId === tag.parentId ? old
            : { id: tag.id, name: tag.name, parentId: tag.parentId, groupIds: [] };
    });
    const available = equalItems(previous?.available, next) ? previous!.available : next;
    const byId = new Map(available.map((tag, index) => [tag.id, { tag, index }]));
    const paths = new Map(available.map(tag => [tag.id, tagPath(library, tag.id)]));
    const rows = new Map<string, SegmentTagPresentation>();
    for (const segment of segments) {
        const tags = segmentTagIds(segment).flatMap(id => byId.has(id) ? [byId.get(id)!] : [])
            .sort((a, b) => a.index - b.index).map(item => item.tag);
        const old = previous?.segments.get(segment.id);
        const sameTags = equalItems(old?.tags, tags);
        const samePaths = old && Object.keys(old.paths).length === tags.length && tags.every(tag => old.paths[tag.id] === paths.get(tag.id));
        rows.set(segment.id, sameTags && samePaths ? old : {
            tags: sameTags ? old!.tags : tags,
            paths: samePaths ? old!.paths : Object.fromEntries(tags.map(tag => [tag.id, paths.get(tag.id)!])),
        });
    }
    return { available, segments: rows };
}

/** One segment contributes once to each direct tag/ancestor, even if several descendants match. */
export function tagSegmentCounts(library: TagLibrary, segments: readonly Segment[]): Map<string, number> {
    const scopes = new Map(library.tags.map(tag => [tag.id, [tag.id, ...tagAncestors(library, tag.id).map(parent => parent.id)]]));
    const result = new Map(library.tags.map(tag => [tag.id, 0]));
    for (const segment of segments) {
        const hit = new Set(segmentTagIds(segment).flatMap(id => scopes.get(id) ?? []));
        for (const id of hit) result.set(id, result.get(id)! + 1);
    }
    return result;
}
