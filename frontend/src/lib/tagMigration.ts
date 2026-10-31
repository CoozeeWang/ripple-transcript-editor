import {recordingSources} from './projectTagRepository';
import {parseProject,recordingDirectory,withProjectLock,type OpenProject} from './projectStore';
import {withTagVersionStorage} from '../localStore';
import {commitTagFileTransaction,readTagFile,type TagFilePatch} from './tagFileTransaction';
import {makeTagSidecar,parseTagSidecar,sha256,fileMetadata,sidecarName,TAG_STORAGE_MARKER} from './tagSidecar';
import {projectTagCatalog,validateTagCollection} from './tagCollections';
import type {Transcript} from '../types';
import {assertTagBackupDestination,writeTagUpgradeCheckpoint} from './tagUpgradeBackup';

async function digest(file:Blob){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('')}
/** Explicit caller-chosen, complete and verified backup. Never an implicit open-time migration. */
async function backupProject(source:FileSystemDirectoryHandle,destination:FileSystemDirectoryHandle):Promise<Map<string,string>> {
    await assertTagBackupDestination(source,destination);
    const hashes=new Map<string,string>();
    async function copy(from:FileSystemDirectoryHandle,to:FileSystemDirectoryHandle,parts:string[]){
        for await(const [name,entry]of from.entries()){
            if(entry.kind==='directory')await copy(entry as FileSystemDirectoryHandle,await to.getDirectoryHandle(name,{create:true}),[...parts,name]);
            else{
                const file=await(entry as FileSystemFileHandle).getFile(),hash=await digest(file),target=await to.getFileHandle(name,{create:true}),stream=await target.createWritable();
                try{await stream.write(file);await stream.close()}catch(error){await stream.abort().catch(()=>{});throw error}
                if(await digest(await target.getFile())!==hash)throw Error('tag_backup_verification_failed');
                hashes.set([...parts,name].join('/'),hash);
            }
        }
    }
    await copy(source,destination,[]);return hashes;
}
export async function migrateProjectTagStorage(project:OpenProject,backup:FileSystemDirectoryHandle,options:{backupMode?:'full'|'rollback';assertCanCommit?:()=>Promise<void>}={}):Promise<OpenProject> {
    return withProjectLock(project.data.id,async()=>{
        const index=await readTagFile(project.directory,['ripple-project.json']);if(!index)throw Error('project_changed');
        const data=parseProject(index);if(data.id!==project.data.id||data.revision!==project.data.revision)throw Error('project_changed');
        if(data.schemaVersion===2)return{...project,data};
        if(await readTagFile(project.directory,['.ripple-tag-transaction.json'])!==null)throw Error('tag_upgrade_pending_recovery');
        const light=options.backupMode==='rollback';
        if(light)await assertTagBackupDestination(project.directory,backup);
        const hashes=light?new Map<string,string>():await backupProject(project.directory,backup),originals=new Map<string,string>([['ripple-project.json',index]]);
        const library=projectTagCatalog(data.tagLibrary??{schemaVersion:3,tags:[],groups:[]}),patches:TagFilePatch[]=[],sources:{handle:FileSystemFileHandle;stat:{size:number;modified:string}}[]=[];
        for(const {session,recording}of recordingSources(project)){
            const directory=await recordingDirectory(project,session.id,recording);
            await withTagVersionStorage(directory,recording.file,async(container,manifest)=>{
                if(!container)return;
                if(!manifest)throw Error('tag_consumer_version_unavailable');
                if(await readTagFile(project.directory,['interviews',session.id,container.name,'.ripple-document-transaction.json'])!==null)throw Error('tag_upgrade_pending_recovery');
                for(const name of ['manifest.json','manifest.json.bak']){
                    const path=['interviews',session.id,container.name,name],raw=await readTagFile(project.directory,path);
                    if(raw!==null){originals.set(path.join('/'),raw);if(light)hashes.set(path.join('/'),await sha256(raw))}
                }
                const indexed=new Set(manifest.models.flatMap(model=>[...(model.original?[model.original]:[]),...model.edits.map(e=>e.file)]));
                const candidates=new Set(indexed);
                for await(const [name,entry]of container.entries())if(entry.kind==='file'&&name.endsWith('.json')&&name!=='manifest.json'&&!name.startsWith('tags-'))candidates.add(name);
                for(const file of candidates){
                    const path=['interviews',session.id,container.name,file],handle=await container.getFileHandle(file),stat=await fileMetadata(handle),raw=await(await handle.getFile()).text();
                    const hash=await sha256(raw);if(light)hashes.set(path.join('/'),hash);else if(hashes.get(path.join('/'))!==hash)throw Error('tag_migration_source_changed');
                    let document:{kind?:string;transcript?:Transcript};try{document=JSON.parse(raw)}catch(error){if(indexed.has(file))throw error;continue}
                    const transcript=document.transcript;
                    if(!Array.isArray(transcript?.segments)||!['te-original','te-edited','te-imported'].includes(document.kind??'')){if(indexed.has(file))throw Error('tag_consumer_version_unavailable');continue}
                    const metadata=makeTagSidecar(file,transcript,library,{hash,...stat});validateTagCollection(library,metadata.collection);parseTagSidecar(JSON.stringify(metadata),file);
                    const target=[...path.slice(0,-1),await sidecarName(file)];
                    if(await readTagFile(project.directory,target)!==null)throw Error('tag_migration_existing_metadata');
                    patches.push({path:target,before:null,after:JSON.stringify(metadata)});sources.push({handle,stat});
                }
                const marker=['interviews',session.id,container.name,TAG_STORAGE_MARKER];
                if(await readTagFile(project.directory,marker)!==null)throw Error('tag_migration_existing_metadata');
                patches.push({path:marker,before:null,after:JSON.stringify({schemaVersion:1})});
            },{readOnlyManifest:true});
        }
        const next={...data,schemaVersion:2 as const,tagLibrary:library,revision:data.revision+1};
        patches.push({path:['ripple-project.json'],before:index,after:JSON.stringify(next,null,2)});
        if(light)await writeTagUpgradeCheckpoint(project.directory,backup,data.id,patches,originals,hashes);
        for(const {handle,stat}of sources)if(JSON.stringify(await fileMetadata(handle))!==JSON.stringify(stat))throw Error('tag_migration_source_changed');
        for(const [path,raw]of originals)if(await readTagFile(project.directory,path.split('/'))!==raw)throw Error('tag_migration_source_changed');
        await options.assertCanCommit?.();
        await commitTagFileTransaction(project.directory,patches);
        return{...project,data:next};
    });
}
