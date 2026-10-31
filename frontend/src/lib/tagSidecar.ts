import {invalidateTagCountCaches} from './tagCountCache';
import type {Transcript} from '../types';
import {isTagCollection, versionTagCollection, validateTagCollection,type TagCollection} from './tagCollections';
import type {TagLibrary} from './tags';
import {commitTagFileTransaction, readTagFile, recoverTagFileTransaction,type TagFilePatch} from './tagFileTransaction';

export const TAG_STORAGE_MARKER = 'tag-storage.json';
export const isTagStorageFile=(name:string)=>name===TAG_STORAGE_MARKER||/^tags-[a-f0-9]{64}\.json$/.test(name)||name==='.ripple-document-transaction.json';
export interface TagFields {collection: Transcript['tagCollection']; segments: [string, string[] | undefined][]}
export interface TagSidecar {
    kind: 'ripple-version-tags'; schemaVersion: 1; revision: string; file: string;
    body: {hash: string; size: number; modified?: string};
    collection: TagCollection; segments: [string, string[] | undefined][];
}
type MetadataHandle = FileSystemFileHandle & {getMetadata?: () => Promise<{size:number;modified:string}>};
const known = new WeakSet<FileSystemDirectoryHandle>();
type SourceStamp={previousHash:string;hash:string;size:number;modified:string};
const verified:{directory:FileSystemDirectoryHandle;entries:Map<string,SourceStamp>}[]=[];
async function sourceCache(dir:FileSystemDirectoryHandle){
    for(const item of verified)if(item.directory===dir||await dir.isSameEntry?.(item.directory))return item.entries;
    const entries=new Map<string,SourceStamp>();verified.push({directory:dir,entries});if(verified.length>256)verified.shift();return entries;
}
const same = (a:unknown,b:unknown) => JSON.stringify(a) === JSON.stringify(b);
export const sidecarName = async (file: string) => `tags-${await sha256(file)}.json`;
export const tagFields = (transcript: Transcript): TagFields => ({collection:transcript.tagCollection,
    segments:transcript.segments.map(segment=>[segment.id,segment.tagIds])});
