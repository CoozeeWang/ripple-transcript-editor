import {expect,it}from'vitest';
import{tagTestFs}from'./tagTestFs';
import{readProjectTreeOrderPlan,upgradeProjectTreeOrder}from'./projectTagRepository';
import{restoreTagUpgradeCheckpoint,TAG_UPGRADE_RECOVERY}from'./tagUpgradeBackup';
import{sha256,sidecarName,fileMetadata,TAG_STORAGE_MARKER}from'./tagSidecar';
import type{RippleProject}from'./projectStore';
async function fixture(conflict=false,onBackupWrite?:()=>void){
 const fs=tagTestFs('synthetic.ripple'),backup=tagTestFs('outside-backup',()=>onBackupWrite?.()),folder='interviews/session/sample.transcript';
 for(const name of ['interviews','interviews/session',folder])fs.directories.add(name);
 const data:RippleProject={kind:'ripple-project',schemaVersion:2,id:'order-upgrade',title:'Synthetic',description:'',revision:0,tagLibrary:{schemaVersion:3,tags:[{id:'root',name:'Root',parentId:null,groupIds:[]},{id:'a',name:'Alpha',parentId:'root',groupIds:[]},{id:'b',name:'Beta',parentId:'root',groupIds:[]}],groups:[]},interviews:[{id:'session',title:'Synthetic session',recordings:[{id:'recording',name:'Synthetic recording',file:'sample.wav',storage:'none',fingerprint:''}]}]};
 fs.files.set('ripple-project.json',JSON.stringify(data));fs.files.set(folder+'/manifest.json',JSON.stringify({schemaVersion:2,audio:'sample.wav',activeModelId:'m',models:[{id:'m',engine:'synthetic',activeEditId:'e1',edits:[{id:'e1',label:'Synthetic first',file:'e1.json'},{id:'e2',label:'Synthetic second',file:'e2.json'}]}]}));fs.files.set(folder+'/'+TAG_STORAGE_MARKER,JSON.stringify({schemaVersion:1}));
 const directory=await(await(await fs.root.getDirectoryHandle('interviews')).getDirectoryHandle('session')).getDirectoryHandle('sample.transcript');
 for(const name of ['e1.json','e2.json']){
  const collection={schemaVersion:1,tagIds:['root','a','b'],groups:[{id:'legacy',name:'Legacy group',tagIds:['a'],order:['root','a']}],levelOrder:name==='e1.json'?['root','b','a']:conflict?['root','a','b']:[]};
  const transcript={audio:{filename:'sample.wav',duration:1},speakers:[],segments:[{id:'s',speaker_id:'p',start:0,end:1,text:'Synthetic body',tagIds:['a']}],tagCollection:collection};
  const raw=JSON.stringify({kind:'te-edited',audio:'sample.wav',transcript});fs.files.set(folder+'/'+name,raw);
  const metadata={kind:'ripple-version-tags',schemaVersion:1,revision:name,file:name,body:{hash:await sha256(raw),...await fileMetadata(await directory.getFileHandle(name))},collection,segments:[['s',['a']]]};
  fs.files.set(folder+'/'+await sidecarName(name),JSON.stringify(metadata));
 }
 return{fs,backup,project:{directory:fs.root,data},folder};
}
it('previews without writes and upgrades only the fresh index, retaining all version bytes and legacy grouping',async()=>{
 const f=await fixture(),before=new Map(f.fs.files),plan=await readProjectTreeOrderPlan(f.project);expect(f.fs.files).toEqual(before);expect(plan.conflict).toBe(false);expect(plan.order).toEqual(['root','b','a']);
 const next=await upgradeProjectTreeOrder(f.project,f.backup.root,{expectedRevision:plan.projectRevision});expect(next.data.tagLibrary?.schemaVersion).toBe(4);expect(next.data.tagLibrary?.treeOrder).toEqual(['root','b','a']);
 for(const[path,raw]of before)if(path!=='ripple-project.json')expect(f.fs.files.get(path)).toBe(raw);
 expect([...f.backup.files.keys()].sort()).toEqual([TAG_UPGRADE_RECOVERY,'original/ripple-project.json'].sort());
 await restoreTagUpgradeCheckpoint(f.fs.root,f.backup.root);expect(f.fs.files.get('ripple-project.json')).toBe(before.get('ripple-project.json'));
});
it('blocks ambiguous initialization before backing up or writing and accepts an explicit baseline',async()=>{
 const f=await fixture(true),before=new Map(f.fs.files),plan=await readProjectTreeOrderPlan(f.project);expect(plan.conflict).toBe(true);
 await expect(upgradeProjectTreeOrder(f.project,f.backup.root)).rejects.toThrow('tag_order_baseline_required');expect(f.fs.files).toEqual(before);expect(f.backup.files.size).toBe(0);
 const next=await upgradeProjectTreeOrder(f.project,f.backup.root,{orderBaseline:'recording:m:e2'});expect(next.data.tagLibrary?.treeOrder).toEqual(['root','a','b']);
});
it('rejects a stale project revision rather than applying an earlier preview',async()=>{
 const f=await fixture(),plan=await readProjectTreeOrderPlan(f.project);const newer=JSON.stringify({...f.project.data,revision:1});f.fs.files.set('ripple-project.json',newer);
 await expect(upgradeProjectTreeOrder(f.project,f.backup.root,{expectedRevision:plan.projectRevision})).rejects.toThrow('project_changed');expect(f.fs.files.get('ripple-project.json')).toBe(newer);expect(f.backup.files.size).toBe(0);
});
it('retains external edits made during backup and refuses to commit over them',async()=>{
 let change=()=>{};const f=await fixture(false,()=>change());let newer='';change=()=>{change=()=>{};newer=JSON.stringify({...f.project.data,revision:1});f.fs.files.set('ripple-project.json',newer)};
 await expect(upgradeProjectTreeOrder(f.project,f.backup.root)).rejects.toThrow('tag_migration_source_changed');expect(f.fs.files.get('ripple-project.json')).toBe(newer);
});
