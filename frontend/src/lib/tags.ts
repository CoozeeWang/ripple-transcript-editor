import type { Segment, Transcript } from '../types';
/** Definitions are project-owned. Segment associations belong to one version. */
export interface ProjectTag {
    id: string;
    name: string;
    groupIds: string[];
}
export interface TagGroup {
    id: string;
    name: string;
    parentId: string | null;
}
export interface TagLibrary {
    schemaVersion: 1;
    tags: ProjectTag[];
    groups: TagGroup[];
}
export const emptyTagLibrary = (): TagLibrary => ({ schemaVersion: 1, tags: [], groups: [] });
const identity = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export const normalizeTagName = (name: string): string => name.trim().normalize('NFC');
const validName = (name: unknown): name is string => typeof name === 'string' && !!normalizeTagName(name) && name.length <= 120 && !Array.from(name).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
/** Optional extension: absence means an empty library, never a write-on-open migration. */
export function isTagLibrary(value: unknown): value is TagLibrary {
    if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.tags) || !Array.isArray(value.groups))
        return false;
    const groups = new Map<string, string | null>();
    for (const group of value.groups) {
        if (!record(group) || !identity(group.id) || groups.has(group.id) || !validName(group.name) || (group.parentId !== null && !identity(group.parentId)))
            return false;
        groups.set(group.id, group.parentId as string | null);
    }
    for (const [id, parent] of groups) {
        const seen = new Set([id]);
        let next = parent;
        while (next !== null) {
            if (!groups.has(next) || seen.has(next))
                return false;
            seen.add(next);
            next = groups.get(next)!;
        }
    }
    const ids = new Set<string>(), names = new Set<string>();
    for (const tag of value.tags) {
        if (!record(tag) || !identity(tag.id) || ids.has(tag.id) || !validName(tag.name) || !Array.isArray(tag.groupIds) || !tag.groupIds.every(id => typeof id === 'string' && groups.has(id)) || new Set(tag.groupIds).size !== tag.groupIds.length)
            return false;
        const name = normalizeTagName(tag.name).toLowerCase();
        if (names.has(name))
            return false;
        ids.add(tag.id);
        names.add(name);
    }
    return true;
}
const pinyin = new Intl.Collator('zh-Hans-u-co-pinyin', { numeric: true, sensitivity: 'base' });
const unicode = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const bucket = (s: string) => /^\p{Number}/u.test(s) ? 0 : /^\p{Script=Latin}/u.test(s) ? 1 : /^\p{Script=Han}/u.test(s) ? 2 : 3;
export function compareTagNames(a: string, b: string): number {
    const x = a.trim(), y = b.trim();
    return bucket(x) - bucket(y) || pinyin.compare(x, y) || unicode(x, y);
}
export function sortTags(tags: readonly ProjectTag[], key: 'name' | 'count', direction: 1 | -1, count: (id: string) => number): ProjectTag[] {
    return [...tags].sort((a, b) => key === 'count' ? direction * (count(a.id) - count(b.id)) || compareTagNames(a.name, b.name) || unicode(a.id, b.id) : direction * (compareTagNames(a.name, b.name) || unicode(a.id, b.id)));
}
export function segmentTagIds(segment: Segment): string[] {
    return [...new Set(Array.isArray(segment.tagIds) ? segment.tagIds.filter(identity) : [])];
}
/** Full substring matching; prefix matches precede infix matches, then normal name/ID order. */
export function suggestTags(tags: readonly ProjectTag[], input: string, assigned: readonly string[] = []): ProjectTag[] {
    const query = input.trim().toLowerCase(), excluded = new Set(assigned);
    if (!query) return [];
    const matches = sortTags(tags.filter(tag => !excluded.has(tag.id) && tag.name.toLowerCase().includes(query)), 'name', 1, () => 0);
    return [...matches.filter(tag => tag.name.toLowerCase().startsWith(query)), ...matches.filter(tag => !tag.name.toLowerCase().startsWith(query))];
}
/** All read paths ignore dangling IDs. A deleted entity never matches by name. */
export function tagsForSegment(segment: Segment, library: TagLibrary): ProjectTag[] {
    const ids = new Set(segmentTagIds(segment));
    return library.tags.filter(tag => ids.has(tag.id));
}
export function countTaggedSegments(transcript: Transcript, tagId: string): number {
    return transcript.segments.filter(segment => segmentTagIds(segment).includes(tagId)).length;
}
/** Caller supplies exactly one representative version per manuscript, not its history. */
export function countProjectTags(versions: readonly {
    manuscriptId: string;
    transcript: Transcript;
}[]): Map<string, number> {
    const counts = new Map<string, number>(), manuscripts = new Set<string>();
    for (const version of versions) {
        if (manuscripts.has(version.manuscriptId))
            throw new Error('duplicate_manuscript_representative');
        manuscripts.add(version.manuscriptId);
        for (const segment of version.transcript.segments)
            for (const id of segmentTagIds(segment))
                counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
}
export function setSegmentTag(transcript: Transcript, segmentId: string, tagId: string, enabled: boolean): Transcript {
    if (!identity(tagId))
        throw new Error('invalid_tag_identity');
    return { ...transcript, segments: transcript.segments.map(segment => segment.id !== segmentId ? segment : { ...segment, tagIds: enabled ? [...new Set([...segmentTagIds(segment), tagId])] : segmentTagIds(segment).filter(id => id !== tagId) }) };
}
export type TagFilter = string | { ids: readonly string[]; mode: 'and' | 'or' } | null;
export function matchesTagFilter(segment: Segment, filter: TagFilter): boolean {
    if (!filter) return true;
    const ids = typeof filter === 'string' ? [filter] : [...new Set(filter.ids)];
    if (!ids.length) return true;
    const assigned = new Set(segmentTagIds(segment));
    return typeof filter === 'string' || filter.mode === 'and' ? ids.every(id => assigned.has(id)) : ids.some(id => assigned.has(id));
}
export function filteredTagSegments(transcript: Transcript, hiddenSpeakers: ReadonlySet<string>, filter: TagFilter): Segment[] {
    return transcript.segments.filter(segment => !hiddenSpeakers.has(segment.speaker_id) && matchesTagFilter(segment, filter));
}
export function removeTagGroup(library: TagLibrary, groupId: string, scope: 'level' | 'tree' = 'level'): TagLibrary {
    const group = library.groups.find(group => group.id === groupId);
    if (!group)
        return library;
    const removed = new Set([groupId]);
    if (scope === 'tree') {
        for (let changed = true; changed;) {
            changed = false;
            for (const child of library.groups) if (child.parentId && removed.has(child.parentId) && !removed.has(child.id)) {
                removed.add(child.id);
                changed = true;
            }
        }
    }
    const children = library.groups.filter(child => child.parentId === groupId);
    const childIds = new Set(children.map(child => child.id));
    const groups = scope === 'tree' ? library.groups.filter(item => !removed.has(item.id))
        : library.groups.flatMap(item => item.id === groupId
            ? children.map(child => ({ ...child, parentId: group.parentId }))
            : childIds.has(item.id) ? [] : [item]);
    return { ...library, groups, tags: library.tags.map(tag => ({ ...tag, groupIds: tag.groupIds.filter(id => !removed.has(id)) })) };
}
/** Move only the explicit source membership; copying always reuses the same tag entity. */
export function transferTagGroup(library: TagLibrary, tagId: string, sourceId: string | null, targetId: string, copy: boolean): TagLibrary {
    const tag = library.tags.find(tag => tag.id === tagId);
    if (!tag || sourceId === targetId || !library.groups.some(group => group.id === targetId)) return library;
    if (sourceId ? !tag.groupIds.includes(sourceId) : tag.groupIds.length > 0) return library;
    const groupIds = sourceId && !copy ? tag.groupIds.filter(id => id !== sourceId) : [...tag.groupIds];
    if (!groupIds.includes(targetId)) groupIds.push(targetId);
    if (groupIds.length === tag.groupIds.length && groupIds.every((id, index) => id === tag.groupIds[index])) return library;
    return { ...library, tags: library.tags.map(item => item.id === tagId ? { ...item, groupIds } : item) };
}
export function moveTagGroup(library: TagLibrary, sourceId: string, targetId: string | null, mode: 'before' | 'after' | 'inside'): TagLibrary {
    const source = library.groups.find(group => group.id === sourceId), target = library.groups.find(group => group.id === targetId);
    if (!source || (targetId !== null && !target) || sourceId === targetId)
        return library;
    const parentId = mode === 'inside' ? targetId : target?.parentId ?? null;
    let ancestor = parentId;
    while (ancestor) {
        if (ancestor === sourceId)
            return library;
        ancestor = library.groups.find(group => group.id === ancestor)?.parentId ?? null;
    }
    const groups = library.groups.filter(group => group.id !== sourceId), position = target ? groups.findIndex(group => group.id === targetId) + (mode === 'before' ? 0 : 1) : groups.length;
    groups.splice(position, 0, { ...source, parentId });
    return { ...library, groups };
}

/** Editable content only: audio playback anchoring and cursor metadata are not edits. */
export function tagHistoryAnchor(transcript:Transcript|null):string {
 return JSON.stringify(transcript?{speakers:transcript.speakers,segments:transcript.segments.map(segment=>[segment.id,segment.text,segment.speaker_id,segment.tagIds,segment.annotations,segment.highlights])}:null);
}
