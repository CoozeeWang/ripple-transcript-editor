import {it,expect} from 'vitest';
import {assertTagNameChange,isTagLibrary,renameTagLeaf,setTagPath,type TagLibrary} from './tags';
const legacy:TagLibrary={schemaVersion:4,groups:[],treeOrder:[],tags:[{id:'a',name:'Topic',parentId:null,groupIds:[]},{id:'p',name:'Parent',parentId:null,groupIds:[]},{id:'b',name:'Topic',parentId:'p',groupIds:[]}]};
it('reads old duplicates unchanged but rejects new duplicates at the write boundary',()=>{
 const before=structuredClone(legacy);expect(isTagLibrary(legacy)).toBe(true);
 const unrelated=setTagPath(legacy,'New');expect(()=>assertTagNameChange(legacy,unrelated.library)).not.toThrow();
 expect(()=>assertTagNameChange(legacy,{...legacy,tags:[...legacy.tags,{id:'c',name:' TOPIC ',parentId:null,groupIds:[]}]})).toThrow('name_conflict');
 const resolved=renameTagLeaf(legacy,'b','Different');expect(resolved.tags.find(t=>t.id==='a')!.name).toBe('Topic');expect(legacy).toEqual(before);
});
it('requires confirmation for a global name merge even without overlapping version memberships',async()=>{
 const {changeSharedTag,TagMergeRequired}=await import('./tagCollections');
 const first=setTagPath({schemaVersion:4,tags:[],groups:[],treeOrder:[]},'Parent/First'),second=setTagPath(first.library,'Other/Second');
 expect(()=>changeSharedTag(second.library,first.tag.id,'Parent/Second',[])).toThrow(TagMergeRequired);
});
