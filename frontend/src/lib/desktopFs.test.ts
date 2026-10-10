// @vitest-environment jsdom
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
