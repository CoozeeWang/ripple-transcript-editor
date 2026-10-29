import { describe, expect, it } from 'vitest';
import type { Segment, Transcript } from '../types';
import { emptyTagLibrary, isTagLibrary, sortTags, countProjectTags, filteredTagSegments, removeTagGroup, moveTagGroup, setSegmentTag, tagsForSegment, type TagLibrary } from './tags';
import { mergeSegmentWithNext, splitSegmentAt } from './segmentOps';
import { parseProject } from './projectStore';
const segment = (id: string, tagIds?: string[]): Segment => ({ id, text: 'Synthetic paragraph', speaker_id: 'speaker-a', start: 0, end: 10, ...(tagIds ? { tagIds } : {}) });
const transcript = (segments: Segment[]): Transcript => ({ audio: { filename: 'synthetic.wav', duration: 10 }, speakers: [], segments });
const library = (): TagLibrary => ({ schemaVersion: 1, tags: [{ id: 'tag-a', name: '家庭支持', groupIds: ['group-a', 'group-b'] }], groups: [{ id: 'group-a', name: '主题', parentId: null }, { id: 'group-b', name: '细节', parentId: 'group-a' }] });
describe('project tags', () => {
    it('opens legacy projects unchanged and validates optional definitions', () => {
        const legacy = { kind: 'ripple-project', schemaVersion: 1, id: 'synthetic-project', title: 'Synthetic', description: '', revision: 0, interviews: [] };
        expect(parseProject(JSON.stringify(legacy))).toEqual(legacy);
        expect(parseProject(JSON.stringify({ ...legacy, tagLibrary: library() })).tagLibrary).toEqual(library());
        expect(() => parseProject(JSON.stringify({ ...legacy, tagLibrary: { ...library(), schemaVersion: 2 } }))).toThrow();
    });
    it('rejects cycles, dangling memberships and equivalent names', () => {
        expect(isTagLibrary(emptyTagLibrary())).toBe(true);
        expect(isTagLibrary(library())).toBe(true);
        const cycle = library();
        cycle.groups[0].parentId = 'group-b';
        expect(isTagLibrary(cycle)).toBe(false);
        const dangling = library();
        dangling.tags[0].groupIds.push('missing');
        expect(isTagLibrary(dangling)).toBe(false);
        const duplicate = library();
        duplicate.tags = [{ id: 'a', name: 'Action', groupIds: [] }, { id: 'b', name: 'action', groupIds: [] }];
        expect(isTagLibrary(duplicate)).toBe(false);
    });
    it('updates one segment immutably, deduplicates and ignores absent entities', () => {
        const original = transcript([segment('s1'), segment('s2')]);
        const next = setSegmentTag(setSegmentTag(original, 's1', 'tag-a', true), 's1', 'tag-a', true);
        expect(original.segments[0].tagIds).toBeUndefined();
        expect(next.segments[0].tagIds).toEqual(['tag-a']);
        expect(next.segments[1]).toBe(original.segments[1]);
        expect(tagsForSegment(next.segments[0], emptyTagLibrary())).toEqual([]);
        expect(setSegmentTag(next, 's1', 'tag-a', false).segments[0].tagIds).toEqual([]);
    });
    it('keeps copied versions and split children independent', () => {
        const source = transcript([segment('s1', ['tag-a'])]), copy = structuredClone(source);
        expect(setSegmentTag(copy, 's1', 'tag-b', true).segments[0].tagIds).toEqual(['tag-a', 'tag-b']);
        expect(source.segments[0].tagIds).toEqual(['tag-a']);
        const parts = splitSegmentAt(source.segments, 's1', 10, undefined, 's2')!;
        expect(parts.map(s => s.tagIds)).toEqual([['tag-a'], ['tag-a']]);
        expect(parts[0].tagIds).not.toBe(parts[1].tagIds);
    });
    it('unions merge tags while retaining link and annotation identity', () => {
        const a = { ...segment('s1', ['tag-a']), annotations: [{ id: 'note-a', text: 'Synthetic', createdAt: '2026-01-01' }] };
        const merged = mergeSegmentWithNext([a, segment('s2', ['tag-a', 'tag-b'])], 's1')!;
        expect(merged[0].tagIds).toEqual(['tag-a', 'tag-b']);
        expect(merged[0].id).toBe('s1');
        expect(merged[0].annotations).toEqual(a.annotations);
    });
    it('counts each segment once and rejects duplicated historical representatives', () => {
        expect(countProjectTags([{ manuscriptId: 'doc-a', transcript: transcript([segment('s1', ['tag-a', 'tag-a'])]) }, { manuscriptId: 'doc-b', transcript: transcript([segment('s1', ['tag-a'])]) }]).get('tag-a')).toBe(2);
        expect(() => countProjectTags([{ manuscriptId: 'doc-a', transcript: transcript([]) }, { manuscriptId: 'doc-a', transcript: transcript([]) }])).toThrow();
    });
    it('filters complete versions by speaker/tag intersection in source order', () => {
        const a = segment('s1', ['tag-a']), b = { ...segment('s2', ['tag-a']), speaker_id: 'hidden' }, c = segment('s3');
        expect(filteredTagSegments(transcript([a, b, c]), new Set(['hidden']), 'tag-a')).toEqual([a]);
        expect(filteredTagSegments(transcript([a, b, c]), new Set(), null)).toEqual([a, b, c]);
    });
    it('removes only group membership and reparents children', () => {
        const original = library(), result = removeTagGroup(original, 'group-a');
        expect(result.tags[0].groupIds).toEqual(['group-b']);
        expect(result.groups[0].parentId).toBe(null);
        expect(original.tags[0].groupIds).toHaveLength(2);
    });
    it('outdents to root and rejects cycles', () => {
        const original = library();
        expect(moveTagGroup(original, 'group-a', 'group-b', 'inside')).toBe(original);
        expect(moveTagGroup(original, 'group-b', 'group-a', 'after').groups.map(g => g.parentId)).toEqual([null, null]);
    });
    it('sorts names by category naturally with reversed descending order', () => {
        const tags = ['!special', '中文', 'banana', '10', '2', 'Apple'].map((name, i) => ({ id: String(i), name, groupIds: [] }));
        const ascending = sortTags(tags, 'name', 1, () => 0).map(t => t.name);
        expect(ascending).toEqual(['2', '10', 'Apple', 'banana', '中文', '!special']);
        expect(sortTags(tags, 'name', -1, () => 0).map(t => t.name)).toEqual([...ascending].reverse());
        const collator = new Intl.Collator('zh-Hans-u-co-pinyin');
        // ICU reports default when pinyin is already the zh-Hans default.
        expect(collator.compare('阿', '波')).toBeLessThan(0);
        expect(collator.compare('張', '赵')).toBeLessThan(0);
    });
});
