import {expect,it} from 'vitest';
import {tagTestFs} from './tagTestFs';
import {migrateProjectTagStorage} from './tagMigration';
import {restoreTagUpgradeCheckpoint,TAG_UPGRADE_RECOVERY} from './tagUpgradeBackup';
import {parseTagSidecar,sidecarName,TAG_STORAGE_MARKER} from './tagSidecar';
import type {RippleProject} from './projectStore';

function fixture(sourceFail?:(path:string)=>void,backupFail?:(path:string)=>void){
 const fs=tagTestFs('synthetic.ripple',sourceFail),backup=tagTestFs('rollback',backupFail),folder='interviews/session/sample.transcript';
 for(const p of ['interviews','interviews/session',folder,'media','.ripple-tag-backups'])fs.directories.add(p);
 const data:RippleProject={kind:'ripple-project',schemaVersion:1,id:'synthetic-checkpoint',title:'Synthetic only',description:'',revision:0,
  tagLibrary:{schemaVersion:3,groups:[],tags:[{id:'root',name:'Root',parentId:null,groupIds:[]},{id:'leaf',name:'Leaf',parentId:'root',groupIds:[]},{id:'unused',name:'Unused',parentId:null,groupIds:[]}]},
  interviews:[{id:'session',title:'Synthetic',recordings:[{id:'recording',name:'Synthetic',file:'sample.wav',storage:'none',fingerprint:''}]}]};
 fs.files.set('ripple-project.json',JSON.stringify(data));
 fs.files.set(folder+'/manifest.json',JSON.stringify({schemaVersion:2,audio:'sample.wav',activeModelId:'m',models:[{id:'m',engine:'imported',original:'original.json',activeEditId:'e1',edits:[{id:'e1',file:'e1.json'},{id:'e2',file:'e2.json'}]}]}));
 fs.files.set(folder+'/manifest.json.bak',fs.files.get(folder+'/manifest.json')!);
 for(const name of ['e1.json','e2.json','original.json','orphan.json']){
  const tagged=name==='e1.json';fs.files.set(folder+'/'+name,JSON.stringify({kind:name==='original.json'?'te-original':'te-edited',audio:'sample.wav',metadata:{synthetic:true},transcript:{audio:{filename:'sample.wav',duration:1},speakers:[],
   tagCollection:{schemaVersion:1,tagIds:tagged?['root','leaf','unused']:[],groups:tagged?[{id:'g',name:'Synthetic group',tagIds:['leaf','unused']}]:[]},
   segments:[{id:'s',speaker_id:'v',text:'Synthetic',start:0,end:1,words:[{text:'Synthetic',start:0,end:1}],...(tagged?{tagIds:['leaf']}:{})}]}}));
 }
 fs.files.set('media/synthetic.m4a','synthetic media must never be copied');fs.files.set('.ripple-tag-backups/old.json','old large history must never be copied');
 return {...fs,backup,folder,project:{directory:fs.root,data}};
}
const light={backupMode:'rollback' as const};
it('backs up only index/manifests, preserves the sole tagged version, zero-use admission/groups, untagged versions and every body byte',async()=>{
 const f=fixture(),before=new Map(f.files),get=f.files.get.bind(f.files);
 f.files.get=path=>{if(path==='media/synthetic.m4a'||path==='.ripple-tag-backups/old.json')throw Error('unrelated payload read forbidden');return get(path)};
 const next=await migrateProjectTagStorage(f.project,f.backup.root,light);expect(next.data.schemaVersion).toBe(2);
 expect([...f.backup.files.keys()].sort()).toEqual(['original/'+f.folder+'/manifest.json','original/'+f.folder+'/manifest.json.bak','original/ripple-project.json',TAG_UPGRADE_RECOVERY].sort());
 expect(f.backup.files.get('original/ripple-project.json')).toBe(before.get('ripple-project.json'));
 for(const [path,raw]of before)if(path!=='ripple-project.json')expect(get(path)).toBe(raw);
 const tagged=parseTagSidecar(get(f.folder+'/'+await sidecarName('e1.json'))!);expect(tagged.collection.tagIds).toEqual(['root','leaf','unused']);expect(tagged.collection.groups[0].tagIds).toEqual(['leaf','unused']);expect(tagged.segments).toEqual([['s',['leaf']]]);
 for(const name of ['e2.json','original.json','orphan.json']){const empty=parseTagSidecar(get(f.folder+'/'+await sidecarName(name))!);expect(empty.collection.tagIds).toEqual([]);expect(empty.segments).toEqual([['s',undefined]])}
 expect(await migrateProjectTagStorage(next,f.backup.root,light)).toEqual(next);
 await restoreTagUpgradeCheckpoint(f.root,f.backup.root);expect(get('ripple-project.json')).toBe(before.get('ripple-project.json'));expect(f.files.has(f.folder+'/'+TAG_STORAGE_MARKER)).toBe(false);
 for(const [path,raw]of before)expect(get(path)).toBe(raw);
});
it('does not write the source if checkpoint creation fails',async()=>{
 const f=fixture(undefined,path=>{if(path===TAG_UPGRADE_RECOVERY)throw Error('synthetic checkpoint failure')}),before=new Map(f.files);
 await expect(migrateProjectTagStorage(f.project,f.backup.root,light)).rejects.toThrow('synthetic checkpoint failure');expect(f.files).toEqual(before);
});
it('fully rolls back a failed first sidecar close, including its empty newly created file',async()=>{
 let fail=true;const f=fixture(path=>{if(path.includes('/tags-')&&fail){fail=false;throw Error('synthetic metadata failure')}}),before=new Map(f.files);
 await expect(migrateProjectTagStorage(f.project,f.backup.root,light)).rejects.toThrow('synthetic metadata failure');
 for(const[path,raw]of before)expect(f.files.get(path)).toBe(raw);
 expect([...f.files.keys()].filter(p=>p.includes('/tags-')||p.endsWith('/tag-storage.json'))).toEqual([]);expect(f.files.has('.ripple-tag-transaction.json')).toBe(false);
 await restoreTagUpgradeCheckpoint(f.root,f.backup.root);expect(f.files.get('ripple-project.json')).toBe(before.get('ripple-project.json'));
});
it.each(['created-empty','partly-written','index-written'])('recovers an interrupted prepared migration at %s without overwriting bodies',async stage=>{
 const f=fixture(),before=new Map(f.files);await migrateProjectTagStorage(f.project,f.backup.root,light);
 const recovery=JSON.parse(f.backup.files.get(TAG_UPGRADE_RECOVERY)!),journal={kind:'ripple-tag-transaction',version:1,id:'synthetic-interruption',state:'prepared',patches:recovery.patches.map((p:{path:string[];beforeHash:string|null})=>({path:p.path,before:p.beforeHash===null?null:f.backup.files.get('original/'+p.path.join('/')),after:f.files.get(p.path.join('/'))}))};
 for(const patch of journal.patches){const path=patch.path.join('/');if(patch.before===null)f.files.delete(path);else f.files.set(path,patch.before)}
 if(stage==='created-empty')f.files.set(journal.patches[0].path.join('/'),'');
 else for(const patch of (stage==='partly-written'?journal.patches.slice(0,2):journal.patches))f.files.set(patch.path.join('/'),patch.after);
 f.files.set('.ripple-tag-transaction.json',JSON.stringify(journal));await restoreTagUpgradeCheckpoint(f.root,f.backup.root);
 for(const[path,raw]of before)expect(f.files.get(path)).toBe(raw);expect(f.files.has('.ripple-tag-transaction.json')).toBe(false);expect(f.files.has(f.folder+'/'+TAG_STORAGE_MARKER)).toBe(false);
});
it.each(['body','manifest','project','sidecar'])('refuses rollback after a later %s change without touching any current file',async which=>{
 const f=fixture();await migrateProjectTagStorage(f.project,f.backup.root,light);
 const path=which==='body'?f.folder+'/e1.json':which==='manifest'?f.folder+'/manifest.json':which==='project'?'ripple-project.json':f.folder+'/'+await sidecarName('e1.json');
 f.files.set(path,f.files.get(path)!+' ');const before=new Map(f.files);await expect(restoreTagUpgradeCheckpoint(f.root,f.backup.root)).rejects.toThrow('source_changed');expect(f.files).toEqual(before);
});
it('refuses corrupt backup originals and traversal paths before source writes',async()=>{
 const f=fixture();await migrateProjectTagStorage(f.project,f.backup.root,light);const before=new Map(f.files),original=f.backup.files.get('original/ripple-project.json')!;
 f.backup.files.set('original/ripple-project.json',original+' ');await expect(restoreTagUpgradeCheckpoint(f.root,f.backup.root)).rejects.toThrow('verification_failed');expect(f.files).toEqual(before);
 f.backup.files.set('original/ripple-project.json',original);const c=JSON.parse(f.backup.files.get(TAG_UPGRADE_RECOVERY)!);c.patches[0].path=['..','outside.json'];f.backup.files.set(TAG_UPGRADE_RECOVERY,JSON.stringify(c));
 await expect(restoreTagUpgradeCheckpoint(f.root,f.backup.root)).rejects.toThrow('invalid_checkpoint');expect(f.files).toEqual(before);
});
it.each(['missing','corrupt','pending'])('does not repair or overwrite a %s version manifest while preparing the checkpoint',async state=>{
 const f=fixture();
 if(state==='missing')f.files.delete(f.folder+'/manifest.json');
 else if(state==='corrupt')f.files.set(f.folder+'/manifest.json','invalid synthetic JSON');
 else f.files.set(f.folder+'/.ripple-document-transaction.json','{}');
 const before=new Map(f.files);await expect(migrateProjectTagStorage(f.project,f.backup.root,light)).rejects.toThrow();expect(f.files).toEqual(before);expect(f.backup.files.size).toBe(0);
});
it('stops before canonical writes if the application reopens at the final commit gate',async()=>{
 const f=fixture(),before=new Map(f.files);
 await expect(migrateProjectTagStorage(f.project,f.backup.root,{...light,assertCanCommit:async()=>{throw Error('synthetic app reopened')}})).rejects.toThrow('synthetic app reopened');
 expect(f.files).toEqual(before);expect(f.backup.files.has(TAG_UPGRADE_RECOVERY)).toBe(true);
});
it('preserves a concurrent manuscript edit detected after checkpoint creation',async()=>{
 const f:ReturnType<typeof fixture>=fixture(undefined,path=>{if(path===TAG_UPGRADE_RECOVERY)f.files.set(f.folder+'/e1.json',f.files.get(f.folder+'/e1.json')!+' ')});
 const index=f.files.get('ripple-project.json');await expect(migrateProjectTagStorage(f.project,f.backup.root,light)).rejects.toThrow('source_changed');
 expect(f.files.get('ripple-project.json')).toBe(index);expect(f.files.get(f.folder+'/e1.json')!.endsWith(' ')).toBe(true);expect(f.files.has(f.folder+'/'+TAG_STORAGE_MARKER)).toBe(false);
});
it('leaves a nonempty backup and the source unchanged',async()=>{
 const f=fixture();f.backup.files.set('keep.txt','existing backup');const before=new Map(f.files),backup=new Map(f.backup.files);
 await expect(migrateProjectTagStorage(f.project,f.backup.root,light)).rejects.toThrow('directory_not_empty');expect(f.files).toEqual(before);expect(f.backup.files).toEqual(backup);
});
it('rejects a backup inside the project before copying or changing any file',async()=>{
 const f=fixture();f.directories.add('inside-backup');const backup=await f.root.getDirectoryHandle('inside-backup'),before=new Map(f.files);
 await expect(migrateProjectTagStorage(f.project,backup,light)).rejects.toThrow('outside_project');expect(f.files).toEqual(before);
});
