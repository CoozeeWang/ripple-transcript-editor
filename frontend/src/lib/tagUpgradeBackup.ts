import {readTagFile,commitTagFileTransaction,recoverTagFileTransaction,type TagFilePatch} from './tagFileTransaction';
import {sha256,TAG_STORAGE_MARKER} from './tagSidecar';

export const TAG_UPGRADE_RECOVERY='tag-upgrade-recovery.json';
interface Fingerprint {path:string[];hash:string}
interface RecoveryPatch {path:string[];beforeHash:string|null;afterHash:string}
interface Checkpoint {
    kind:'ripple-tag-upgrade-checkpoint';schemaVersion:1;projectId:string;createdAt:string;
    purpose:'Upgrade rollback only; requires unchanged original manuscripts and media. Not a standalone project backup.';
    originals:Fingerprint[];unchanged:Fingerprint[];patches:RecoveryPatch[];
}
const safe=(p:unknown):p is string[]=>Array.isArray(p)&&p.length>0&&p.every(x=>typeof x==='string'&&!!x&&x!=='.'&&x!=='..'&&!/[\\/]/.test(x)&&!Array.from(x).some(c=>c.charCodeAt(0)<32));
const key=(path:string[])=>path.join('/');
const isIndex=(path:string[])=>path.length===1&&path[0]==='ripple-project.json';
const isCreatedTag=(path:string[])=>path[0]==='interviews'&&path.some(x=>x.endsWith('.transcript'))&&(path.at(-1)===TAG_STORAGE_MARKER||/^tags-[a-f0-9]{64}\.json$/.test(path.at(-1)!));

