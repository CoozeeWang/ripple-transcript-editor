import { expect, it } from 'vitest';
import { createTagPresenter, presentSegmentTags, tagSegmentCounts,tagCoverageCounts } from './tagPresentation';
import { countTaggedSegments, setSegmentTag, type TagLibrary } from './tags';
import type { Transcript } from '../types';
const library: TagLibrary = { schemaVersion: 3, groups: [], tags: [
 { id: 'root', name: '经历', parentId: null, groupIds: [] },
 { id: 'child', name: '求学', parentId: 'root', groupIds: [] },
 { id: 'other', name: '工作', parentId: null, groupIds: [] },
] };
const transcript: Transcript = { audio: { filename: 'synthetic.wav', duration: 3 }, speakers: [], segments: [
 { id: 'a', start: 0, end: 1, speaker_id: 'speaker', text: '合成甲', tagIds: ['child'] },
 { id: 'b', start: 1, end: 2, speaker_id: 'speaker', text: '合成乙', tagIds: ['other'] },
 { id: 'c', start: 2, end: 3, speaker_id: 'speaker', text: '合成丙' },
] };
it('retains unrelated segment props for one association change and identical definition publication', () => {
 const present = createTagPresenter(), before = present(library, transcript.segments);
 expect(present(library, transcript.segments)).toBe(before);
 const next = setSegmentTag(transcript, 'a', 'root', true), after = present(structuredClone(library), next.segments);
 expect(after.available).toBe(before.available);
 expect(after.segments.get('b')).toBe(before.segments.get('b'));
 expect(after.segments.get('c')).toBe(before.segments.get('c'));
 expect(after.segments.get('a')?.tags.map(tag => tag.id)).toEqual(['root', 'child']);
 expect(next.segments[1]).toBe(transcript.segments[1]);expect(setSegmentTag(next, 'a', 'root', true)).toBe(next);
});
it('invalidates descendant paths on parent rename/move but leaves other branches unchanged', () => {
 const before = presentSegmentTags(library, transcript.segments);
 const renamed = { ...library, tags: library.tags.map(tag => tag.id === 'root' ? { ...tag, name: '成长' } : tag) };
 const after = presentSegmentTags(renamed, transcript.segments, before);
 expect(after.segments.get('a')?.tags).toBe(before.segments.get('a')?.tags);
 expect(after.segments.get('a')?.paths.child).toBe('成长/求学');expect(after.segments.get('b')).toBe(before.segments.get('b'));
 const moved = { ...renamed, tags: renamed.tags.map(tag => tag.id === 'child' ? { ...tag, parentId: 'other' } : tag) };
 expect(presentSegmentTags(moved, transcript.segments, after).segments.get('a')?.paths.child).toBe('工作/求学');
});
it('ignores group-only changes for segment rendering and drops deleted/dangling tag IDs', () => {
 const before = presentSegmentTags(library, transcript.segments);
 const grouped = { ...library, groups: [{ id: 'g', name: '合成组', parentId: null }], tags: library.tags.map(tag => ({ ...tag, groupIds: ['g'] })) };
 const after = presentSegmentTags(grouped, transcript.segments, before);expect(after.available).toBe(before.available);
 for (const segment of transcript.segments) expect(after.segments.get(segment.id)).toBe(before.segments.get(segment.id));
 const deleted = presentSegmentTags({ ...library, tags: library.tags.filter(tag => tag.id !== 'child') }, transcript.segments, after);
 expect(deleted.segments.get('a')?.tags).toEqual([]);expect(deleted.segments.get('b')).toBe(before.segments.get('b'));
});
it('counts exact explicit IDs, independently from hierarchical filtering', () => {
 expect(tagSegmentCounts(library,transcript.segments).get('root')).toBe(0);
 const next = setSegmentTag(transcript, 'a', 'root', true), counts = tagSegmentCounts(library, next.segments);
 for (const tag of library.tags) expect(counts.get(tag.id)).toBe(countTaggedSegments(next, tag.id, library));expect(counts.get('root')).toBe(1);
 expect(createTagPresenter()(library, transcript.segments).segments.get('a')).not.toBe(createTagPresenter()(library, transcript.segments).segments.get('a'));
});

it('keeps direct and descendant union counts distinct when one segment has several matching labels',()=>{
 const library:TagLibrary={schemaVersion:3,groups:[],tags:[{id:'r',name:'Root',parentId:null,groupIds:[]},{id:'a',name:'A',parentId:'r',groupIds:[]},{id:'b',name:'B',parentId:'r',groupIds:[]}]};
 const segments=[{id:'s1',text:'Synthetic',speaker_id:'v',start:0,end:1,tagIds:['a','b']},{id:'s2',text:'Synthetic',speaker_id:'v',start:1,end:2,tagIds:['r','a']}];
 expect(tagSegmentCounts(library,segments).get('r')).toBe(1);expect(tagCoverageCounts(library,segments).get('r')).toBe(2);expect(tagCoverageCounts(library,segments).get('a')).toBe(2);
});
