import {it,expect,vi} from 'vitest';
import {readAudioUrl} from '../localStore';
it('uses checked original bytes and a Blob URL even when a native asset URL is available',async()=>{
 const file=new File(['Synthetic immutable audio'],'synthetic.m4a');
 const getFile=vi.fn(async()=>file),getPlaybackUrl=vi.fn(async()=>'asset://localhost/synthetic.m4a');
 const directory={getFileHandle:async()=>({getFile,getPlaybackUrl})} as unknown as FileSystemDirectoryHandle;
 const url=await readAudioUrl(directory,file.name);
 try {expect(url.startsWith('blob:')).toBe(true);expect(await (await fetch(url)).text()).toBe(await file.text());expect(getFile).toHaveBeenCalledOnce();expect(getPlaybackUrl).not.toHaveBeenCalled();}finally{URL.revokeObjectURL(url)}
});
it.each(['permission_required','media_changed'])('propagates %s without bypassing the checked file read',async reason=>{
 const getPlaybackUrl=vi.fn();const directory={getFileHandle:async()=>({getFile:async()=>{throw Error(reason)},getPlaybackUrl})} as unknown as FileSystemDirectoryHandle;
 await expect(readAudioUrl(directory,'synthetic.m4a')).rejects.toThrow(reason);expect(getPlaybackUrl).not.toHaveBeenCalled();
});
it('persists a byte fingerprint rather than the native playback URL in a new manuscript',async()=>{
 const {syntheticDirectory}=await import('../testUtils/syntheticDirectory');
 const {createModel}=await import('../localStore');
 const fs=syntheticDirectory(),file=new File(['Synthetic immutable audio'],'synthetic.m4a');fs.files.set(file.name,file);
 const original=fs.handle.getFileHandle.bind(fs.handle),getPlaybackUrl=vi.fn(async()=> 'asset://localhost/synthetic.m4a');
 fs.handle.getFileHandle=async(name,options)=>{const handle=await original(name,options);return name===file.name?Object.assign(handle,{getPlaybackUrl}):handle};
 const result=await createModel(fs.handle,file.name,{engine:'synthetic',transcript:{audio:{filename:file.name,duration:2},speakers:[],segments:[]}});
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))).map(n=>n.toString(16).padStart(2,'0')).join('');
 expect(result.manifest.audioFingerprint).toBe(`${file.size}:${digest}`);expect(getPlaybackUrl).not.toHaveBeenCalled();
});
