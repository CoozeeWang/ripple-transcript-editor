// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { useProjectTags, type TagStorage } from './useProjectTags';
import { useTranscriptHistory } from '../useTranscriptHistory';
import type { Transcript } from '../types';
import type { OpenProject } from '../lib/projectStore';
import {tagFields} from '../lib/projectTagRepository';
import { versionTagCollection } from '../lib/tagCollections';
import { removeTagBranch, tagPath, type TagLibrary } from '../lib/tags';
const source = (): Transcript => ({ audio: { filename: 'synthetic.wav', duration: 2 }, speakers: [], segments: [{ id: 's', speaker_id: 'v', text: 'Synthetic text', start: 0, end: 2 }] });
afterEach(cleanup);
function setup(shared=false,twoSegments=false) {
 const writes = vi.fn(async () => {}), errors = vi.fn(), flush = vi.fn(async () => {}), lock = vi.fn();
 const hook = renderHook(({ readOnly, context }: {readOnly:boolean;context:string}) => {
  const [library, setLibrary] = useState<TagLibrary>(shared?{schemaVersion:4,tags:[],groups:[],treeOrder:[]}:{schemaVersion:3,tags:[],groups:[]}), history = useTranscriptHistory<Transcript>();
  const initial=source();if(twoSegments)initial.segments.push({...initial.segments[0],id:'s2'});
  const value = history.transcript ?? initial;
  const storage: TagStorage = {
   transact: async (current, operation) => {
    const previous = {...current.transcript,tagCollection:versionTagCollection(current.transcript,library)};
    const result = operation(library,[{id:'r:m:e',label:'Synthetic version',transcript:previous}],'r:m:e');
    await writes();setLibrary(result.library);
    return {changed:JSON.stringify(previous)!==JSON.stringify(result.consumers[0].transcript)||JSON.stringify(library)!==JSON.stringify(result.library),project:{} as OpenProject,transcript:result.consumers[0].transcript,receipt:{beforeLibrary:library,afterLibrary:result.library,versions:[{id:'r:m:e',path:['synthetic.json'],before:tagFields(previous),after:tagFields(result.consumers[0].transcript)}]}};
   },
   restore: async(receipt,redo)=>{await writes();setLibrary(redo?receipt.afterLibrary:receipt.beforeLibrary);return {} as OpenProject},
  };
  const tags=useProjectTags({library,storage,recordingId:'r',modelId:'m',editId:'e',context,transcript:value,flush,lock,readOnly,undoActionKey:history.undoActionKey,redoActionKey:history.redoActionKey,onError:errors,errorMessage:'Synthetic failure',publish:(next,action,key,rebase)=>{
   if(action==='rebase')history.rebase(rebase!,next);else if(action==='undo')history.undo();else if(action==='redo')history.redo();else if(!history.transcript){history.reset(value);history.commit(()=>next,key)}else history.commit(()=>next,key);
  }});
  return {...tags,transcript:value,editText:()=>history.commit(t=>({...t,segments:t.segments.map(s=>({...s,text:'Later text'}))})),undoText:history.undo,redoText:history.redo,editorCanUndo:history.canUndo,editorCanRedo:history.canRedo};
 },{initialProps:{readOnly:false,context:'v1'}});
 return {...hook,writes,errors,flush,lock};
}
it('keeps project name sorting across tag undo/redo while preserving legacy collections',async()=>{
 const h=setup(true);await act(()=>h.result.current.create('Root/Zeta'));await act(()=>h.result.current.create('Root/Alpha'));
 const id=(name:string)=>h.result.current.library.tags.find(tag=>tag.name===name)!.id;
 await act(()=>h.result.current.reorder('level',id('Zeta'),id('Alpha'),false));const collection=h.result.current.collection;
 await act(()=>h.result.current.sortByName('level'));const sorted=[id('Root'),id('Alpha'),id('Zeta')];expect(h.result.current.library.treeOrder).toEqual(sorted);expect(h.result.current.collection).toEqual(collection);
 await act(()=>h.result.current.undo());expect(h.result.current.library.treeOrder).toEqual(sorted);
 await act(()=>h.result.current.undo());expect(h.result.current.library.tags.some(tag=>tag.name==='Alpha')).toBe(false);expect(h.result.current.library.treeOrder).toEqual([id('Root'),id('Zeta')]);
 await act(()=>h.result.current.redo());expect(h.result.current.library.treeOrder).toEqual(sorted);
 await expect(h.result.current.sortByName('groups')).rejects.toThrow('unsupported_tag_operation');
});
it('preserves body undo after a shared project name sort',async()=>{
 const h=setup(true);await act(()=>h.result.current.create('Root/Zeta'));await act(()=>h.result.current.create('Root/Alpha'));act(()=>h.result.current.editText());
 await act(()=>h.result.current.sortByName('level'));const order=h.result.current.library.treeOrder;act(()=>h.result.current.undoText());expect(h.result.current.transcript.segments[0].text).toBe('Synthetic text');expect(h.result.current.library.treeOrder).toEqual(order);
});
it('admits ancestors and assigns only the leaf in one reversible transaction',async()=>{
 const h=setup();await act(()=>h.result.current.add('s','经历/求学/小学'));const leaf=h.result.current.library.tags.find(t=>t.name==='小学')!;
 expect(h.writes).toHaveBeenCalledTimes(1);expect(h.result.current.collection.tagIds).toHaveLength(3);expect(h.result.current.transcript.segments[0].tagIds).toEqual([leaf.id]);expect(h.result.current.canUndo).toBe(true);
 await act(()=>h.result.current.undo());expect(h.result.current.library.tags).toEqual([]);expect(h.result.current.transcript.segments[0].tagIds).toBeUndefined();
 await act(()=>h.result.current.redo());expect(h.result.current.transcript.segments[0].tagIds).toEqual([leaf.id]);
});
it('library-only creation does not assign a segment and removing the last assignment retains admission',async()=>{
 const h=setup();let id='';await act(async()=>{id=await h.result.current.create('经历/求学')});expect(h.result.current.transcript.segments[0].tagIds).toBeUndefined();
 await act(()=>h.result.current.attach('s',id));await act(()=>h.result.current.remove('s',id));expect(h.result.current.transcript.segments[0].tagIds).toEqual([]);expect(h.result.current.collection.tagIds).toContain(id);
 await act(async()=>{expect(await h.result.current.create('',id)).toBe(id)});expect(h.result.current.library.tags).toHaveLength(2);
});
it('publishes no definitions or associations on disk failure',async()=>{
 const h=setup();h.writes.mockRejectedValueOnce(Error('Synthetic disk failure'));await act(async()=>{await expect(h.result.current.add('s','Topic')).rejects.toThrow()});
 expect(h.result.current.library.tags).toEqual([]);expect(h.result.current.transcript.segments[0].tagIds).toBeUndefined();expect(h.result.current.busy).toBe(false);expect(h.errors).toHaveBeenCalled();expect(h.lock).toHaveBeenLastCalledWith(false);
});
it('blocks all tag writing paths on an original',async()=>{
 const h=setup();h.rerender({readOnly:true,context:'original'});
 for(const action of [()=>h.result.current.create('Topic'),()=>h.result.current.add('s','Topic'),()=>h.result.current.attach('s','unknown'),()=>h.result.current.rename('unknown','Name')])await act(async()=>{await expect(action()).rejects.toThrow()});
 await act(()=>h.result.current.remove('s','unknown'));expect(h.writes).not.toHaveBeenCalled();
});
it('keeps explicit group membership version-owned and reversible',async()=>{
 const h=setup();await act(()=>h.result.current.create('Root/Child'));const child=h.result.current.library.tags.find(t=>t.name==='Child')!;
 await act(()=>h.result.current.change({...h.result.current.library,groups:[{id:'g',name:'Synthetic group',parentId:null}],tags:h.result.current.library.tags.map(t=>({...t,groupIds:t.id===child.id?['g']:[]}))}));
 expect(h.result.current.collection.groups[0].tagIds).toEqual([child.id]);await act(()=>h.result.current.undo());expect(h.result.current.collection.groups).toEqual([]);await act(()=>h.result.current.redo());expect(h.result.current.collection.groups[0].tagIds).toEqual([child.id]);
});
it('deletes an unused project tag with saved group order and restores its exact membership and orders',async()=>{
 const h=setup();await act(()=>h.result.current.create('Root/Leaf'));await act(()=>h.result.current.create('Other'));
 const leaf=h.result.current.library.tags.find(t=>t.name==='Leaf')!,other=h.result.current.library.tags.find(t=>t.name==='Other')!;
 await act(()=>h.result.current.change({...h.result.current.library,groups:[{id:'g',name:'Synthetic group',parentId:null}],tags:h.result.current.library.tags.map(t=>({...t,groupIds:t.id===leaf.id?['g']:[]}))}));
 await act(()=>h.result.current.sortByName('groups'));await act(()=>h.result.current.sortByName('level'));
 const before=h.result.current.collection,library=h.result.current.library,text=h.result.current.transcript.segments[0].text;
 expect(h.result.current.transcript.segments[0].tagIds).toBeUndefined();expect(before.groups[0].order).toContain(leaf.id);expect(before.levelOrder).toContain(leaf.id);
 await act(()=>h.result.current.change(removeTagBranch(h.result.current.library,leaf.id)));
 expect(h.result.current.library.tags.some(t=>t.id===leaf.id)).toBe(false);expect(h.result.current.library.tags.some(t=>t.id===other.id)).toBe(true);
 expect(h.result.current.collection.tagIds).not.toContain(leaf.id);expect(h.result.current.collection.groups[0].tagIds).toEqual([]);expect(h.result.current.collection.groups[0].order).toEqual([]);expect(h.result.current.collection.levelOrder).not.toContain(leaf.id);
 expect(h.result.current.transcript.segments[0].text).toBe(text);expect(h.errors).not.toHaveBeenCalled();
 await act(()=>h.result.current.undo());expect(h.result.current.library).toEqual(library);expect(h.result.current.collection).toEqual(before);
 await act(()=>h.result.current.redo());expect(h.result.current.collection.groups[0].order).toEqual([]);expect(h.result.current.library.tags.some(t=>t.id===leaf.id)).toBe(false);
});
it('renames a shared parent with stable child references',async()=>{
 const h=setup();await act(()=>h.result.current.add('s','Root/Child'));const root=h.result.current.library.tags.find(t=>t.name==='Root')!,child=h.result.current.library.tags.find(t=>t.name==='Child')!;
 await act(()=>h.result.current.rename(root.id,'Renamed'));expect(tagPath(h.result.current.library,child.id)).toBe('Renamed/Child');expect(h.result.current.transcript.segments[0].tagIds).toEqual([child.id]);
});
it('does not let tag undo leap over a later text edit',async()=>{
 const h=setup();await act(()=>h.result.current.add('s','Topic'));act(()=>h.result.current.editText());expect(h.result.current.canUndo).toBe(false);act(()=>h.result.current.undoText());expect(h.result.current.canUndo).toBe(true);await act(()=>h.result.current.undo());expect(h.result.current.library.tags).toEqual([]);
});

