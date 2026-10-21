// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cancelDesktopUpdatePreparation,desktopUpdatePreparing,installDesktopUpdateBridge,prepareDesktopUpdate,registerDesktopUpdateGuard} from './desktopUpdates';
afterEach(()=>{delete (window as unknown as {__TAURI__?:unknown}).__TAURI__;delete (window as unknown as {__RIPPLE_UPDATE_WINDOW__?:unknown}).__RIPPLE_UPDATE_WINDOW__;cancelDesktopUpdatePreparation();});
function native(){
  const handlers=new Map<string,(event:{payload:number})=>void>();
  const invoke=vi.fn(async()=>{});
  Object.assign(window,{__TAURI__:{core:{invoke},event:{listen:vi.fn(async(name:string,handler:(event:{payload:number})=>void)=>{handlers.set(name,handler);return ()=>handlers.delete(name);})}}});
  return {invoke,send:(name:string,token=0)=>handlers.get(name)!({payload:token})};
}
it('asks the native bridge from the updater instead of pretending it owns editor guards',async()=>{
  const {invoke}=native();Object.assign(window,{__RIPPLE_UPDATE_WINDOW__:{language:'en'}});
  await prepareDesktopUpdate();expect(invoke).toHaveBeenCalledWith('update_prepare');
});
it('main acknowledges only after saving, retains the edit gate, then releases it',async()=>{
  const {invoke,send}=native();let finish!:()=>void;
  const remove=registerDesktopUpdateGuard(()=>new Promise(resolve=>{finish=resolve;}));
  const stop=await installDesktopUpdateBridge();send('desktop-update-prepare',3);
  expect(invoke).not.toHaveBeenCalled();expect(desktopUpdatePreparing()).toBe(true);
  finish();await vi.waitFor(()=>expect(invoke).toHaveBeenCalledWith('update_prepared',{token:3,error:null}));
  expect(desktopUpdatePreparing()).toBe(true);send('desktop-update-release');expect(desktopUpdatePreparing()).toBe(false);
  stop();remove();
});
it('propagates save failures without allowing installation',async()=>{
  const {invoke,send}=native();const remove=registerDesktopUpdateGuard(async()=>{throw Error('update_unsaved_project');});
  const stop=await installDesktopUpdateBridge();send('desktop-update-prepare',4);
  await vi.waitFor(()=>expect(invoke).toHaveBeenCalledWith('update_prepared',{token:4,error:'update_unsaved_project'}));
  expect(desktopUpdatePreparing()).toBe(false);stop();remove();
});
it('discards a late save after native timeout and rejects overlapping preparation',async()=>{
  const {invoke,send}=native();let finish!:()=>void;
  const remove=registerDesktopUpdateGuard(()=>new Promise(resolve=>{finish=resolve;}));
  const stop=await installDesktopUpdateBridge();send('desktop-update-prepare',5);send('desktop-update-release');send('desktop-update-prepare',6);
  await vi.waitFor(()=>expect(invoke).toHaveBeenCalledWith('update_prepared',{token:6,error:'update_work_in_progress'}));
  finish();await vi.waitFor(()=>expect(desktopUpdatePreparing()).toBe(false));
  expect(invoke.mock.calls.some(args=>(args as unknown[])[1]&&((args as unknown[])[1] as {token:number}).token===5)).toBe(false);
  stop();remove();
});
