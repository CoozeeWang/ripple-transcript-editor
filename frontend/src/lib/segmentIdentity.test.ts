// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { projectConnectorFixture } from '../testUtils/syntheticProjectConnector';
import { ensureVersionLinkIdentity, readManifest, createEdit } from '../localStore';
it('adds identity to legacy metadata once, preserving original/edit bodies and visible segment numbers',async()=>{
 const fixture=await projectConnectorFixture();
 const before=await readManifest(fixture.dirA,'session-a.wav');expect(before!.models[0].edits[0].linkId).toBeUndefined();
 const container=await fixture.dirA.getDirectoryHandle('session-a.transcript');
 const editFile=before!.models[0].edits[0].file, originalFile=before!.models[0].original!;
 const read=async(name:string)=>(await (await container.getFileHandle(name)).getFile()).text();
 const edit=await read(editFile), original=await read(originalFile);
 const identity=await ensureVersionLinkIdentity(fixture.dirA,'session-a.wav','m1','e1');
 const originalIdentity=await ensureVersionLinkIdentity(fixture.dirA,'session-a.wav','m1','original');
 const persisted=JSON.parse(await read('manifest.json'));
 expect(persisted.models[0].edits[0].linkId).toBe(identity);
 expect(persisted.models[0].originalLinkId).toBe(originalIdentity);
 expect(await ensureVersionLinkIdentity(fixture.dirA,'session-a.wav','m1','e1')).toBe(identity);
 expect(await read(editFile)).toBe(edit);expect(await read(originalFile)).toBe(original);
});
it('does not publish an unpersisted identity when manifest writing fails',async()=>{
 const fixture=await projectConnectorFixture();
 const container=fixture.fs.dirs.get('interviews')!.dirs.get('session-a')!.dirs.get('session-a.transcript')!;
 container.fail(name=>name === 'manifest.json');
 await expect(ensureVersionLinkIdentity(fixture.dirA,'session-a.wav','m1','e1')).rejects.toThrow();
 container.fail();
 const identity=await ensureVersionLinkIdentity(fixture.dirA,'session-a.wav','m1','e1');
 expect((await readManifest(fixture.dirA,'session-a.wav'))!.models[0].edits[0].linkId).toBe(identity);
});
it('respects a write lock, while already persisted identity can be read without writing',async()=>{
 const fixture=await projectConnectorFixture();
 await expect(ensureVersionLinkIdentity(fixture.dirA,'session-a.wav','m1','e1',false)).rejects.toThrow('pending_locked');
 const identity=await ensureVersionLinkIdentity(fixture.dirA,'session-a.wav','m1','e1');
 expect(await ensureVersionLinkIdentity(fixture.dirA,'session-a.wav','m1','e1',false)).toBe(identity);
});
it('gives an explicitly copied editing version its own persistent identity',async()=>{
 const fixture=await projectConnectorFixture();
 const first=await ensureVersionLinkIdentity(fixture.dirA,'session-a.wav','m1','e1');
 const copy=await createEdit(fixture.dirA,'session-a.wav','m1',{srcEditId:'e1',label:'Synthetic copy'});
 const second=await ensureVersionLinkIdentity(fixture.dirA,'session-a.wav',copy.model.id,copy.edit.id);
 expect(second).not.toBe(first);
});
