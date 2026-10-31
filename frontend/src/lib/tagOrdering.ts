import {tagTreeRows,tagParentId,type TagLibrary} from './tags';
import type {TagCollection} from './tagCollections';
export type TagOrderView='level'|'group'|'ungrouped';
export function orderMembers(library:TagLibrary,collection:TagCollection,view:TagOrderView,groupId?:string):string[]{
    if(view==='level')return library.tags.map(tag=>tag.id);
    if(view==='group'){const group=collection.groups.find(g=>g.id===groupId);if(!group)throw Error('tag_or_group_not_found');return group.tagIds}
    return collection.tagIds.filter(id=>!collection.groups.some(g=>g.tagIds.includes(id)));
}
export function savedTagOrder(collection:TagCollection,view:TagOrderView,groupId?:string):readonly string[]{
    return view==='level'?collection.levelOrder??[]:view==='ungrouped'?collection.ungroupedOrder??[]:collection.groups.find(g=>g.id===groupId)?.order??[];
}
/** Complete sibling order only. This operation never reparents or implicitly admits a tag. */
export function reorderVersionTags(library:TagLibrary,collection:TagCollection,view:TagOrderView,parentId:string|null,ids:readonly string[],groupId?:string):TagCollection{
    const members=new Set(orderMembers(library,collection,view,groupId));
    const siblings=library.tags.filter(tag=>members.has(tag.id)&&tagParentId(tag)===parentId).map(tag=>tag.id);
    if(new Set(ids).size!==ids.length||ids.length!==siblings.length||ids.some(id=>!siblings.includes(id)))throw Error('invalid_tag_order');
    const old=savedTagOrder(collection,view,groupId),ranked=tagTreeRows(library,members,'manual',1,()=>0,old).map(row=>row.tag.id),selected=new Set(siblings);
    const at=ranked.findIndex(id=>selected.has(id)),rest=ranked.filter(id=>!selected.has(id));rest.splice(at<0?rest.length:at,0,...ids);
    if(view==='level')return{...collection,levelOrder:rest};
    if(view==='ungrouped')return{...collection,ungroupedOrder:rest};
    return{...collection,groups:collection.groups.map(group=>group.id===groupId?{...group,order:rest}:group)};
}
export function dragSiblingOrder(library:TagLibrary,collection:TagCollection,view:TagOrderView,id:string,anchor:string|null,after:boolean,groupId?:string):TagCollection{
    const source=library.tags.find(tag=>tag.id===id);if(!source)throw Error('tag_entity_not_found');
    const parent=tagParentId(source),members=new Set(orderMembers(library,collection,view,groupId));
    const siblings=tagTreeRows(library,members,'manual',1,()=>0,savedTagOrder(collection,view,groupId)).map(row=>row.tag).filter(tag=>tagParentId(tag)===parent).map(tag=>tag.id);
    if(!siblings.includes(id)||anchor!==null&&!siblings.includes(anchor))throw Error('invalid_tag_order');
    if(anchor===id)return collection;const next=siblings.filter(value=>value!==id),at=anchor===null?next.length:next.indexOf(anchor)+(after?1:0);next.splice(at,0,id);
    return reorderVersionTags(library,collection,view,parent,next,groupId);
}
/** Deleted definitions/members cannot remain as dangling display-only order references. */
export function cleanTagOrders(library:TagLibrary,collection:TagCollection):TagCollection{
    const valid=new Set(library.tags.map(tag=>tag.id)),ungrouped=new Set(orderMembers(library,collection,'ungrouped'));
    const next={...collection,...(collection.levelOrder?{levelOrder:collection.levelOrder.filter(id=>valid.has(id))}:{}),
        ...(collection.ungroupedOrder?{ungroupedOrder:collection.ungroupedOrder.filter(id=>valid.has(id)&&ungrouped.has(id))}:{}),
        groups:collection.groups.map(g=>g.order?{...g,order:g.order.filter(id=>g.tagIds.includes(id)&&valid.has(id))}:g)};
    return JSON.stringify(next)===JSON.stringify(collection)?collection:next;
}
