// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UpdateSettings } from './UpdateSettings';
import { cancelDesktopUpdatePreparation, registerDesktopUpdateGuard, type DesktopUpdateInfo } from '../lib/desktopUpdates';
import { setInterfaceLanguage } from '../i18n';

const initial: DesktopUpdateInfo = { currentVersion:'0.2.0-beta.1',build:'75',phase:'idle',availableVersion:null,notes:null,downloaded:0,total:null,error:null,result:null };
let state: DesktopUpdateInfo;
const invoke=vi.fn(async(command:string):Promise<unknown>=>{
  if(command==='update_check') state={...state,phase:'available',availableVersion:'0.2.0',notes:'Synthetic release notes <script>not HTML</script>'};
  if(command==='update_download')state={...state,phase:'ready',downloaded:1024};
  if(command==='update_cancel')state={...state,phase:'available'};
  return {...state};
});
let dispose:()=>void;
beforeEach(async()=>{
  state={...initial};invoke.mockClear();
  Object.assign(window,{__TAURI__:{core:{invoke}}});
  await setInterfaceLanguage('zh-CN');
  dispose=registerDesktopUpdateGuard(async()=>{});
});
afterEach(()=>{cleanup();dispose();cancelDesktopUpdatePreparation();vi.restoreAllMocks();delete (window as unknown as {__TAURI__?:unknown}).__TAURI__;});
async function ready(){
  render(<UpdateSettings onCriticalChange={vi.fn()}/>);
  await screen.findByText('当前版本 0.2.0-beta.1 · b75');
  fireEvent.click(screen.getByRole('button',{name:'检查更新'}));
  fireEvent.click(await screen.findByRole('button',{name:'下载更新'}));
  expect(screen.getByText('Synthetic release notes <script>not HTML</script>').querySelector('script')).toBeNull();
  fireEvent.click(await screen.findByRole('button',{name:'准备安装'}));
}
it('requires separate check, download, preparation and installation decisions',async()=>{
  const guard=vi.fn(async()=>{});const remove=registerDesktopUpdateGuard(guard);
  await ready();
  expect(invoke.mock.calls.filter(([name])=>name==='update_install')).toHaveLength(0);
  expect(document.activeElement).toBe(screen.getByRole('button',{name:'稍后再说'}));
  fireEvent.click(screen.getByRole('button',{name:'退出并安装'}));
  await waitFor(()=>expect(invoke).toHaveBeenCalledWith('update_install'));
  expect(guard).toHaveBeenCalledOnce();remove();
});
it('a failed save prevents native installation and allows retry without quitting',async()=>{
  const remove=registerDesktopUpdateGuard(async()=>{throw Error('update_unsaved_project');});
  await ready();fireEvent.click(screen.getByRole('button',{name:'退出并安装'}));
  await screen.findByRole('alert');
  expect(screen.getByRole('alert').textContent).toContain('尚未退出应用');
  expect(invoke.mock.calls.some(([name])=>name==='update_install')).toBe(false);
  expect(await screen.findByRole('button',{name:'准备安装'})).toBeTruthy();remove();
});
it('Escape cancels only the inline installation confirmation and restores focus',async()=>{
  await ready();
  fireEvent.keyDown(screen.getByRole('button',{name:'稍后再说'}),{key:'Escape'});
  await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole('button',{name:'准备安装'})));
  fireEvent.click(screen.getByRole('button',{name:'取消更新'}));
  await screen.findByRole('button',{name:'下载更新'});
  expect(invoke.mock.calls.some(([name])=>name==='update_install')).toBe(false);
});
it('does not let a late initial status overwrite a user check',async()=>{
  let finish!:(value:DesktopUpdateInfo)=>void;
  invoke.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  render(<UpdateSettings onCriticalChange={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button',{name:'检查更新'}));
  await screen.findByText('可更新到 0.2.0');
  finish(initial);
  await waitFor(()=>expect(screen.getByText('可更新到 0.2.0')).toBeTruthy());
});
it('shows the English flow, unavailable state and a manual release fallback',async()=>{
  await setInterfaceLanguage('en');
  invoke.mockImplementationOnce(async()=>({...initial,phase:'unavailable'}));
  render(<UpdateSettings onCriticalChange={vi.fn()}/>);
  await screen.findByText('No installable update is available yet. You can view the official releases.');
  fireEvent.click(screen.getByRole('button',{name:'Official releases'}));
  await waitFor(()=>expect(invoke).toHaveBeenCalledWith('update_open_releases'));
  expect(invoke.mock.calls.some(([name])=>name==='update_download'||name==='update_install')).toBe(false);
});
it('refreshes native state after install failure so the user can download again',async()=>{
  await ready();
  invoke.mockImplementationOnce(async(command)=>{
    expect(command).toBe('update_install');state={...state,phase:'error',error:'update_in_use'};throw 'update_in_use';
  });
  fireEvent.click(screen.getByRole('button',{name:'退出并安装'}));
  await screen.findByRole('alert');
  expect(screen.getByRole('alert').textContent).toContain('Ripple 连接器');
  expect(screen.getByRole('button',{name:'下载更新'})).toBeTruthy();
});