it('name sorting preserves earlier tag undo while later drags undo/redo against sorted priorities',async()=>{
 const h=setup();await act(()=>h.result.current.create('Root/Beta'));await act(()=>h.result.current.create('Root/Alpha'));const id=(name:string)=>h.result.current.library.tags.find(t=>t.name===name)!.id;
 await act(()=>h.result.current.reorder('level',id('Beta'),id('Alpha'),false));
 await act(()=>h.result.current.sortByName('level'));const sorted=h.result.current.collection;expect(sorted.levelOrder).toEqual([id('Root'),id('Alpha'),id('Beta')]);expect(h.result.current.canUndo).toBe(true);expect(h.result.current.editorCanUndo).toBe(true);
 await act(()=>h.result.current.reorder('level',id('Beta'),id('Alpha'),false));await act(()=>h.result.current.undo());expect(h.result.current.collection).toEqual(sorted);expect(h.result.current.canUndo).toBe(true);await act(()=>h.result.current.redo());expect(h.result.current.collection.levelOrder).toEqual([id('Root'),id('Beta'),id('Alpha')]);
});
it('body edit then sort still undoes/redoes body without changing sorted priorities',async()=>{
 const h=setup();await act(()=>h.result.current.create('Root/Beta'));await act(()=>h.result.current.create('Root/Alpha'));act(()=>h.result.current.editText());await act(()=>h.result.current.sortByName('level'));const order=h.result.current.collection.levelOrder;
 act(()=>h.result.current.undoText());expect(h.result.current.transcript.segments[0].text).toBe('Synthetic text');expect(h.result.current.collection.levelOrder).toEqual(order);act(()=>h.result.current.redoText());expect(h.result.current.transcript.segments[0].text).toBe('Later text');expect(h.result.current.collection.levelOrder).toEqual(order);
});
it('association edit then sort keeps that association undo/redo and retains sorting',async()=>{
 const h=setup();await act(()=>h.result.current.create('Root/Beta'));await act(()=>h.result.current.create('Root/Alpha'));const alpha=h.result.current.library.tags.find(t=>t.name==='Alpha')!.id;await act(()=>h.result.current.attach('s',alpha));await act(()=>h.result.current.sortByName('level'));const order=h.result.current.collection.levelOrder;
 await act(()=>h.result.current.undo());expect(h.result.current.transcript.segments[0].tagIds).toBeUndefined();expect(h.result.current.collection.levelOrder).toEqual(order);await act(()=>h.result.current.redo());expect(h.result.current.transcript.segments[0].tagIds).toEqual([alpha]);expect(h.result.current.collection.levelOrder).toEqual(order);
});
it('failed name sorting preserves the existing order and both editor/tag undo history',async()=>{
 const h=setup();await act(()=>h.result.current.create('Root/Beta'));await act(()=>h.result.current.create('Root/Alpha'));const id=(name:string)=>h.result.current.library.tags.find(t=>t.name===name)!.id;
 await act(()=>h.result.current.reorder('level',id('Beta'),id('Alpha'),false));const before=h.result.current.transcript;h.writes.mockRejectedValueOnce(Error('Synthetic save failure'));
 await act(async()=>{await expect(h.result.current.sortByName('level')).rejects.toThrow()});expect(h.result.current.transcript).toBe(before);expect(h.result.current.canUndo).toBe(true);expect(h.result.current.editorCanUndo).toBe(true);
 await act(()=>h.result.current.undo());expect(h.result.current.collection.levelOrder).toBeUndefined();
});