export async function assertTagBackupDestination(source:FileSystemDirectoryHandle,destination:FileSystemDirectoryHandle){
    const relative=await source.resolve?.(destination);
    const native=(dir:FileSystemDirectoryHandle)=>{const d=dir as FileSystemDirectoryHandle&{root?:string;parts?:string[]};return d.root?[d.root.replace(/\/$/,''),...(d.parts??[])].join('/'):null};
    const from=native(source),to=native(destination);
    if(await source.isSameEntry?.(destination)||relative!=null||(from&&to&&(from===to||to.startsWith(from+'/'))))throw Error('tag_backup_must_be_outside_project');
    for await(const entry of destination.entries()){void entry;throw Error('tag_backup_directory_not_empty')}
}
async function writeVerified(root:FileSystemDirectoryHandle,path:string[],raw:string){
    let dir=root;for(const part of path.slice(0,-1))dir=await dir.getDirectoryHandle(part,{create:true});
    const stream=await(await dir.getFileHandle(path.at(-1)!,{create:true})).createWritable();
    try{await stream.write(raw);await stream.close()}catch(error){await stream.abort().catch(()=>{});throw error}
    if(await readTagFile(root,path)!==raw)throw Error('tag_backup_verification_failed');
}
/** Backs up every overwritten original and the read-only manifests, not audio/body/journal history. */
export async function writeTagUpgradeCheckpoint(source:FileSystemDirectoryHandle,backup:FileSystemDirectoryHandle,projectId:string,
    patches:TagFilePatch[],originals:Map<string,string>,unchanged:Map<string,string>){
    await assertTagBackupDestination(source,backup);
    const checkpoint:Checkpoint={kind:'ripple-tag-upgrade-checkpoint',schemaVersion:1,projectId,createdAt:new Date().toISOString(),
        purpose:'Upgrade rollback only; requires unchanged original manuscripts and media. Not a standalone project backup.',originals:[],unchanged:[],patches:[]};
    for(const [name,raw]of originals){const path=name.split('/');if(!safe(path))throw Error('tag_upgrade_invalid_checkpoint');
        await writeVerified(backup,['original',...path],raw);checkpoint.originals.push({path,hash:await sha256(raw)});}
    for(const [name,hash]of unchanged)checkpoint.unchanged.push({path:name.split('/'),hash});
    for(const patch of patches){
        if(!safe(patch.path)||patch.after===null||!isIndex(patch.path)&&(!isCreatedTag(patch.path)||patch.before!==null))throw Error('tag_upgrade_invalid_checkpoint');
        if(patch.before!==null&&originals.get(key(patch.path))!==patch.before)throw Error('tag_upgrade_original_not_backed_up');
        checkpoint.patches.push({path:patch.path,beforeHash:patch.before===null?null:await sha256(patch.before),afterHash:await sha256(patch.after)});
    }
    // Written last: a partial backup without a verified recovery manifest is never ready to migrate.
    await writeVerified(backup,[TAG_UPGRADE_RECOVERY],JSON.stringify(checkpoint,null,2));
}
async function readCheckpoint(backup:FileSystemDirectoryHandle):Promise<Checkpoint>{
    const raw=await readTagFile(backup,[TAG_UPGRADE_RECOVERY]);if(!raw)throw Error('tag_upgrade_invalid_checkpoint');
    const c=JSON.parse(raw) as Checkpoint,hash=(h:unknown)=>typeof h==='string'&&/^[a-f0-9]{64}$/.test(h);
    if(c.kind!=='ripple-tag-upgrade-checkpoint'||c.schemaVersion!==1||!c.projectId||!Array.isArray(c.originals)||!Array.isArray(c.unchanged)||!Array.isArray(c.patches)
        ||[...c.originals,...c.unchanged].some(f=>!safe(f.path)||!hash(f.hash))
        ||c.patches.some(p=>!safe(p.path)||!hash(p.afterHash)||(isIndex(p.path)?!hash(p.beforeHash):!isCreatedTag(p.path)||p.beforeHash!==null)))throw Error('tag_upgrade_invalid_checkpoint');
    if(c.patches.filter(p=>isIndex(p.path)).length!==1||new Set(c.patches.map(p=>key(p.path))).size!==c.patches.length)throw Error('tag_upgrade_invalid_checkpoint');
    if(c.originals.find(f=>isIndex(f.path))?.hash!==c.patches.find(p=>isIndex(p.path))!.beforeHash)throw Error('tag_upgrade_invalid_checkpoint');
    return c;
}
/** Call only while the application is closed, before any subsequent editing. Never overwrite changed content. */
export async function restoreTagUpgradeCheckpoint(source:FileSystemDirectoryHandle,backup:FileSystemDirectoryHandle){
    const c=await readCheckpoint(backup),originals=new Map<string,string>();
    for(const file of c.originals){const raw=await readTagFile(backup,['original',...file.path]);if(raw===null||await sha256(raw)!==file.hash)throw Error('tag_backup_verification_failed');originals.set(key(file.path),raw)}
    const original=originals.get('ripple-project.json');if(!original||JSON.parse(original).id!==c.projectId)throw Error('tag_upgrade_invalid_checkpoint');
    // Check every manuscript/manifest before considering any recovery or rollback write.
    for(const file of c.unchanged){const raw=await readTagFile(source,file.path);if(raw===null||await sha256(raw)!==file.hash)throw Error('tag_upgrade_rollback_source_changed')}
    const journal=await readTagFile(source,['.ripple-tag-transaction.json']);
    let prepared=false;
    if(journal){
        const pending=JSON.parse(journal) as {state:string;patches:TagFilePatch[]};prepared=pending.state==='prepared';
        if(!Array.isArray(pending.patches)||pending.patches.length!==c.patches.length)throw Error('tag_upgrade_recovery_conflict');
        for(const p of pending.patches){const expected=c.patches.find(row=>safe(p.path)&&key(row.path)===key(p.path));
            if(!expected||(p.before===null?expected.beforeHash!==null:typeof p.before!=='string'||await sha256(p.before)!==expected.beforeHash)||typeof p.after!=='string'||await sha256(p.after)!==expected.afterHash)throw Error('tag_upgrade_recovery_conflict');}
    }
    const rows:TagFilePatch[]=[];
    for(const patch of c.patches){const raw=await readTagFile(source,patch.path),hash=raw===null?null:await sha256(raw);
        if(hash!==patch.beforeHash&&hash!==patch.afterHash&&!(prepared&&patch.beforeHash===null&&raw===''))throw Error('tag_upgrade_rollback_source_changed');
        rows.push({path:patch.path,before:raw,after:patch.beforeHash===null?null:originals.get(key(patch.path))??null});
    }
    if(journal!==null){
        await recoverTagFileTransaction(source);
        // Recovery can already restore the prepared migration. Re-read; never commit stale rollback snapshots.
        for(const row of rows)row.before=await readTagFile(source,row.path);
    }
    await commitTagFileTransaction(source,rows);
}
