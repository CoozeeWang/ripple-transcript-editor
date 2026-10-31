import {recordingSources} from './projectTagRepository';
import {parseProject,recordingDirectory,withProjectLock,type OpenProject} from './projectStore';
import {withTagVersionStorage} from '../localStore';
import {commitTagFileTransaction,readTagFile,type TagFilePatch} from './tagFileTransaction';
import {makeTagSidecar,sha256,fileMetadata,sidecarName,TAG_STORAGE_MARKER} from './tagSidecar';
import {projectTagCatalog,validateTagCollection} from './tagCollections';
import type {Transcript} from '../types';

async function digest(file:Blob){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('')}
/** Explicit caller-chosen, complete and verified backup. Never an implicit open-time migration. */
async function backupProject(source:FileSystemDirectoryHandle,destination:FileSystemDirectoryHandle):Promise<Map<string,string>> {
    const relative=await source.resolve?.(destination);
    const native=(dir:FileSystemDirectoryHandle)=>{const d=dir as FileSystemDirectoryHandle&{root?:string;parts?:string[]};return d.root?[d.root.replace(/\/$/,''),...(d.parts??[])].join('/'):null};
    const from=native(source),to=native(destination);
    if(await source.isSameEntry?.(destination)||relative!=null||(from&&to&&(from===to||to.startsWith(from+'/'))))throw Error('tag_backup_must_be_outside_project');
    for await(const _entry of destination.entries()){void _entry;throw Error('tag_backup_directory_not_empty')}
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
export async function migrateProjectTagStorage(project:OpenProject,backup:FileSystemDirectoryHandle):Promise<OpenProject> {
    return withProjectLock(project.data.id,async()=>{
        const index=await readTagFile(project.directory,['ripple-project.json']);if(!index)throw Error('project_changed');
        const data=parseProject(index);if(data.id!==project.data.id||data.revision!==project.data.revision)throw Error('project_changed');
        if(data.schemaVersion===2)return{...project,data};
        const hashes=await backupProject(project.directory,backup);
        const library=projectTagCatalog(data.tagLibrary??{schemaVersion:3,tags:[],groups:[]}),patches:TagFilePatch[]=[],sources:{handle:FileSystemFileHandle;stat:{size:number;modified:string}}[]=[];
        for(const {session,recording}of recordingSources(project)){
            const directory=await recordingDirectory(project,session.id,recording);
            await withTagVersionStorage(directory,recording.file,async(container,manifest)=>{
                if(!container||!manifest)return;
                const indexed=new Set(manifest.models.flatMap(model=>[...(model.original?[model.original]:[]),...model.edits.map(e=>e.file)]));
                const candidates=new Set(indexed);
                for await(const [name,entry]of container.entries())if(entry.kind==='file'&&name.endsWith('.json')&&name!=='manifest.json'&&!name.startsWith('tags-'))candidates.add(name);
                for(const file of candidates){
                    const path=['interviews',session.id,container.name,file],handle=await container.getFileHandle(file),stat=await fileMetadata(handle),raw=await(await handle.getFile()).text();
                    const hash=await sha256(raw);if(hashes.get(path.join('/'))!==hash)throw Error('tag_migration_source_changed');
                    let document:{kind?:string;transcript?:Transcript};try{document=JSON.parse(raw)}catch(error){if(indexed.has(file))throw error;continue}
                    const transcript=document.transcript;
                    if(!Array.isArray(transcript?.segments)||!['te-original','te-edited','te-imported'].includes(document.kind??'')){if(indexed.has(file))throw Error('tag_consumer_version_unavailable');continue}
                    const metadata=makeTagSidecar(file,transcript,library,{hash,...stat});validateTagCollection(library,metadata.collection);
                    const target=[...path.slice(0,-1),await sidecarName(file)];
                    if(await readTagFile(project.directory,target)!==null)throw Error('tag_migration_existing_metadata');
                    patches.push({path:target,before:null,after:JSON.stringify(metadata)});sources.push({handle,stat});
                }
                const marker=['interviews',session.id,container.name,TAG_STORAGE_MARKER];
                if(await readTagFile(project.directory,marker)!==null)throw Error('tag_migration_existing_metadata');
                patches.push({path:marker,before:null,after:JSON.stringify({schemaVersion:1})});
            });
        }
        for(const {handle,stat}of sources)if(JSON.stringify(await fileMetadata(handle))!==JSON.stringify(stat))throw Error('tag_migration_source_changed');
        const next={...data,schemaVersion:2 as const,tagLibrary:library,revision:data.revision+1};
        patches.push({path:['ripple-project.json'],before:index,after:JSON.stringify(next,null,2)});
        await commitTagFileTransaction(project.directory,patches);
        return{...project,data:next};
    });
}
