// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { useLayoutEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { useProjectTags, type TagStorage } from './useProjectTags';
import { useTranscriptHistory } from '../useTranscriptHistory';
import { tagTestFs } from '../lib/tagTestFs';
import { migrateProjectTagStorage } from '../lib/tagMigration';
import { applySidecar, parseTagSidecar, sidecarName } from '../lib/tagSidecar';
import { tagFields, transactProjectTags, restoreProjectTagTransaction } from '../lib/projectTagRepository';
import type { OpenProject, RippleProject } from '../lib/projectStore';
import type { Transcript } from '../types';

afterEach(cleanup);
async function fixture() {
    let fail = false;
    const fs = tagTestFs('synthetic-sort.ripple', path => { if (fail && path === 'ripple-project.json') { fail = false; throw Error('synthetic sort failure'); } });
    const folder = 'interviews/session/sample.transcript';
    for (const path of ['interviews','interviews/session',folder]) fs.directories.add(path);
    const data: RippleProject = { kind:'ripple-project',schemaVersion:1,id:'synthetic-sort',title:'Synthetic',description:'',revision:0,
        tagLibrary:{schemaVersion:3,groups:[],tags:[{id:'root',name:'Root',parentId:null,groupIds:[]},{id:'beta',name:'Beta',parentId:'root',groupIds:[]},{id:'alpha',name:'Alpha',parentId:'root',groupIds:[]},{id:'other',name:'Other',parentId:null,groupIds:[]}]},
        interviews:[{id:'session',title:'Synthetic',recordings:[{id:'recording',name:'Synthetic',file:'sample.wav',storage:'none',fingerprint:''}]}] };
    const seed:Transcript={audio:{filename:'sample.wav',duration:1},speakers:[],segments:[{id:'s',speaker_id:'v',text:'Original synthetic text',start:0,end:1},{id:'t',speaker_id:'v',text:'Synthetic target',start:0,end:1}],
        tagCollection:{schemaVersion:1,tagIds:['root','alpha','beta','other'],levelOrder:['root','beta','alpha','other'],groups:[{id:'z',name:'Zulu',tagIds:['beta'],order:['root','beta']},{id:'a',name:'Alpha group',tagIds:['other'],order:['other']}]}};
    fs.files.set('ripple-project.json',JSON.stringify(data));
    fs.files.set(folder+'/manifest.json',JSON.stringify({schemaVersion:2,audio:'sample.wav',activeModelId:'m',models:[{id:'m',engine:'imported',original:'original.json',activeEditId:'e',edits:[{id:'e',file:'e.json'}]}]}));
    for (const file of ['original.json','e.json']) fs.files.set(folder+'/'+file,JSON.stringify({kind:file==='original.json'?'te-original':'te-edited',audio:'sample.wav',metadata:{},transcript:seed}));
    const project=await migrateProjectTagStorage({directory:fs.root,data},tagTestFs('synthetic-rollback').root,{backupMode:'rollback'});
    const path=folder+'/'+await sidecarName('e.json');
    const read=()=>parseTagSidecar(fs.files.get(path)!,'e.json');
    const initial=applySidecar(seed,read()),errors=vi.fn();
    const h=renderHook(()=>{
        const [projectState,setProject]=useState<OpenProject>(project),history=useTranscriptHistory<Transcript>();
        useLayoutEffect(()=>{if(!history.transcript)history.reset(initial)},[history]);
        const transcript=history.transcript??initial;
        const storage:TagStorage={transact:(current,operation,scope)=>transactProjectTags(projectState,current,operation,scope),
            restore:(receipt,redo)=>restoreProjectTagTransaction(projectState,receipt,redo),
            publish:(next,publish)=>flushSync(()=>{setProject(next);publish()})};
        const tags=useProjectTags({library:projectState.data.tagLibrary,storage,context:'synthetic',recordingId:'recording',modelId:'m',editId:'e',transcript,
            flush:async()=>{},lock:()=>{},readOnly:false,onError:errors,errorMessage:'Synthetic',undoActionKey:history.undoActionKey,redoActionKey:history.redoActionKey,
            publish:(next,action,key,rebase)=>{if(action==='rebase')history.rebase(rebase!,next);else if(action==='commit')history.commit(()=>next,key);else if(action==='undo')history.undo();else history.redo()}});
        return {tags,transcript,history,project:projectState,edit:()=>history.commit(t=>({...t,segments:t.segments.map(s=>({...s,text:'Changed synthetic text'}))}),'body')};
    });
    const consistent=()=>{expect(tagFields(h.result.current.transcript)).toEqual({collection:read().collection,segments:read().segments});expect(h.result.current.transcript.tagStorageRevision).toBe(read().revision)};
    return {...h,read,consistent,errors,fail:()=>{fail=true},files:fs.files,folder};
}

