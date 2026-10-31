import {expect,it} from 'vitest';
import {emptyTagLibrary,setTagPath} from './tags';
import {tagTreeGuides} from './tagTreeGuides';
it('connects the nearest real member and preserves every missing level without unrelated connections',()=>{
 let library=setTagPath(emptyTagLibrary(),'Root/Branch/Leaf').library;library=setTagPath(library,'Detached/Another/Tip').library;
 const id=(name:string)=>library.tags.find(tag=>tag.name===name)!.id,root=id('Root'),leaf=id('Leaf'),tip=id('Tip');
 const members=new Set([root,leaf,tip]),guides=tagTreeGuides(library,[root,leaf,tip],members);
 expect(guides.get(leaf)).toEqual({depth:2,parentDepth:0,parentId:root,missing:1,continuingDepths:[]});
 expect(guides.get(tip)).toEqual({depth:2,parentDepth:null,parentId:null,missing:2,continuingDepths:[]});
 // Membership, not the transient search result, determines which ancestor owns the edge.
 expect(tagTreeGuides(library,[leaf],members).get(leaf)?.parentDepth).toBe(0);
});
it('normal adjacent parent-child edges have no dots and ancestor trunks continue only within their branch',()=>{
 let library=setTagPath(emptyTagLibrary(),'Root/Branch/Leaf').library;library=setTagPath(library,'Root/Sibling').library;
 const ids=['Root','Branch','Leaf','Sibling'].map(name=>library.tags.find(tag=>tag.name===name)!.id),guides=tagTreeGuides(library,ids);
 expect(guides.get(ids[1])).toEqual({depth:1,parentDepth:0,parentId:ids[0],missing:0,continuingDepths:[0]});expect(guides.get(ids[2])?.continuingDepths).toEqual([0]);expect(guides.get(ids[3])?.continuingDepths).toEqual([]);
});
