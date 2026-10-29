// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {hasNativeSegmentDrag,startNativeSegmentDrag} from './segmentDragBridge';
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it('uses native sessions only on a Mac desktop bridge',()=>{
 vi.spyOn(navigator,'platform','get').mockReturnValue('MacIntel');
 expect(hasNativeSegmentDrag()).toBe(false);
 vi.stubGlobal('__TAURI__',{core:{invoke:vi.fn()}});expect(hasNativeSegmentDrag()).toBe(true);
 vi.spyOn(navigator,'platform','get').mockReturnValue('Win32');expect(hasNativeSegmentDrag()).toBe(false);
});
it('passes an eager snapshot and waits until native completion including cancel',async()=>{
 let finish!:(value:boolean)=>void;
 const invoke=vi.fn(()=>new Promise<boolean>(resolve=>{finish=resolve;}));vi.stubGlobal('__TAURI__',{core:{invoke}});
 const payload={plain:'Synthetic',html:'<p>Synthetic</p>',rtf:'{\\rtf1 Synthetic}'};
 const result=startNativeSegmentDrag(payload);expect(invoke).toHaveBeenCalledWith('start_segment_drag',{payload});
 finish(false);await expect(result).resolves.toBe(false);
});