it('preserves body undo and redo across name sorting, without changing sorted priorities',async()=>{
    const h=await fixture();act(()=>h.result.current.edit());await act(()=>h.result.current.tags.sortByName('level'));const order=h.result.current.tags.collection.levelOrder;
    act(()=>h.result.current.history.undo());expect(h.result.current.transcript.segments[0].text).toBe('Original synthetic text');expect(h.result.current.tags.collection.levelOrder).toEqual(order);h.consistent();
    act(()=>h.result.current.history.redo());expect(h.result.current.transcript.segments[0].text).toBe('Changed synthetic text');expect(h.result.current.tags.collection.levelOrder).toEqual(order);h.consistent();
});
it('preserves durable association undo/redo and exact sidecar revisions after sorting',async()=>{
    const h=await fixture();await act(()=>h.result.current.tags.attach('s','alpha'));await act(()=>h.result.current.tags.sortByName('level'));const order=h.result.current.tags.collection.levelOrder;h.consistent();
    await act(()=>h.result.current.tags.undo());expect(h.result.current.transcript.segments[0].tagIds).toBeUndefined();expect(h.result.current.tags.collection.levelOrder).toEqual(order);h.consistent();
    await act(()=>h.result.current.tags.redo());expect(h.result.current.transcript.segments[0].tagIds).toEqual(['alpha']);expect(h.result.current.tags.collection.levelOrder).toEqual(order);h.consistent();expect(h.errors).not.toHaveBeenCalled();
});
it('preserves pre-sort compound membership/hierarchy undo while sorted group and sibling positions stay',async()=>{
    const h=await fixture();await act(()=>h.result.current.tags.placeInGroup({tagId:'beta',sourceGroupId:'z',groupId:'a',parentId:'other',anchorId:null,after:true,copy:false}));
    await act(()=>h.result.current.tags.sortByName('groups'));expect(h.result.current.tags.collection.groups.map(g=>g.id)).toEqual(['a','z']);
    await act(()=>h.result.current.tags.undo());expect(h.result.current.tags.library.tags.find(t=>t.id==='beta')?.parentId).toBe('root');expect(h.result.current.tags.collection.groups.find(g=>g.id==='z')?.tagIds).toEqual(['beta']);expect(h.result.current.tags.collection.groups.map(g=>g.id)).toEqual(['a','z']);h.consistent();
    await act(()=>h.result.current.tags.redo());expect(h.result.current.tags.library.tags.find(t=>t.id==='beta')?.parentId).toBe('other');expect(h.result.current.tags.collection.groups.find(g=>g.id==='a')?.tagIds).toContain('beta');h.consistent();expect(h.errors).not.toHaveBeenCalled();
});
it('normal drag after sorting undoes/redoes to the sorted baseline, including save/reopen metadata',async()=>{
    const h=await fixture();await act(()=>h.result.current.tags.sortByName('level'));const order=h.result.current.tags.collection.levelOrder;
    await act(()=>h.result.current.tags.reorder('level','beta','alpha',false));expect(h.result.current.tags.collection.levelOrder).not.toEqual(order);
    await act(()=>h.result.current.tags.undo());expect(h.result.current.tags.collection.levelOrder).toEqual(order);h.consistent();
    await act(()=>h.result.current.tags.redo());expect(h.result.current.tags.collection.levelOrder).toEqual(h.read().collection.levelOrder);h.consistent();expect(h.errors).not.toHaveBeenCalled();
});
it('keeps redo available when sorting after an association undo',async()=>{
    const h=await fixture();await act(()=>h.result.current.tags.attach('s','alpha'));await act(()=>h.result.current.tags.undo());expect(h.result.current.tags.canRedo).toBe(true);
    await act(()=>h.result.current.tags.sortByName('level'));expect(h.result.current.tags.canRedo).toBe(true);
    await act(()=>h.result.current.tags.redo());expect(h.result.current.transcript.segments[0].tagIds).toEqual(['alpha']);h.consistent();await act(()=>h.result.current.tags.undo());h.consistent();expect(h.errors).not.toHaveBeenCalled();
});
it('failed sorting retains both histories and durable tag undo without touching body bytes',async()=>{
    const h=await fixture();await act(()=>h.result.current.tags.attach('s','alpha'));act(()=>h.result.current.edit());const before=new Map(h.files);
    h.fail();await act(async()=>{await expect(h.result.current.tags.sortByName('level')).rejects.toThrow('synthetic sort failure')});expect(h.files).toEqual(before);
    act(()=>h.result.current.history.undo());expect(h.result.current.transcript.segments[0].text).toBe('Original synthetic text');await act(()=>h.result.current.tags.undo());h.consistent();expect(h.result.current.transcript.segments[0].tagIds).toBeUndefined();
});

