// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UpdateSettings } from './UpdateSettings';
import { setInterfaceLanguage } from '../i18n';
import type { DesktopUpdateInfo } from '../lib/desktopUpdates';

const initial: DesktopUpdateInfo = {currentVersion:'0.2.0-beta.1',build:'80',phase:'idle',availableVersion:null,notes:null,error:null,releaseUrl:null};
const candidate: DesktopUpdateInfo = {...initial,phase:'available',availableVersion:'0.2.0',
  notes:'Synthetic notes <script>not HTML</script>',
  releaseUrl:'https://github.com/CoozeeWang/ripple-transcript-editor/releases/tag/v0.2.0'};
let state: DesktopUpdateInfo;
const invoke=vi.fn<(command:string)=>Promise<unknown>>();
beforeEach(async()=>{
  state={...initial};invoke.mockReset();
  invoke.mockImplementation(async command=>{
    if(command==='update_check')state={...candidate};
    return command==='update_open_releases'?undefined:{...state};
  });
  Object.assign(window,{__TAURI__:{core:{invoke}}});
  await setInterfaceLanguage('zh-CN');
});
afterEach(()=>{cleanup();delete (window as unknown as {__TAURI__?:unknown}).__TAURI__;});
async function show(language:'zh-CN'|'zh-TW'|'en', initialState:DesktopUpdateInfo) {
  state={...initialState};
  await setInterfaceLanguage(language);
  render(<UpdateSettings onClose={vi.fn()}/>);
  await screen.findByText(initialState.build ? new RegExp('0.2.0-beta.1') : /0.2.0-beta.1/);
}
it.each([['zh-CN','前往此版本官方发布页'],['zh-TW','前往此版本官方發布頁'],['en','Open this version’s official release']] as const)(
  'shows notes and opens only the fixed native release command in %s',async(language,label)=>{
    await show(language,candidate);
    const notes=screen.getByText('Synthetic notes <script>not HTML</script>');
    expect(notes.querySelector('script')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:label}));
    await waitFor(()=>expect(invoke).toHaveBeenCalledWith('update_open_releases'));
    expect(invoke.mock.calls.some(([name])=>['update_download','update_install','update_prepare'].includes(name))).toBe(false);
  });
it('distinguishes check failure from current and permits retry',async()=>{
  await show('en',{...initial,phase:'error',error:'update_check_failed'});
  expect(screen.getByRole('alert').textContent).toContain('did not finish');
  fireEvent.click(screen.getByRole('button',{name:'Check for updates'}));
  await waitFor(()=>expect(screen.getByText('Update available: 0.2.0')).toBeTruthy());
  expect(screen.queryByRole('alert')).toBeNull();
});
it('shows platform unavailable and offers official releases',async()=>{
  await show('en',{...initial,phase:'unavailable'});
  expect(screen.getByText(/no manual installer is available/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Official releases'}));
  await waitFor(()=>expect(invoke).toHaveBeenCalledWith('update_open_releases'));
});
it('does not claim the installed build is current when no releases are published',async()=>{
  await show('en',{...initial,phase:'no_releases'});
  expect(screen.getByText(/no published releases yet/)).toBeTruthy();
  expect(screen.queryByText(/latest available version/)).toBeNull();
});