it('sorting an already sorted result rebases older order snapshots without removing history',async()=>{
 const h=setup();await act(()=>h.result.current.create('Root/Beta'));await act(()=>h.result.current.create('Root/Alpha'));const id=(name:string)=>h.result.current.library.tags.find(t=>t.name===name)!.id;await act(()=>h.result.current.sortByName('level'));
 await act(()=>h.result.current.reorder('level',id('Beta'),id('Alpha'),false));await act(()=>h.result.current.reorder('level',id('Alpha'),id('Beta'),false));expect(h.result.current.canUndo).toBe(true);const sorted=h.result.current.collection;
 await act(()=>h.result.current.sortByName('level'));expect(h.result.current.collection).toEqual(sorted);expect(h.result.current.canUndo).toBe(true);expect(h.result.current.editorCanUndo).toBe(true);await act(()=>h.result.current.undo());expect(h.result.current.collection).toEqual(sorted);
});

for(const input of ['Parent/Target','Target'])it(`cancels and explicitly confirms the same segment-rename merge for ${input}`,async()=>{
 const h=setup();await act(()=>h.result.current.add('s','Parent/Source'));await act(()=>h.result.current.add('s','Target'));
 const source=h.result.current.library.tags.find(t=>t.name==='Source')!.id,target=h.result.current.library.tags.find(t=>t.name==='Target')!.id;
 const before=h.result.current.library,writes=h.writes.mock.calls.length;let pending!:Promise<void>;
 await act(async()=>{pending=h.result.current.renamePath(source,input);void pending.catch(()=>{});await Promise.resolve();await Promise.resolve()});
 expect(h.result.current.mergePrompt?.request.targetId).toBe(target);expect(h.writes).toHaveBeenCalledTimes(writes);
 await expect(h.result.current.renamePath(source,input)).rejects.toThrow();expect(h.writes).toHaveBeenCalledTimes(writes);
 await act(async()=>{h.result.current.mergePrompt!.finish(false);await pending.catch(()=>{})});expect(h.result.current.library).toEqual(before);expect(h.writes).toHaveBeenCalledTimes(writes);
 await act(async()=>{pending=h.result.current.renamePath(source,input);await Promise.resolve();await Promise.resolve()});
 expect(h.result.current.mergePrompt?.request.targetId).toBe(target);
 await act(async()=>{h.result.current.mergePrompt!.finish(true);await pending});expect(h.writes).toHaveBeenCalledTimes(writes+1);expect(h.result.current.transcript.segments[0].tagIds).toEqual([target]);
 await act(()=>h.result.current.undo());expect(h.result.current.library).toEqual(before);
 h.rerender({readOnly:true,context:'v1'});await expect(h.result.current.renamePath(source,input)).rejects.toThrow();expect(h.result.current.mergePrompt).toBeNull();
});