export async function sha256(raw: string): Promise<string> {
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)))].map(v=>v.toString(16).padStart(2,'0')).join('');
}
export async function fileMetadata(handle: FileSystemFileHandle): Promise<{size:number;modified:string}> {
    if ((handle as MetadataHandle).getMetadata) return (handle as MetadataHandle).getMetadata!();
    const file=await handle.getFile();return {size:file.size,modified:String(file.lastModified)};
}
export function parseTagSidecar(raw:string, file?:string):TagSidecar {
    const data=JSON.parse(raw) as TagSidecar;
    if(data?.kind!=='ripple-version-tags'||data.schemaVersion!==1||typeof data.revision!=='string'||!data.revision
        ||typeof data.file!=='string'||(file!==undefined&&data.file!==file)||!isTagCollection(data.collection)
        ||!/^[a-f0-9]{64}$/.test(data.body?.hash)||!Number.isSafeInteger(data.body.size)||data.body.size<0
        ||!Array.isArray(data.segments)||new Set(data.segments.map(pair=>pair?.[0])).size!==data.segments.length
        ||data.segments.some(pair=>!Array.isArray(pair)||pair.length!==2||typeof pair[0]!=='string'||!pair[0]
            ||pair[1]!=null&&(!Array.isArray(pair[1])||new Set(pair[1]).size!==pair[1].length||pair[1].some(id=>!data.collection.tagIds.includes(id)))))
        throw Error('tag_metadata_invalid');
    data.segments=data.segments.map(([id,ids])=>[id,ids??undefined]);
    return data;
}
export function makeTagSidecar(file:string, transcript:Transcript, library:TagLibrary, body:TagSidecar['body']):TagSidecar {
    return {kind:'ripple-version-tags',schemaVersion:1,revision:crypto.randomUUID(),file,body,
        collection:versionTagCollection(transcript,library),segments:tagFields(transcript).segments};
}
export function sidecarTranscript(data:TagSidecar):Transcript {
    return {audio:{filename:'',duration:0},speakers:[],tagCollection:data.collection,
        tagStorageRevision:data.revision,segments:data.segments.map(([id,tagIds])=>({id,text:'',speaker_id:'',start:0,end:0,...(tagIds?{tagIds}: {})}))};
}
export function applySidecar(transcript:Transcript, data:TagSidecar):Transcript {
    if(!same(transcript.segments.map(s=>s.id),data.segments.map(([id])=>id)))throw Error('tag_metadata_structure_changed');
    const ids=new Map(data.segments);
    return {...transcript,tagCollection:data.collection,tagStorageRevision:data.revision,
        segments:transcript.segments.map(segment=>{
            const tagIds=ids.get(segment.id);
            return same(segment.tagIds,tagIds)?segment:{...segment,tagIds};
        })};
}
export async function hasTagStorage(dir:FileSystemDirectoryHandle):Promise<boolean> {
    if(known.has(dir))return true;
    const raw=await readTagFile(dir,[TAG_STORAGE_MARKER]);if(raw===null)return false;
    if(JSON.parse(raw)?.schemaVersion!==1)throw Error('tag_metadata_invalid');known.add(dir);return true;
}
/** Only a newly created empty container may be enabled without explicit project migration. */
export async function initializeTagStorage(dir:FileSystemDirectoryHandle):Promise<void> {
    if(await hasTagStorage(dir))return;
    for await(const _entry of dir.entries()) { void _entry; throw Error('tag_storage_migration_required'); }
    await writeSmall(dir,TAG_STORAGE_MARKER,JSON.stringify({schemaVersion:1}));known.add(dir);
}
/** Staged import only: the original directory remains untouched and publication follows validation. */
export async function seedImportedTagStorage(dir:FileSystemDirectoryHandle,library:TagLibrary):Promise<void> {
    if(await hasTagStorage(dir))return;
    const raw=await readTagFile(dir,['manifest.json']);if(raw===null)throw Error('tag_metadata_missing');
    const manifest=JSON.parse(raw) as {models:{original?:string;edits:{file:string}[]}[]};
    const patches=[];
    for(const file of new Set(manifest.models.flatMap(m=>[...(m.original?[m.original]:[]),...m.edits.map(e=>e.file)]))){
        const body=await readTagFile(dir,[file]);if(body===null)throw Error('tag_consumer_version_unavailable');
        const transcript=JSON.parse(body).transcript as Transcript;if(!Array.isArray(transcript?.segments))throw Error('tag_consumer_version_unavailable');
        const metadata=makeTagSidecar(file,transcript,library,{hash:await sha256(body),...await fileMetadata(await dir.getFileHandle(file))});
        validateTagCollection(library,metadata.collection);
        patches.push({path:[await sidecarName(file)],before:null,after:JSON.stringify(metadata)});
    }
    patches.push({path:[TAG_STORAGE_MARKER],before:null,after:JSON.stringify({schemaVersion:1})});
    await commitTagFileTransaction(dir,patches,'document');known.add(dir);
}
/** Copy/import pays source verification once, before publication; later tag commands use stat only. */
export async function refreshCopiedTagStamps(dir:FileSystemDirectoryHandle):Promise<void>{
    if(!await hasTagStorage(dir))return;
    for await(const [name,entry]of dir.entries())if(entry.kind==='file'&&/^tags-[a-f0-9]{64}\.json$/.test(name)){
        const raw=await readTagFile(dir,[name]);if(raw===null)throw Error('tag_metadata_missing');
        const data=parseTagSidecar(raw);
        try{data.body=await verifyTagSource(dir,data);await writeSmall(dir,name,JSON.stringify(data))}
        catch(error){if((error as {name?:string}).name!=='NotFoundError')throw error /* unreferenced retained copy may have no live body */}
    }
}
async function writeSmall(dir:FileSystemDirectoryHandle,name:string,raw:string) {
    const stream=await(await dir.getFileHandle(name,{create:true})).createWritable();
    try{await stream.write(raw);await stream.close()}catch(error){await stream.abort().catch(()=>{});throw error}
    if(await readTagFile(dir,[name])!==raw)throw Error('tag_transaction_verification_failed');
}
/** Fast stat normally; a missing/stale derived stamp triggers one full hash, never a silent fallback. */
export async function verifyTagSource(dir:FileSystemDirectoryHandle,data:TagSidecar, rawBody?:string):Promise<TagSidecar['body']> {
    const handle=await dir.getFileHandle(data.file), stat=await fileMetadata(handle);
    const entries=await sourceCache(dir),cache=entries.get(data.file), source=cache?.previousHash===data.body.hash?cache:data.body;
    if(source.modified===stat.modified&&source.size===stat.size)return {hash:source.hash,...stat};
    const raw=rawBody??await(await handle.getFile()).text();
    const hash=await sha256(raw);
    if(hash!==data.body.hash){
        if(rawBody===undefined)throw Error('tag_metadata_source_changed_reopen');
        const body=JSON.parse(raw) as {transcript?:Transcript};
        if(!same(body.transcript?.segments.map(s=>s.id),data.segments.map(([id])=>id)))throw Error('tag_metadata_structure_changed');
    }
    if(!same(await fileMetadata(handle),stat))throw Error('tag_metadata_source_changed_reopen');
    entries.set(data.file,{previousHash:data.body.hash,hash,...stat});
    return{hash,...stat};
}
/** Opening a body joins metadata once; the persisted body is never a fallback source of tag state. */
export async function hydrateTagDocument(dir:FileSystemDirectoryHandle,file:string,raw:string):Promise<string> {
    if(!file.endsWith('.json')||isTagStorageFile(file)||file==='manifest.json'||!await hasTagStorage(dir))return raw;
    let doc:{transcript?:Transcript};try{doc=JSON.parse(raw)}catch{return raw}
    if(!Array.isArray(doc.transcript?.segments))return raw;
    await recoverTagFileTransaction(dir,'document');
    const saved=await readTagFile(dir,[await sidecarName(file)]);if(saved===null)throw Error('tag_metadata_missing');
    const data=parseTagSidecar(saved,file);await verifyTagSource(dir,data,raw);invalidateTagCountCaches();
    return JSON.stringify({...doc,transcript:applySidecar(doc.transcript!,data)});
}
/** Content/structure writes are the only path allowed to write both a body and tag metadata. */
export async function writeTagDocument(dir:FileSystemDirectoryHandle,file:string,obj:unknown,additional:TagFilePatch[]=[],rollbackBody=false):Promise<boolean> {
    const doc=obj as {transcript?:Transcript};if(!Array.isArray(doc?.transcript?.segments)||!await hasTagStorage(dir))return false;
    await recoverTagFileTransaction(dir,'document');
    const metadataName=await sidecarName(file);
    const previous=await readTagFile(dir,[file]), previousMeta=await readTagFile(dir,[metadataName]);
    if(previous!==null&&previousMeta===null)throw Error('tag_metadata_missing');
    const old=previousMeta===null?undefined:parseTagSidecar(previousMeta,file), transcript=doc.transcript!;
    if(old){
        await verifyTagSource(dir,old);
        const fields=tagFields(transcript), oldFields={collection:old.collection,segments:old.segments};
        if(!same(fields,oldFields)&&transcript.tagStorageRevision!==old.revision)throw Error('tag_metadata_stale_write');
    }
    const raw=manuscriptJson(doc as {transcript:Transcript});
    const data:TagSidecar={kind:'ripple-version-tags',schemaVersion:1,revision:crypto.randomUUID(),file,
        body:{hash:await sha256(raw),size:new TextEncoder().encode(raw).length},
        collection:transcript.tagCollection??{schemaVersion:1,tagIds:[],groups:[]},segments:tagFields(transcript).segments};
    // The token guards explicit tag commands. Body/structure commits have their own source hash;
    // retaining this token also permits ordinary content undo without weakening tag concurrency.
    if(old)data.revision=old.revision;
    parseTagSidecar(JSON.stringify(data),file);
    const metadataPatch={path:[metadataName],before:previousMeta,after:JSON.stringify(data)};
    if(!old||same(tagFields(transcript),{collection:old.collection,segments:old.segments})){
        // An unchanged segment/tag structure is valid with either body generation. Do not put
        // word arrays into autosave journals. A crash before the small stamp commit is rebuilt
        // from the new body on open; associations have not changed.
        await writeSmall(dir,file,raw);
        const stat=await fileMetadata(await dir.getFileHandle(file));
        if(old)(await sourceCache(dir)).set(file,{previousHash:old.body.hash,hash:data.body.hash,...stat});
        data.body.modified=stat.modified;metadataPatch.after=JSON.stringify(data);
        try{await commitTagFileTransaction(dir,[metadataPatch,...additional],'document')}
        catch(error){
            if(rollbackBody&&previous!==null){
                try{await writeSmall(dir,file,previous);(await sourceCache(dir)).delete(file)}catch(recovery){throw new AggregateError([error,recovery],'tag_document_recovery_required',{cause:recovery})}
            }
            throw error;
        }
    }else await commitTagFileTransaction(dir,[{path:[file],before:previous,after:raw},metadataPatch,...additional],'document');
    if(!old||!same(tagFields(transcript),{collection:old.collection,segments:old.segments}))invalidateTagCountCaches();
    transcript.tagStorageRevision=data.revision;
    transcript.tagCollection=data.collection;
    // Derived fingerprint only. A failed stamp update leaves the committed authoritative hash valid.
    try{data.body.modified=(await fileMetadata(await dir.getFileHandle(file))).modified;await writeSmall(dir,metadataName,JSON.stringify(data))}catch { /* next access revalidates the hash */ }
    return true;
}
function manuscriptJson(doc:{transcript:Transcript}){
    const {tagCollection:_collection,tagStorageRevision:_revision,...body}=doc.transcript;void _collection;void _revision;
    return JSON.stringify({...doc,transcript:{...body,segments:body.segments.map(segment=>{
        const {tagIds:_ids,...content}=segment;void _ids;return content;
    })}},null,2);
}
/** A title/version rename publishes all filename mappings, metadata and manifest atomically. */
export async function rewriteTagDocuments(dir:FileSystemDirectoryHandle,files:{old:string;target:string;document:{transcript:Transcript}}[],manifest:unknown):Promise<void>{
    const patches=new Map<string,TagFilePatch>(),metadata:TagSidecar[]=[];
    async function stage(name:string,after:string|null){
        const previous=patches.get(name);patches.set(name,{path:[name],before:previous?.before??await readTagFile(dir,[name]),after});
    }
    for(const file of files){
        const raw=await readTagFile(dir,[await sidecarName(file.old)]);if(raw===null)throw Error('tag_metadata_missing');
        const old=parseTagSidecar(raw,file.old);await verifyTagSource(dir,old);
        if(!same(tagFields(file.document.transcript),{collection:old.collection,segments:old.segments}))throw Error('tag_metadata_stale_write');
        metadata.push({...old,file:file.target,body:{hash:'',size:0}});
    }
    const targets=new Set(files.map(f=>f.target));
    for(const file of files)if(!targets.has(file.old)){await stage(file.old,null);await stage(await sidecarName(file.old),null)}
    for(const [i,file]of files.entries()){
        const raw=manuscriptJson(file.document),data=metadata[i];data.body={hash:await sha256(raw),size:new TextEncoder().encode(raw).length};
        await stage(file.target,raw);await stage(await sidecarName(file.target),JSON.stringify(data));
    }
    const previous=await readTagFile(dir,['manifest.json']);if(previous!==null)await stage('manifest.json.bak',previous);
    await stage('manifest.json',JSON.stringify(manifest,null,2));
    await commitTagFileTransaction(dir,[...patches.values()],'document');
    for(const data of metadata)try{data.body.modified=(await fileMetadata(await dir.getFileHandle(data.file))).modified;await writeSmall(dir,await sidecarName(data.file),JSON.stringify(data))}catch{/* derived stamp only */}
}
