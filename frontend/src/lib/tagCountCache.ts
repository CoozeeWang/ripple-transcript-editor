import type {TagFields} from './tagSidecar';
import {tagAncestors,type TagLibrary} from './tags';
export class TagCountTotals extends Map<string,number>{
    readonly coverage:Map<string,number>;
    constructor(direct:Iterable<readonly[string,number]>=[],coverage:Iterable<readonly[string,number]>=[]){super(direct);this.coverage=new Map(coverage)}
}
interface Version {fields:TagFields;counts:TagCountTotals}
interface Entry {index:string;generation:number;tree:string;versions:Map<string,Version>;totals:TagCountTotals}
const cache=new WeakMap<FileSystemDirectoryHandle,Entry>();let generation=0;
export function invalidateTagCountCaches(){generation++}
const treeKey=(library:TagLibrary)=>JSON.stringify(library.tags.map(tag=>[tag.id,tag.parentId??null]));
function scopes(library:TagLibrary){return new Map(library.tags.map(tag=>[tag.id,[tag.id,...tagAncestors(library,tag.id).map(t=>t.id)]]))}
function count(fields:TagFields,ancestors:ReturnType<typeof scopes>){const direct=new Map<string,number>(),coverage=new Map<string,number>();for(const [,ids]of fields.segments){const hit=new Set<string>();for(const id of new Set(ids??[])){if(!ancestors.has(id))continue;direct.set(id,(direct.get(id)??0)+1);for(const parent of ancestors.get(id)!)hit.add(parent)}for(const id of hit)coverage.set(id,(coverage.get(id)??0)+1)}return new TagCountTotals(direct,coverage)}
function totals(versions:Entry['versions'],library:TagLibrary){const result=new TagCountTotals(library.tags.map(t=>[t.id,0] as const),library.tags.map(t=>[t.id,0] as const));for(const {counts}of versions.values()){for(const[id,n]of counts)if(result.has(id))result.set(id,result.get(id)!+n);for(const[id,n]of counts.coverage)if(result.has(id))result.coverage.set(id,result.coverage.get(id)!+n)}return result}
const copy=(value:TagCountTotals)=>new TagCountTotals(value,value.coverage);
export function cachedProjectTagCounts(root:FileSystemDirectoryHandle,index:string){const value=cache.get(root);return value?.index===index&&value.generation===generation?copy(value.totals):null}
export function storeProjectTagCounts(root:FileSystemDirectoryHandle,index:string,rows:{path:string[];fields:TagFields}[],library:TagLibrary){const ancestors=scopes(library),versions=new Map(rows.map(row=>[JSON.stringify(row.path),{fields:row.fields,counts:count(row.fields,ancestors)}]));const value={index,generation,tree:treeKey(library),versions,totals:totals(versions,library)};cache.set(root,value);return copy(value.totals)}
/** Published after durable commit only; changed metadata replaces only that version's cached counts. */
export function updateProjectTagCounts(root:FileSystemDirectoryHandle,beforeIndex:string,afterIndex:string,rows:{path:string[];fields:TagFields}[],library:TagLibrary){
 const old=cache.get(root);if(!old||old.generation!==generation||old.index!==beforeIndex)return;
 const tree=treeKey(library),ancestors=scopes(library),versions=new Map(old.versions);
 for(const row of rows)versions.set(JSON.stringify(row.path),{fields:row.fields,counts:count(row.fields,ancestors)});
 if(tree!==old.tree)for(const[key,version]of versions)versions.set(key,{...version,counts:count(version.fields,ancestors)});
 cache.set(root,{index:afterIndex,generation,tree,versions,totals:totals(versions,library)});
}
