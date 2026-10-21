// @vitest-environment jsdom
import { setInterfaceLanguage } from '../i18n';
import { afterEach, expect, it, vi } from 'vitest';
import { installDesktopFilePickers, NativeFileHandle, decodeNativeHandles, encodeNativeHandles } from './desktopFs';
const invoke = vi.fn();
afterEach(() => { delete (window as Window & {__TAURI__?:unknown}).__TAURI__; vi.resetAllMocks(); });
function bridge() { Object.assign(window,{__TAURI__:{core:{invoke}}}); installDesktopFilePickers(); }
it('uses native restored permissions rather than trusting a persisted browser descriptor', async () => {
 bridge(); const handle=decodeNativeHandles({__rippleNativeHandle:true,root:'/synthetic/audio.wav',parts:[],kind:'file'}) as unknown as NativeFileHandle;
 invoke.mockResolvedValueOnce(true); expect(await handle.queryPermission()).toBe('granted');
 expect(invoke).toHaveBeenLastCalledWith('fs_permission',{root:'/synthetic/audio.wav',parts:[],write:false});
 invoke.mockResolvedValueOnce(false); expect(await handle.queryPermission({mode:'readwrite'})).toBe('prompt');
 expect(encodeNativeHandles(handle)).toEqual({__rippleNativeHandle:true,root:'/synthetic/audio.wav',parts:[],kind:'file'});
});
it.each([['permission_required','NotAllowedError'],['file_missing','NotFoundError']])('preserves actionable native read failure %s', async (code,name) => {
 bridge(); invoke.mockRejectedValueOnce(code);
 await expect(new NativeFileHandle('/synthetic/audio.wav',[]).getFile()).rejects.toMatchObject({name});
});
it('cancelled permission recovery stays denied without reading the file', async () => {
 bridge(); invoke.mockResolvedValueOnce(false).mockRejectedValueOnce('selection_cancelled');
 expect(await new NativeFileHandle('/synthetic/audio.wav',[]).requestPermission()).toBe('denied');
 expect(invoke.mock.calls.map(call=>call[0])).toEqual(['fs_permission','fs_reauthorize']);
});

it('decorates only native project handles and keeps decoration failure non-blocking', async () => {
 const {decorateNativeProject,NativeDirectoryHandle}=await import('./desktopFs'); bridge();
 const browser={name:'browser.ripple'} as FileSystemDirectoryHandle;
 expect(await decorateNativeProject(browser)).toBe(true); expect(invoke).not.toHaveBeenCalled();
 const directory=new NativeDirectoryHandle('/synthetic',['demo.ripple']) as unknown as FileSystemDirectoryHandle;
 invoke.mockResolvedValueOnce(true); expect(await decorateNativeProject(directory)).toBe(true);
 expect(invoke).toHaveBeenLastCalledWith('project_set_icon',{root:'/synthetic',parts:['demo.ripple']});
 invoke.mockRejectedValueOnce('project_icon_failed'); expect(await decorateNativeProject(directory)).toBe(false);
});

it('saves through the native picker and commits the selected file, including a new name', async () => {
 const {saveNativeBlob}=await import('./desktopFs'); bridge();
 invoke.mockImplementation(async command => command==='pick_save_file'?{root:'/synthetic/exports',name:'reading.txt'}:command==='fs_begin_write'?7:undefined);
 await saveNativeBlob(new Blob(['synthetic']), 'reading.txt');
 expect(invoke.mock.calls.map(call=>call[0])).toEqual(['pick_save_file','fs_begin_write','fs_write_chunk','fs_commit_write']);
 expect(invoke).toHaveBeenCalledWith('fs_begin_write',{root:'/synthetic/exports',parts:['reading.txt']});
});
it('cancelled save does not write or report a completed export', async () => {
 const {saveNativeBlob}=await import('./desktopFs'); bridge(); invoke.mockRejectedValueOnce('selection_cancelled');
 await expect(saveNativeBlob(new Blob(['synthetic']),'reading.txt')).rejects.toMatchObject({name:'AbortError'});
 expect(invoke.mock.calls.map(call=>call[0])).toEqual(['pick_save_file']);
});
it('failed native write aborts without committing', async () => {
 const {saveNativeBlob}=await import('./desktopFs'); bridge();
 invoke.mockImplementation(async command => {if(command==='pick_save_file')return {root:'/synthetic',name:'reading.txt'};if(command==='fs_begin_write')return 7;if(command==='fs_write_chunk')throw new Error('disk full');});
 await expect(saveNativeBlob(new Blob(['synthetic']),'reading.txt')).rejects.toThrow('disk full');
 expect(invoke.mock.calls.map(call=>call[0])).toContain('fs_abort_write');
 expect(invoke.mock.calls.map(call=>call[0])).not.toContain('fs_commit_write');
});

