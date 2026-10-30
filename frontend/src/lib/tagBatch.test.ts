import { describe,it,expect } from 'vitest';
import { applyTagBatch,validateTagChanges,tagBatchScope,type TagChange } from './tagBatch';
import { emptyTagLibrary,tagPath } from './tags';
import type { Transcript } from '../types';
const transcript=():Transcript=>({audio:{filename:'synthetic.wav',duration:2},speakers:[],segments:[{id:'s',text:'Synthetic public test',speaker_id:'p',start:0,end:2}]});
function run(changes:TagChange[]){return applyTagBatch(emptyTagLibrary(),[{id:'a',label:'Synthetic A',transcript:transcript()},{id:'b',label:'Synthetic B',transcript:transcript()}],'a',changes)}
describe('atomic tag batch business operations',()=>{
 it('creates paths, admits ancestors, assigns only selected ID and keeps other versions independent',()=>{
  const r=run([{action:'create_tag',path:'经历/求学/小学',ref:'school'},{action:'assign_tags',segment_ids:['s'],tag_ids:['ref:school']}]);
  expect(r.consumers[0].transcript.tagCollection?.tagIds).toHaveLength(3);
  expect(r.consumers[0].transcript.segments[0].tagIds).toEqual([r.references.tags.school]);
  expect(r.consumers[1].transcript.segments[0].tagIds).toBeUndefined();
  expect(r.consumers[1].transcript.tagCollection?.tagIds).toEqual([]);
 });
 it('manages flat groups explicitly without parent selection cascading or changing hierarchy',()=>{
  const r=run([{action:'create_tag',path:'经历/求学',ref:'school'},{action:'create_group',name:'甲',ref:'a'},
   {action:'create_group',name:'乙',ref:'b'},{action:'set_group_tags',group_id:'ref:a',tag_ids:['ref:school']},
   {action:'transfer_group_tag',tag_id:'ref:school',source_group_id:'ref:a',group_id:'ref:b',copy:true},
   {action:'rename_group',group_id:'ref:b',name:'新乙'},{action:'reorder_groups',group_ids:['ref:b','ref:a']}]);
  const groups=r.consumers[0].transcript.tagCollection!.groups;
  expect(groups.map(g=>g.name)).toEqual(['新乙','甲']);expect(groups.every(g=>g.tagIds.length===1)).toBe(true);
  const moved=applyTagBatch(r.library,r.consumers,'a',[{action:'transfer_group_tag',tag_id:r.references.tags.school,source_group_id:r.references.groups.a,group_id:r.references.groups.b,copy:false},{action:'dissolve_group',group_id:r.references.groups.a}]);
  expect(moved.consumers[0].transcript.tagCollection!.groups).toHaveLength(1);expect(tagPath(moved.library,r.references.tags.school)).toBe('经历/求学');
 });
 it('rejects an entire batch when a later operation fails, never mutating its input',()=>{
  const library=emptyTagLibrary(),t=transcript(),before=structuredClone(t);
  expect(()=>applyTagBatch(library,[{id:'a',label:'A',transcript:t}],'a',[
   {action:'create_tag',path:'主题',ref:'x'},{action:'assign_tags',tag_ids:['ref:x'],segment_ids:['missing']}])).toThrow('segment_not_found');
  expect(library.tags).toEqual([]);expect(t).toEqual(before);
 });
 it('requires explicit merge, retains references and removes only current branch usage',()=>{
  const first=run([{action:'create_tag',path:'甲/小学',ref:'a'},{action:'create_tag',path:'乙/童年',ref:'b'},
   {action:'assign_tags',segment_ids:['s'],tag_ids:['ref:a','ref:b']}]);
  const a=first.references.tags.a,b=first.references.tags.b;
  expect(()=>applyTagBatch(first.library,first.consumers,'a',[{action:'set_tag_path',tag_id:a,path:'乙/童年'}])).toThrow('tag_merge');
  const merged=applyTagBatch(first.library,first.consumers,'a',[{action:'merge_tag',tag_id:a,target_tag_id:b}]);
  expect(merged.consumers[0].transcript.segments[0].tagIds).toEqual([b]);
  const removed=applyTagBatch(merged.library,merged.consumers,'a',[{action:'remove_current_branch',tag_id:b}]);
  expect(removed.library.tags.some(t=>t.id===b)).toBe(true);expect(removed.consumers[0].transcript.segments[0].tagIds).toEqual([]);
 });
 it('renames, moves, unassigns and deletes shared branches without touching text',()=>{
  const r=run([{action:'create_tag',path:'根/子',ref:'child'},{action:'rename_tag',tag_id:'ref:child',name:'新子'},
   {action:'move_tag',tag_id:'ref:child',parent_id:null},{action:'assign_tags',segment_ids:['s'],tag_ids:['ref:child']},
   {action:'unassign_tags',segment_ids:['s'],tag_ids:['ref:child']}]);
  expect(tagPath(r.library,r.references.tags.child)).toBe('新子');
  const gone=applyTagBatch(r.library,r.consumers,'a',[{action:'delete_branch',tag_id:r.references.tags.child}]);
  expect(gone.consumers[0].transcript.segments[0].text).toBe('Synthetic public test');
  expect(gone.library.tags.some(t=>t.id===r.references.tags.child)).toBe(false);
 });
 it('validates capabilities, rejects unrelated fields and chooses narrow scopes',()=>{
  expect(()=>validateTagChanges([{action:'delete_branch',tag_id:'x'}],['assign_tags'])).toThrow('outside_allowed');
  expect(()=>validateTagChanges([{action:'create_tag',path:'x',text:'not allowed'}],['create_tag'])).toThrow('invalid_tag_change');
  expect(tagBatchScope([{action:'assign_tags'}])).toBe('current');expect(tagBatchScope([{action:'create_tag'}])).toBe('additions');expect(tagBatchScope([{action:'move_tag'}])).toBe('project');
 });
});
