// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {StrictMode} from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {UpdateWindow} from './UpdateWindow';
import {setInterfaceLanguage} from '../i18n';
const initial={currentVersion:'0.2.0-beta.1',build:'78',phase:'idle',availableVersion:null,notes:null,downloaded:0,total:null,error:null,result:null};
const invoke=vi.fn(async(command:string):Promise<unknown>=>command==='update_check'?{...initial,phase:'unavailable'}:{...initial});
beforeEach(async()=>{await setInterfaceLanguage('zh-CN');invoke.mockClear();Object.assign(window,{__TAURI__:{core:{invoke}}});});
afterEach(()=>{cleanup();delete (window as unknown as {__TAURI__?:unknown}).__TAURI__;});
it('starts one check on first open even under StrictMode and Escape closes only this window',async()=>{
  render(<StrictMode><UpdateWindow/></StrictMode>);
  await screen.findByText('暂未提供可安装的更新。可查看官方发布页。');
  expect(invoke.mock.calls.filter(([name])=>name==='update_check')).toHaveLength(1);
  expect(document.activeElement).toBe(screen.getByRole('button',{name:'关闭'}));
  fireEvent.keyDown(document.activeElement!,{key:'Escape'});
  await waitFor(()=>expect(invoke).toHaveBeenCalledWith('update_close'));
});
it('reopens a downloaded state without starting installation and Escape closes the window',async()=>{
  await setInterfaceLanguage('en');invoke.mockResolvedValueOnce({...initial,phase:'ready',availableVersion:'0.2.0'});
  render(<UpdateWindow/>);await screen.findByRole('button',{name:'Update and restart…'});
  expect(document.activeElement).toBe(screen.getByRole('button',{name:'Close'}));
  fireEvent.keyDown(screen.getByRole('button',{name:'Close'}),{key:'Escape'});
  await waitFor(()=>expect(invoke).toHaveBeenCalledWith('update_close'));
  expect(invoke.mock.calls.some(([name])=>['update_check','update_download','update_install'].includes(name))).toBe(false);
});

it('keeps the separate update window in Taiwan Chinese when the main-window language changes',async()=>{
 let languageChanged:((event:{payload:string})=>void)|undefined;
 Object.assign(window,{__TAURI__:{core:{invoke},event:{listen:vi.fn(async(_name:string,handler:(event:{payload:string})=>void)=>{languageChanged=handler;return ()=>{};})}}});
 render(<UpdateWindow/>);await screen.findByText('暂未提供可安装的更新。可查看官方发布页。');
 await act(async()=>languageChanged?.({payload:'zh-TW'}));
 expect(screen.getByRole('heading',{name:'軟體更新'})).toBeTruthy();
 expect(screen.getByRole('button',{name:'關閉'})).toBeTruthy();
 expect(screen.getByRole('button',{name:'檢查更新'})).toBeTruthy();
 fireEvent.keyDown(screen.getByRole('button',{name:'關閉'}),{key:'Escape'});
 await waitFor(()=>expect(invoke).toHaveBeenCalledWith('update_close'));
});
