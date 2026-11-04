import { expect, it } from 'vitest';
import { initializeProjectTreeOrder, planProjectTreeOrder, dragProjectTree, sortProjectTree } from './projectTreeOrder';
import { isTagLibrary, setTagPath, removeTagBranch } from './tags';
import type { TagConsumer } from './tagCollections';

function fixture() {
  const first=setTagPath({schemaVersion:3,tags:[],groups:[]},'Root/Zeta'),second=setTagPath(first.library,'Root/Alpha');
  const library=second.library,root=library.tags.find(t=>t.name==='Root')!.id;
  const row=(id:string,order:string[]):TagConsumer=>({id,label:'Synthetic '+id,transcript:{audio:{filename:'synthetic.wav',duration:1},speakers:[],segments:[],tagCollection:{schemaVersion:1,tagIds:library.tags.map(t=>t.id),groups:[{id:'legacy',name:'Recoverable group',tagIds:[first.tag.id],order:[first.tag.id]}],levelOrder:order}}});
  return{library,root,zeta:first.tag.id,alpha:second.tag.id,row};
}
it('initializes from the sole saved order and preserves the legacy collection byte-for-byte',()=>{
  const f=fixture(),rows=[f.row('a',[f.root,f.zeta,f.alpha]),f.row('b',[])],before=JSON.stringify(rows);
  const next=initializeProjectTreeOrder(f.library,rows);
  expect(next.schemaVersion).toBe(4);expect(next.treeOrder).toEqual([f.root,f.zeta,f.alpha]);expect(isTagLibrary(next)).toBe(true);expect(JSON.stringify(rows)).toBe(before);
});
it('requires an explicit fresh baseline when independent version orders differ',()=>{
  const f=fixture(),rows=[f.row('a',[f.root,f.zeta,f.alpha]),f.row('b',[f.root,f.alpha,f.zeta])];
  expect(planProjectTreeOrder(f.library,rows).conflict).toBe(true);expect(()=>initializeProjectTreeOrder(f.library,rows)).toThrow('tag_order_baseline_required');
  expect(initializeProjectTreeOrder(f.library,rows,'b').treeOrder).toEqual([f.root,f.alpha,f.zeta]);
  expect(()=>initializeProjectTreeOrder(f.library,rows,'missing')).toThrow('tag_order_baseline_changed');
});
it('never overwrites the new authoritative order with legacy version snapshots',()=>{
  const f=fixture(),next=initializeProjectTreeOrder(f.library,[f.row('a',[f.root,f.zeta,f.alpha])]);
  expect(initializeProjectTreeOrder(next,[f.row('old',[f.root,f.alpha,f.zeta])],'old')).toBe(next);
});
it('uses a single shared sibling order and cleans it when definitions are removed',()=>{
  const f=fixture(),initial=initializeProjectTreeOrder(f.library,[f.row('a',[f.root,f.zeta,f.alpha])]);
  const dragged=dragProjectTree(initial,f.alpha,f.zeta,false);expect(dragged.treeOrder).toEqual([f.root,f.alpha,f.zeta]);expect(initial.treeOrder).toEqual([f.root,f.zeta,f.alpha]);
  expect(sortProjectTree(initial).treeOrder).toEqual(dragged.treeOrder);
  const removed=removeTagBranch(dragged,f.alpha);expect(removed.treeOrder).toEqual([f.root,f.zeta]);expect(isTagLibrary(removed)).toBe(true);
});
it('rejects unknown or duplicate shared ranks and requires explicit initialization',()=>{
  const f=fixture();expect(()=>dragProjectTree(f.library,f.alpha,f.zeta,false)).toThrow('tag_order_upgrade_required');
  expect(isTagLibrary({...f.library,schemaVersion:4,treeOrder:['unknown']})).toBe(false);
  expect(isTagLibrary({...f.library,schemaVersion:4,treeOrder:[f.root,f.root]})).toBe(false);
});
