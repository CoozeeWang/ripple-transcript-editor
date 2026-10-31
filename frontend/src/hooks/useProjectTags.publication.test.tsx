// @vitest-environment jsdom
import {act,cleanup,renderHook} from '@testing-library/react';
import {useLayoutEffect,useState} from 'react';
import {flushSync} from 'react-dom';
import {afterEach,expect,it,vi} from 'vitest';
import {useProjectTags,type TagStorage} from './useProjectTags';
import {useTranscriptHistory} from '../useTranscriptHistory';
import {tagFields,type TagTransactionReceipt} from '../lib/projectTagRepository';
import {collectionLibrary,projectTagCatalog,type TagCollection} from '../lib/tagCollections';
import type {OpenProject} from '../lib/projectStore';
import type {TagLibrary} from '../lib/tags';
import type {Transcript} from '../types';

afterEach(cleanup);
it('renders only complete before/after catalog, group and order snapshots through compound save, undo/redo and failure',async()=>{
 const catalog:TagLibrary={schemaVersion:3,groups:[],tags:[
  {id:'a',name:'Root A',parentId:null,groupIds:[]},{id:'b',name:'Root B',parentId:null,groupIds:[]},
  {id:'c',name:'Child',parentId:'a',groupIds:[]}]};
 const collection:TagCollection={schemaVersion:1,tagIds:['a','b','c'],groups:[{id:'g1',name:'Source',tagIds:['c']},{id:'g2',name:'Target',tagIds:['b']}]};
 const seed:Transcript={audio:{filename:'Synthetic.wav',duration:1},speakers:[],segments:[{id:'s',speaker_id:'v',text:'Synthetic',start:0,end:1,tagIds:['c']}],tagCollection:collection};
 const frames:string[]=[],errors=vi.fn(),writes=vi.fn(async()=>{}),lock=vi.fn();
 const project=(library:TagLibrary)=>({data:{tagLibrary:library}} as OpenProject);
 const h=renderHook(()=>{
  const [library,setLibrary]=useState(catalog),history=useTranscriptHistory<Transcript>();
  const transcript=history.transcript??seed;
  const storage:TagStorage={
   transact:async(current,operation)=>{
    const result=operation(library,[{id:'r:m:e',label:'Synthetic',transcript:current.transcript}],'r:m:e');
    await writes();const next=result.consumers[0].transcript;
    return {project:project(result.library),transcript:next,receipt:{beforeLibrary:library,afterLibrary:result.library,versions:[{id:'r:m:e',before:tagFields(transcript),after:tagFields(next)}]} as TagTransactionReceipt};
   },
   restore:async(receipt,redo)=>{await writes();return project(redo?receipt.afterLibrary:receipt.beforeLibrary)},
   publish:(next,publishVersion)=>flushSync(()=>{setLibrary(next.data.tagLibrary!);publishVersion()}),
  };
  const tags=useProjectTags({library,storage,context:'synthetic',recordingId:'r',modelId:'m',editId:'e',transcript,flush:async()=>{},lock,readOnly:false,onError:errors,errorMessage:'Synthetic failure',undoActionKey:history.undoActionKey,redoActionKey:history.redoActionKey,publish:(next,action,key)=>{
   if(action==='undo')history.undo();else if(action==='redo')history.redo();else{if(!history.transcript)history.reset(seed);history.commit(()=>next,key)}
  }});
  useLayoutEffect(()=>{frames.push(JSON.stringify({parent:library.tags.find(t=>t.id==='c')!.parentId,groups:tags.library.tags.find(t=>t.id==='c')!.groupIds,order:tags.collection.groups.find(g=>g.id==='g2')!.order??[],association:transcript.segments[0].tagIds}))});
  return tags;
 });
 const before=frames.at(-1)!;let release!:()=>void;
 writes.mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve}));
 let saving!:Promise<void>;
 await act(async()=>{saving=h.result.current.placeInGroup({tagId:'c',sourceGroupId:'g1',groupId:'g2',parentId:'b',anchorId:null,after:true,copy:false});await Promise.resolve()});
 expect(h.result.current.busy).toBe(true);expect(new Set(frames)).toEqual(new Set([before]));
 await act(async()=>{release();await saving});
 const after=frames.at(-1)!;expect(after).not.toBe(before);expect(h.result.current.library.tags.find(t=>t.id==='c')!.groupIds).toEqual(['g2']);
 expect(h.result.current.collection.groups.find(g=>g.id==='g2')!.order).toContain('c');
 expect(new Set(frames)).toEqual(new Set([before,after]));
 writes.mockRejectedValueOnce(Error('Synthetic undo failure'));await act(()=>h.result.current.undo());expect(frames.at(-1)).toBe(after);expect(h.result.current.canUndo).toBe(true);
 await act(()=>h.result.current.undo());expect(frames.at(-1)).toBe(before);
 await act(()=>h.result.current.redo());expect(frames.at(-1)).toBe(after);
 writes.mockRejectedValueOnce(Error('Synthetic save failure'));
 await act(async()=>{await expect(h.result.current.placeInGroup({tagId:'c',sourceGroupId:'g2',groupId:'g1',parentId:'a',anchorId:null,after:true,copy:false})).rejects.toThrow()});
 expect(frames.at(-1)).toBe(after);expect(new Set(frames)).toEqual(new Set([before,after]));expect(errors).toHaveBeenCalledTimes(2);expect(lock).toHaveBeenLastCalledWith(false);
 // The version projection is still consistent with its explicit collection, not a transient ungrouped fallback.
 expect(collectionLibrary(projectTagCatalog(h.result.current.library),h.result.current.collection).tags.find(t=>t.id==='c')!.groupIds).toEqual(['g2']);
});