it('keeps the complete mixed body/tag undo chain and redoes it with one persistent sorted order',async()=>{
    const h=await fixture();await act(()=>h.result.current.tags.attach('s','alpha'));await act(()=>h.result.current.tags.attach('s','beta'));act(()=>h.result.current.edit());await act(()=>h.result.current.tags.sortByName('level'));const order=h.result.current.tags.collection.levelOrder;
    act(()=>h.result.current.history.undo());await act(()=>h.result.current.tags.undo());expect(h.result.current.transcript.segments[0].tagIds).toEqual(['alpha']);h.consistent();
    await act(()=>h.result.current.tags.undo());expect(h.result.current.transcript.segments[0].tagIds).toBeUndefined();h.consistent();
    await act(()=>h.result.current.tags.redo());await act(()=>h.result.current.tags.redo());act(()=>h.result.current.history.redo());expect(h.result.current.transcript.segments[0].text).toBe('Changed synthetic text');expect(h.result.current.transcript.segments[0].tagIds).toEqual(['alpha','beta']);expect(h.result.current.tags.collection.levelOrder).toEqual(order);h.consistent();expect(h.errors).not.toHaveBeenCalled();
});

it('undoes/redoes pre-sort tag creation without dangling order IDs or losing other tags',async()=>{
    const h=await fixture();let created='';await act(async()=>{created=await h.result.current.tags.create('New synthetic tag')});await act(()=>h.result.current.tags.sortByName('level'));
    await act(()=>h.result.current.tags.undo());expect(h.result.current.tags.library.tags.some(t=>t.id===created)).toBe(false);expect(h.result.current.tags.collection.levelOrder).not.toContain(created);h.consistent();
    await act(()=>h.result.current.tags.redo());expect(h.result.current.tags.library.tags.some(t=>t.id===created)).toBe(true);expect(h.result.current.tags.collection.levelOrder).toContain(created);h.consistent();expect(h.errors).not.toHaveBeenCalled();
});

it('keeps the exact present revision through no-op sort and earlier drag undo/redo',async()=>{
    const h=await fixture();await act(()=>h.result.current.tags.sortByName('level'));
    await act(()=>h.result.current.tags.reorder('level','beta','alpha',false));await act(()=>h.result.current.tags.reorder('level','alpha','beta',false));
    const sorted=h.result.current.tags.collection.levelOrder;await act(()=>h.result.current.tags.sortByName('level'));h.consistent();
    await act(()=>h.result.current.tags.undo());expect(h.result.current.tags.collection.levelOrder).toEqual(sorted);h.consistent();
    await act(()=>h.result.current.tags.redo());expect(h.result.current.tags.collection.levelOrder).toEqual(sorted);h.consistent();expect(h.errors).not.toHaveBeenCalled();
});

it('the shared attach transaction copies only the target, deduplicates, and persists undo/redo without source changes',async()=>{
    const h=await fixture();await act(()=>h.result.current.tags.attach('s','alpha'));
    await act(()=>h.result.current.tags.attach('t','alpha'));expect(h.result.current.transcript.segments.map(s=>s.tagIds)).toEqual([['alpha'],['alpha']]);h.consistent();
    const revision=h.result.current.project.data.revision;await act(()=>h.result.current.tags.attach('t','alpha'));expect(h.result.current.project.data.revision).toBe(revision);
    await act(()=>h.result.current.tags.undo());expect(h.result.current.transcript.segments.map(s=>s.tagIds)).toEqual([['alpha'],undefined]);h.consistent();
    await act(()=>h.result.current.tags.redo());expect(h.read().segments).toEqual([['s',['alpha']],['t',['alpha']]]);h.consistent();
});

it('a failed shared attach leaves source and target associations intact with history still usable',async()=>{
    const h=await fixture();await act(()=>h.result.current.tags.attach('s','alpha'));const before=new Map(h.files);h.fail();
    await act(async()=>{await expect(h.result.current.tags.attach('t','alpha')).rejects.toThrow('synthetic sort failure')});expect(h.files).toEqual(before);expect(h.result.current.transcript.segments.map(s=>s.tagIds)).toEqual([['alpha'],undefined]);h.consistent();
    await act(()=>h.result.current.tags.undo());expect(h.result.current.transcript.segments.map(s=>s.tagIds)).toEqual([undefined,undefined]);h.consistent();
});