function fileBytes(file: Blob): Promise<Uint8Array> {
 return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(new Uint8Array(reader.result as ArrayBuffer));reader.onerror=()=>reject(reader.error);reader.readAsArrayBuffer(file);});
}
it('reads bounded binary chunks without changing UTF-8, non-text bytes or chunk offsets', async () => {
 bridge(); const bytes=new Uint8Array(1024*1024+31); for(let i=0;i<bytes.length;i++)bytes[i]=i%256;
 invoke.mockImplementation(async (command,args)=>command==='fs_size'?bytes.length:bytes.slice(args.offset,args.offset+args.length).buffer);
 const file=await new NativeFileHandle('/synthetic/large.json',[]).getFile();
 const actual=await fileBytes(file); expect(actual.length).toBe(bytes.length); expect(actual.every((value,index)=>value===bytes[index])).toBe(true);
 expect(invoke.mock.calls.filter(c=>c[0]==='fs_read_chunk').map(c=>[c[1].offset,c[1].length])).toEqual([[0,1024*1024],[1024*1024,31]]);
});
it.each([['zh-CN','文件在读取期间发生变化。请重新打开后重试。'],['en','File changed while reading. Reopen it and try again.']] as const)('rejects a shortened read with actionable %s feedback', async (language,message) => {
 await setInterfaceLanguage(language);
 bridge(); invoke.mockResolvedValueOnce(8).mockResolvedValueOnce(new Uint8Array([1,2]).buffer);
 try { await expect(new NativeFileHandle('/synthetic/edit.json',[]).getFile()).rejects.toThrow(message); }
 finally { await setInterfaceLanguage('zh-CN'); }
});
it('reads empty files and supports the Tauri number-array platform fallback', async () => {
 bridge(); invoke.mockResolvedValueOnce(0); expect((await new NativeFileHandle('/synthetic/empty',[]).getFile()).size).toBe(0);
 invoke.mockResolvedValueOnce(3).mockResolvedValueOnce([0,128,255]);
 expect(await fileBytes(await new NativeFileHandle('/synthetic/fallback',[]).getFile())).toEqual(new Uint8Array([0,128,255]));
});
it('sends raw byte bodies with session headers, preserving typed-array slices and Unicode', async () => {
 bridge(); invoke.mockImplementation(async command=>command==='fs_begin_write'?19:undefined);
 const stream=await new NativeFileHandle('/synthetic/edit.json',[]).createWritable();
 const bytes=new Uint8Array(1024*1024+67); for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
 await stream.write(bytes.subarray(3,bytes.length-5)); await stream.write('合成稿🙂'); await stream.close();
 const calls=invoke.mock.calls.filter(c=>c[0]==='fs_write_chunk'); expect(calls.length).toBe(2);
 const actual=new Uint8Array(calls.reduce((n,c)=>n+c[1].length,0)); let offset=0;
 for(const call of calls){expect(call[1]).toBeInstanceOf(Uint8Array);expect(call[1].length).toBeLessThanOrEqual(1024*1024);expect(call[2]).toEqual({headers:{'x-ripple-write-id':'19'}});actual.set(call[1],offset);offset+=call[1].length;}
 const expected=new Uint8Array(bytes.length-8+new TextEncoder().encode('合成稿🙂').length); expected.set(bytes.subarray(3,bytes.length-5));expected.set(new TextEncoder().encode('合成稿🙂'),bytes.length-8);
 expect(actual.length).toBe(expected.length);expect(actual.every((value,index)=>value===expected[index])).toBe(true);expect(invoke.mock.calls.at(-1)).toEqual(['fs_commit_write',{id:19}]);
});
it('aborts a failed commit without claiming a successful write', async () => {
 const {saveNativeBlob}=await import('./desktopFs'); bridge();
 invoke.mockImplementation(async command=>{if(command==='pick_save_file')return {root:'/synthetic',name:'edit.json'};if(command==='fs_begin_write')return 22;if(command==='fs_commit_write')throw new Error('Synthetic commit failed');});
 await expect(saveNativeBlob(new Blob(['synthetic']),'edit.json')).rejects.toThrow('Synthetic commit failed');
 expect(invoke).toHaveBeenCalledWith('fs_abort_write',{id:22});
});
