// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { syntheticDirectory } from '../testUtils/syntheticDirectory';
import { resolveLinkProject } from './segmentLinkProject';
import type { OpenProject } from './projectStore';
const project = (directory: FileSystemDirectoryHandle, id='project-a'):OpenProject => ({directory,data:{kind:'ripple-project',schemaVersion:1,id,title:'Same display name',description:'',revision:0,interviews:[]}});
it('restores a moved folder only through a chosen location with the same identity',async()=>{
 const old=syntheticDirectory().handle, moved=syntheticDirectory().handle;
 const io={access:vi.fn(async()=> 'missing'),open:vi.fn(async()=>project(moved)),choose:vi.fn(async()=>moved),permit:vi.fn(async()=>{})};
 expect((await resolveLinkProject('project-a',null,[{id:'project-a',title:'Old title',directory:old}],io))?.directory).toBe(moved);
 expect(io.open).toHaveBeenCalledExactlyOnceWith(moved); expect(io.permit).toHaveBeenCalledExactlyOnceWith(moved);
});
it('rejects a different project at a selected or remembered path even with an identical title',async()=>{
 const dir=syntheticDirectory().handle;
 for(const access of ['granted','missing']) {
  const io={access:vi.fn(async()=>access),open:vi.fn(async()=>project(dir,'different-id')),choose:vi.fn(async()=>dir),permit:vi.fn(async()=>{})};
  await expect(resolveLinkProject('project-a',null,[{id:'project-a',title:'Same display name',directory:dir}],io)).rejects.toThrow();
 }
});
it('does not choose arbitrarily between known copies; explicitly active copy takes precedence',async()=>{
 const a=syntheticDirectory().handle,b=syntheticDirectory().handle;
 const recent=[{id:'project-a',title:'Same display name',directory:a},{id:'project-a',title:'Same display name',directory:b}];
 const io={access:vi.fn(async()=> 'granted'),open:vi.fn(async(dir:FileSystemDirectoryHandle)=>project(dir)),choose:vi.fn(async()=>null),permit:vi.fn(async()=>{})};
 expect(await resolveLinkProject('project-a',null,recent,io)).toBeNull();expect(io.open).not.toHaveBeenCalled();
 expect((await resolveLinkProject('project-a',project(b),recent,io))?.directory).toBe(b);
});
it('permission restoration is cancelable and unreadable saved folders do not trigger disk searches',async()=>{
 const dir=syntheticDirectory().handle;
 const io={access:vi.fn(async()=> 'granted'),open:vi.fn(async()=>{throw Error('unreadable');}),choose:vi.fn(async()=>null),permit:vi.fn(async()=>{})};
 expect(await resolveLinkProject('project-a',project(dir),[],io)).toBeNull();expect(io.open).toHaveBeenCalledTimes(1);expect(io.permit).not.toHaveBeenCalled();
});
