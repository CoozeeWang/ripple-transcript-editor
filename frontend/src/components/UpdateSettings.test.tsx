// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UpdateSettings } from './UpdateSettings';
import { cancelDesktopUpdatePreparation, registerDesktopUpdateGuard, type DesktopUpdateInfo } from '../lib/desktopUpdates';
import { setInterfaceLanguage } from '../i18n';

const initial: DesktopUpdateInfo = { currentVersion:'0.2.0-beta.1',build:'80',phase:'idle',availableVersion:null,notes:null,downloaded:0,total:null,error:null,result:null };
const candidate: DesktopUpdateInfo={...initial,phase:'available',availableVersion:'0.2.0',notes:'Synthetic notes <script>not HTML</script>'};
let state: DesktopUpdateInfo;
const invoke=vi.fn<(command:string)=>Promise<unknown>>();
let dispose:()=>void;
const label=(language:string)=>language==='en'?'Update and restart…':'更新并重启…';
beforeEach(async()=>{
  state={...initial};invoke.mockReset();
  invoke.mockImplementation(async(command)=>{
    if(command==='update_check')state={...candidate};
    if(command==='update_download')state={...state,phase:'ready',downloaded:1024};
    if(command==='update_cancel')state={...state,phase:'available'};
    return {...state};
  });
  Object.assign(window,{__TAURI__:{core:{invoke}}});
  await setInterfaceLanguage('zh-CN');
  dispose=registerDesktopUpdateGuard(async()=>{});
});
afterEach(()=>{cleanup();dispose();cancelDesktopUpdatePreparation();vi.restoreAllMocks();delete (window as unknown as {__TAURI__?:unknown}).__TAURI__;});
async function show(language='zh-CN',props:Partial<Parameters<typeof UpdateSettings>[0]>={}){
  await setInterfaceLanguage(language==='en'?'en':'zh-CN');
  const rendered=render(<UpdateSettings onCriticalChange={vi.fn()} {...props}/>);
  await screen.findByText(language==='en'?'Current version 0.2.0-beta.1 · b80':'当前版本 0.2.0-beta.1 · b80');
  return rendered;
}
it.each(['zh-CN','en'])('one click downloads, verifies, saves and installs once in %s',async language=>{
  state={...candidate};
  const guard=vi.fn(async()=>{});const remove=registerDesktopUpdateGuard(guard);
  try{
    await show(language);
    expect(screen.getByText('Synthetic notes <script>not HTML</script>').querySelector('script')).toBeNull();
    expect(screen.getByText(language==='en'?'This will download and verify the update, save your work, then install and reopen Ripple. Your projects and settings will be kept.':'点击后将下载并校验更新，保存当前内容，再安装并重新打开 Ripple。项目和设置会保留。')).toBeTruthy();
    const update=screen.getByRole('button',{name:label(language)});
    fireEvent.click(update);fireEvent.click(update);
    await waitFor(()=>expect(invoke).toHaveBeenCalledWith('update_install'));
    expect(invoke.mock.calls.filter(([name])=>name==='update_download')).toHaveLength(1);
    expect(invoke.mock.calls.filter(([name])=>name==='update_install')).toHaveLength(1);
    expect(guard).toHaveBeenCalledOnce();
    expect(screen.queryByRole('group')).toBeNull();
  }finally{remove();}
});
it.each(['zh-CN','en'])('reuses a verified download only after an explicit click in %s',async language=>{
  state={...candidate,phase:'ready'};await show(language);
  expect(invoke.mock.calls.some(([name])=>['update_download','update_install'].includes(name))).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:label(language)}));
  await waitFor(()=>expect(invoke).toHaveBeenCalledWith('update_install'));
  expect(invoke.mock.calls.some(([name])=>name==='update_download')).toBe(false);
});
it.each(['zh-CN','en'])('save failure or timeout leaves Ripple open with a focused retry in %s',async language=>{
  for(const code of ['update_unsaved_project','update_prepare_timeout']){
    state={...candidate,phase:'ready'};
    const remove=registerDesktopUpdateGuard(async()=>{throw Error(code);});
    try{
      const rendered=await show(language);
      fireEvent.click(screen.getByRole('button',{name:label(language)}));
      const alert=await screen.findByRole('alert');
      expect(alert.textContent).toContain(language==='en'?(code==='update_prepare_timeout'?'still open':'has not quit'):'尚未退出应用');
      if(code==='update_prepare_timeout')expect(alert.textContent).toContain(language==='en'?'timed out':'超时');
      expect(invoke.mock.calls.some(([name])=>name==='update_install')).toBe(false);
      await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole('button',{name:label(language)})));
      expect(screen.getByRole('button',{name:label(language)}).hasAttribute('disabled')).toBe(false);
      rendered.unmount();
    }finally{remove();}
  }
});
it.each(['zh-CN','en'])('announces preparation then installation and restores retry after failure in %s',async language=>{
  state={...candidate,phase:'ready'};
  let prepared!:()=>void,failInstall!:(reason:Error)=>void;
  const remove=registerDesktopUpdateGuard(()=>new Promise<void>(resolve=>{prepared=resolve;}));
  try{
    await show(language,{onClose:vi.fn()});fireEvent.click(screen.getByRole('button',{name:label(language)}));
    const status=await screen.findByText(language==='en'?'Saving your work and checking whether the update can be installed…':'正在保存并检查是否可以安装更新…');
    expect(document.activeElement).toBe(status);
    expect(screen.getByRole('button',{name:language==='en'?'Close':'关闭'}).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByText('Synthetic notes <script>not HTML</script>')).toBeNull();
    expect(invoke.mock.calls.some(([name])=>name==='update_install')).toBe(false);
    invoke.mockImplementationOnce(command=>{expect(command).toBe('update_install');return new Promise((_resolve,reject)=>{failInstall=reject;});});
    await act(async()=>prepared());
    await screen.findByText(language==='en'?'Quitting and installing the update. Ripple will reopen when installation finishes…':'正在退出并安装更新，完成后将重新打开 Ripple…');
    await act(async()=>failInstall(Error('update_install_failed')));
    await screen.findByRole('alert');
    await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole('button',{name:label(language)})));
  }finally{remove();}
});
it.each(['zh-CN','en'])('failed or cancelled download never saves or installs in %s',async language=>{
  for(const phase of ['error','available'] as const){
    state={...candidate};const guard=vi.fn(async()=>{});const remove=registerDesktopUpdateGuard(guard);
    try{
      const rendered=await show(language);
      invoke.mockImplementationOnce(async()=>state={...candidate,phase,error:phase==='error'?'update_download_failed':null});
      fireEvent.click(screen.getByRole('button',{name:label(language)}));
      await waitFor(()=>expect(screen.getByRole('button',{name:label(language)}).hasAttribute('disabled')).toBe(false));
      expect(guard).not.toHaveBeenCalled();expect(invoke.mock.calls.some(([name])=>name==='update_install')).toBe(false);
      rendered.unmount();
    }finally{remove();}
  }
});
it.each(['cancel','close','unmount'])('%s revokes automatic installation even if download finishes successfully',async operation=>{
  state={...candidate};let finish!:(value:DesktopUpdateInfo)=>void;
  const onClose=vi.fn();const rendered=await show('zh-CN',{onClose});
  invoke.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  fireEvent.click(screen.getByRole('button',{name:'更新并重启…'}));
  if(operation==='cancel')fireEvent.click(await screen.findByRole('button',{name:'取消更新'}));
  else if(operation==='close')fireEvent.click(screen.getByRole('button',{name:'关闭'}));
  else rendered.unmount();
  await act(async()=>finish({...candidate,phase:'ready'}));
  expect(invoke.mock.calls.some(([name])=>name==='update_install')).toBe(false);
  if(operation==='close')expect(onClose).toHaveBeenCalledOnce();
});
it('does not let a late initial status overwrite a user check',async()=>{
  let finish!:(value:DesktopUpdateInfo)=>void;
  invoke.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  render(<UpdateSettings onCriticalChange={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'检查更新'}));
  await screen.findByText('可更新到 0.2.0');
  await act(async()=>finish(initial));expect(screen.getByText('可更新到 0.2.0')).toBeTruthy();
});
it.each(['zh-CN','en'])('rejected packages require a fresh check in %s',async language=>{
  state={...candidate,phase:'error',error:'update_invalid_package'};await show(language);
  const check=screen.getByRole('button',{name:language==='en'?'Check for updates':'检查更新'});
  expect(screen.queryByRole('button',{name:label(language)})).toBeNull();
  fireEvent.click(check);await screen.findByRole('button',{name:label(language)});
  expect(invoke.mock.calls.some(([name])=>name==='update_download')).toBe(false);
});
it.each(['zh-CN','en'])('rollback failure gives distinct recovery instructions and an official download action in %s',async language=>{
  state={...initial,result:{status:'recovery_required',version:'0.2.0'}};await show(language);
  const alert=screen.getByRole('alert');
  expect(alert.textContent).toContain(language==='en'?'could not be restored automatically':'自动恢复上一版也失败');
  expect(alert.textContent).toContain(language==='en'?'retained installer':'保留的上一版安装包');
  expect(alert.textContent).toContain(language==='en'?'no need to delete':'无需删除');
  fireEvent.click(screen.getByRole('button',{name:language==='en'?'Official releases':'官方发布页'}));
  await waitFor(()=>expect(invoke).toHaveBeenCalledWith('update_open_releases'));
  expect(invoke.mock.calls.some(([name])=>name==='update_install')).toBe(false);
});
it.each(['zh-CN','en'])('successful rollback gives retry and manual download guidance in %s',async language=>{
  state={...initial,result:{status:'rolled_back',version:'0.2.0'}};await show(language);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText(language==='en'?'The update did not finish. The previous app was restored. Choose “Check for updates” to try again, or download an installer from “Official releases” below.':'更新未完成，已恢复上一版。可点击「检查更新」重试，或从下方「官方发布页」下载安装包。')).toBeTruthy();
});
it('keeps a recovery action if installation and status refresh both fail',async()=>{
  state={...candidate,phase:'ready'};await show();
  invoke.mockRejectedValueOnce(Error('update_install_failed')).mockRejectedValueOnce(Error('synthetic_status_unavailable'));
  fireEvent.click(screen.getByRole('button',{name:'更新并重启…'}));await screen.findByRole('alert');
  await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole('button',{name:'更新并重启…'})));
});
it('keeps timeout feedback in sync when the interface language changes',async()=>{
  state={...candidate,phase:'ready'};
  const remove=registerDesktopUpdateGuard(async()=>{throw Error('update_prepare_timeout');});
  try{
    await show();fireEvent.click(screen.getByRole('button',{name:'更新并重启…'}));
    expect((await screen.findByRole('alert')).textContent).toContain('准备更新超时');
    await act(async()=>setInterfaceLanguage('en'));
    expect(screen.getByRole('alert').textContent).toContain('Update preparation timed out');
    expect(screen.getByRole('alert').textContent).not.toContain('准备更新超时');
  }finally{remove();}
});
