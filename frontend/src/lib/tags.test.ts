import { describe, expect, it } from 'vitest';
import type { Segment, Transcript } from '../types';
import { emptyTagLibrary, isTagLibrary, sortTags, suggestTags, countProjectTags, filteredTagSegments, removeTagGroup, transferTagGroup, moveTagGroup, setSegmentTag, tagsForSegment, type TagLibrary } from './tags';
import { mergeSegmentWithNext, splitSegmentAt } from './segmentOps';
import { parseProject } from './projectStore';
const segment = (id: string, tagIds?: string[]): Segment => ({ id, text: 'Synthetic paragraph', speaker_id: 'speaker-a', start: 0, end: 10, ...(tagIds ? { tagIds } : {}) });
const transcript = (segments: Segment[]): Transcript => ({ audio: { filename: 'synthetic.wav', duration: 10 }, speakers: [], segments });
const library = (): TagLibrary => ({ schemaVersion: 1, tags: [{ id: 'tag-a', name: '家庭支持', groupIds: ['group-a', 'group-b'] }], groups: [{ id: 'group-a', name: '主题', parentId: null }, { id: 'group-b', name: '细节', parentId: 'group-a' }] });
describe('project tags', () => {
    it('moves only the source membership, copies one stable entity, and never treats ungrouped as a real target',()=>{
        const source={...library(),groups:[...library().groups,{id:'other',name:'Other',parentId:null}]};
        const moved=transferTagGroup(source,'tag-a','group-a','other',false);expect(moved.tags).toEqual([{...source.tags[0],groupIds:['group-b','other']}]);
        const copied=transferTagGroup(source,'tag-a','group-a','other',true);expect(copied.tags).toEqual([{...source.tags[0],groupIds:['group-a','group-b','other']}]);
        expect(transferTagGroup(source,'tag-a','group-a','group-b',true)).toBe(source);
        expect(transferTagGroup(source,'tag-a','group-a','group-b',false).tags[0].groupIds).toEqual(['group-b']);
        expect(transferTagGroup(source,'tag-a','group-a','group-a',false)).toBe(source);expect(transferTagGroup(source,'tag-a','group-a','ungrouped',false)).toBe(source);
        const ungrouped={...source,tags:[{...source.tags[0],groupIds:[]}]};
        expect(transferTagGroup(ungrouped,'tag-a',null,'other',true)).toEqual(transferTagGroup(ungrouped,'tag-a',null,'other',false));
        expect(transferTagGroup(ungrouped,'tag-a',null,'other',true).tags[0].groupIds).toEqual(['other']);expect(ungrouped.tags[0].groupIds).toEqual([]);
    });
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
    it('applies empty, single and multi-tag AND/OR selections with independent speaker intersection',()=>{
        const rows=transcript([segment('a',['A']),segment('both',['A','B','B']),segment('b',['B']),{...segment('hidden',['A','B']),speaker_id:'hidden'},segment('none')]);
        const hidden=new Set(['hidden']),ids=(mode:'and'|'or',selected:string[])=>filteredTagSegments(rows,hidden,{mode,ids:selected}).map(segment=>segment.id);
        expect(ids('and',[])).toEqual(['a','both','b','none']);expect(ids('or',[])).toEqual(ids('and',[]));
        expect(ids('and',['A'])).toEqual(['a','both']);expect(ids('or',['A'])).toEqual(['a','both']);
        expect(ids('and',['A','B','A'])).toEqual(['both']);expect(ids('or',['A','B'])).toEqual(['a','both','b']);expect(ids('and',['missing'])).toEqual([]);
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
    it('promotes children at the removed sibling slot, preserving child and sibling order', () => {
        const source = { ...library(), groups: [
            { id:'before', name:'Before', parentId:null }, { id:'parent', name:'Parent', parentId:null },
            { id:'after', name:'After', parentId:null }, { id:'c2', name:'Child 2', parentId:'parent' },
            { id:'deep', name:'Grandchild', parentId:'c2' }, { id:'c1', name:'Child 1', parentId:'parent' },
        ], tags:[{id:'tag-a',name:'Synthetic topic',groupIds:['parent','c2','before']}] };
        const result=removeTagGroup(source,'parent','level');
        expect(result.groups.filter(group=>group.parentId===null).map(group=>group.id)).toEqual(['before','c2','c1','after']);
        expect(result.groups.find(group=>group.id==='deep')?.parentId).toBe('c2');
        expect(result.tags).toEqual([{...source.tags[0],groupIds:['c2','before']}]);
        expect(source.groups).toHaveLength(6);
        const tree=removeTagGroup(source,'parent','tree');
        expect(tree.groups.map(group=>group.id)).toEqual(['before','after']);
        expect(tree.tags).toEqual([{...source.tags[0],groupIds:['before']}]);
    });
    it('suggests full substrings prefix-first, case-insensitively with stable name/ID ordering and assigned exclusion',()=>{
        const names=['First topic','Topic 10','Topic 2','a TOPIC','无关','Topic 2'];
        const tags=names.map((name,index)=>({id:String(index),name,groupIds:[]}));
        expect(suggestTags(tags,'tOpIc').map(tag=>tag.id)).toEqual(['2','5','1','3','0']);
        expect(suggestTags(tags,'topic',['2','5']).map(tag=>tag.name)).toEqual(['Topic 10','a TOPIC','First topic']);
        expect(suggestTags(tags,'pic 2').map(tag=>tag.id)).toEqual(['2','5']);
        expect(suggestTags(tags,' ')).toEqual([]);expect(suggestTags(tags,'missing')).toEqual([]);
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
