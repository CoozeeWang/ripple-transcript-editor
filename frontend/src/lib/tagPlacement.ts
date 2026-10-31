import type {TagLibrary} from './tags';
import {tagPath,tagTreeRows,tagParentId} from './tags';
import {admitTags,changeSharedTag,withAncestors,type TagConsumer} from './tagCollections';
import {savedTagOrder} from './tagOrdering';
export interface GroupTagPlacement {tagId:string;sourceGroupId:string|null;groupId:string;parentId:string|null;anchorId:string|null;after:boolean;copy:boolean}
/** One immutable change plan: shared hierarchy + one version's explicit membership and display priority. */
export function placeGroupTag(library:TagLibrary,consumers:TagConsumer[],currentId:string,p:GroupTagPlacement,merge=false){
 const source=library.tags.find(tag=>tag.id===p.tagId),current=consumers.find(row=>row.id===currentId);
 if(!source||!current?.transcript.tagCollection||p.parentId&&!library.tags.some(tag=>tag.id===p.parentId))throw Error('tag_or_group_not_found');
 const groups=current.transcript.tagCollection.groups;
 if(!groups.some(group=>group.id===p.groupId)||p.sourceGroupId&&!groups.some(group=>group.id===p.sourceGroupId&&group.tagIds.includes(p.tagId)))throw Error('tag_not_in_source_group');
 const path=[p.parentId?tagPath(library,p.parentId):'',source.name].filter(Boolean).join('/');
 const changed=(source.parentId??null)===p.parentId?{library,consumers}:changeSharedTag(library,p.tagId,path,consumers,merge);
 const retained=changed.library.tags.find(tag=>tag.id===p.tagId)??changed.library.tags.find(tag=>tagPath(changed.library,tag.id).toLowerCase()===path.toLowerCase());
 if(!retained)throw Error('tag_or_group_not_found');
 return{...changed,consumers:changed.consumers.map(row=>{
  if(row.id!==currentId)return row;
  let collection=admitTags(changed.library,row.transcript.tagCollection!,[retained.id],row.label);
  collection={...collection,groups:collection.groups.map(group=>group.id===p.groupId?{...group,tagIds:[...new Set([...group.tagIds,retained.id])]}:group.id===p.sourceGroupId&&!p.copy?{...group,tagIds:group.tagIds.filter(id=>id!==retained.id),...(group.order?{order:group.order.filter(id=>id!==retained.id)}:{})}:group)};
  const group=collection.groups.find(group=>group.id===p.groupId)!,display=new Set(withAncestors(changed.library,group.tagIds));
  const ranked=tagTreeRows(changed.library,display,'manual',1,()=>0,savedTagOrder(collection,'group',p.groupId)).map(row=>row.tag);
  const siblings=ranked.filter(tag=>tagParentId(tag)===p.parentId).map(tag=>tag.id);
  if(p.anchorId!==null&&!siblings.includes(p.anchorId))throw Error('invalid_tag_order');
  if(p.anchorId!==retained.id){
   const order=siblings.filter(id=>id!==retained.id),at=p.anchorId===null?order.length:order.indexOf(p.anchorId)+(p.after?1:0);order.splice(at,0,retained.id);
   const selected=new Set(siblings),first=ranked.findIndex(tag=>selected.has(tag.id)),rest=ranked.map(tag=>tag.id).filter(id=>!selected.has(id));rest.splice(first<0?rest.length:first,0,...order);
   collection={...collection,groups:collection.groups.map(group=>group.id===p.groupId?{...group,order:rest}:group)};
  }
  return{...row,transcript:{...row.transcript,tagCollection:collection}};
 })};
}