it('replaces one segment association with a new child and keeps the shared parent and other segments',async()=>{
 const h=setup(true,true);await act(()=>h.result.current.add('s','Timeline/Stage/Project'));
 const parent=h.result.current.library.tags.find(tag=>tag.name==='Project')!.id;
 await act(()=>h.result.current.attach('s2',parent));await act(()=>h.result.current.replace('s',parent,'Timeline/Stage/Project/Client'));
 const child=h.result.current.library.tags.find(tag=>tag.name==='Client')!.id;
 expect(h.result.current.transcript.segments.map(s=>s.tagIds)).toEqual([[child],[parent]]);
 expect(tagPath(h.result.current.library,parent)).toBe('Timeline/Stage/Project');
 await act(()=>h.result.current.undo());expect(h.result.current.transcript.segments.map(s=>s.tagIds)).toEqual([[parent],[parent]]);
 await act(()=>h.result.current.redo());expect(h.result.current.transcript.segments.map(s=>s.tagIds)).toEqual([[child],[parent]]);
 await act(()=>h.result.current.replace('s',child,'Project'));expect(h.result.current.transcript.segments.map(s=>s.tagIds)).toEqual([[parent],[parent]]);
});
it('rejects a conflicting segment replacement without moving or merging a shared tag',async()=>{
 const h=setup(true);await act(()=>h.result.current.add('s','Parent/Existing'));await act(()=>h.result.current.create('Other'));
 const before=structuredClone(h.result.current.library),old=h.result.current.transcript.segments[0].tagIds![0];
 await act(async()=>{await expect(h.result.current.replace('s',old,'Other/Existing')).rejects.toThrow();});
 expect(h.result.current.library).toEqual(before);expect(h.result.current.transcript.segments[0].tagIds).toEqual([old]);expect(h.result.current.mergePrompt).toBeNull();
});
