// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { ConnectorSetup } from './ConnectorSetup';
import { setInterfaceLanguage } from '../i18n';
vi.mock('../lib/desktopFs', () => ({ nativeDesktopAvailable: () => true }));
vi.mock('../lib/tunnelClientRelease', async original => ({...await original<typeof import('../lib/tunnelClientRelease')>(), latestTunnelRelease:vi.fn(async()=>({tag_name:'v0.0.99',draft:false,prerelease:false,assets:[]}))}));
beforeEach(()=>{HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};});
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await setInterfaceLanguage('zh-CN'); });
function fixture(client = 'claude', configured = {chatgpt:true,claude:true,workbuddy:true}, enabled = true) {
 const invoke=vi.fn(async(command:string):Promise<unknown>=>command==='connector_client_status'?{client,configured}:command==='connector_client_add'?client:command==='connector_setup_status'?{client_path:'',tunnel_id:'',has_key:false,configured:false}:command==='connector_client_platform'?{os:'macos',arch:'aarch64'}:false);
 (window as unknown as {__TAURI__: unknown}).__TAURI__={core:{invoke}};
 const onSaved=vi.fn();
 const ui=render(<ConnectorSetup onSaved={onSaved} enabled={enabled}/>);
 return {ui,invoke,onSaved};
}
it.each(['chatgpt','claude','workbuddy'])('disables the entire %s configuration while MCP is off and restores it on enable',async client=>{
 const {ui,invoke}=fixture(client,undefined,false);
 await waitFor(()=>expect((ui.getByRole('combobox') as HTMLSelectElement).value).toBe(client));
 const controls=ui.container.querySelector('fieldset')!;
 expect(controls.disabled).toBe(true);
 expect(controls.querySelector('[inert]')).toBeTruthy();
 for(const element of controls.querySelectorAll('button, input, select')) expect(element.matches(':disabled')).toBe(true);
 expect(invoke.mock.calls.some(([name])=>['connector_client_add','connector_setup','connector_client_delete','connector_client_export'].includes(name))).toBe(false);
 ui.rerender(<ConnectorSetup enabled/>);
 expect(controls.disabled).toBe(false);
 expect(controls.querySelector('[inert]')).toBeNull();
 expect(ui.getByRole('combobox').matches(':disabled')).toBe(false);
});
it('opens the selected client installer without claiming AI connection',async()=>{
 const {ui,invoke}=fixture();
 await waitFor(()=>expect((ui.getByRole('combobox') as HTMLSelectElement).value).toBe('claude'));
 fireEvent.click(ui.getByText('添加到 Claude'));
 await waitFor(()=>expect(ui.getByRole('status').textContent).toContain('请在 Claude 中确认安装'));
 expect(invoke).toHaveBeenCalledWith('connector_client_add',{client:'claude',language:'zh-CN'});
 expect(invoke.mock.calls.flat()).not.toContain('connector_pair_begin');
});

it.each(['chatgpt','claude','workbuddy'])('deletes only the confirmed %s configuration without reconnecting other clients',async client=>{
 const {ui,invoke,onSaved}=fixture(client);
 await waitFor(()=>expect((ui.getByRole('combobox') as HTMLSelectElement).disabled).toBe(false));
 const trigger=ui.getByRole('button',{name:/删除 (ChatGPT|Claude|WorkBuddy) 连接配置/});trigger.focus();fireEvent.click(trigger);
 const dialog=ui.getByRole('dialog');const cancel=within(dialog).getByRole('button',{name:'取消'});
 expect(document.activeElement).toBe(cancel);
 expect(dialog.textContent).toContain('不会卸载');
 fireEvent.click(within(dialog).getByRole('button',{name:'删除配置'}));
 await waitFor(()=>expect(ui.queryByRole('dialog')).toBeNull());
 expect(invoke).toHaveBeenCalledWith('connector_client_delete',{client});
 expect(onSaved).not.toHaveBeenCalled();
 expect(ui.getByText(/本机连接配置已删除/)).toBeTruthy();
 expect(ui.queryByRole('button',{name:/删除 .* 连接配置/})).toBeNull();
 expect(document.activeElement).toBe(ui.getByRole('combobox'));
 expect(within(ui.getByRole('combobox')).getByRole('option',{name:new RegExp((client === 'claude' ? 'Claude' : client === 'chatgpt' ? 'ChatGPT' : 'WorkBuddy')+'.*未配置')})).toBeTruthy();
});

it('cancel and Escape do not delete and restore the opener',async()=>{
 const {ui,invoke}=fixture();await waitFor(()=>expect((ui.getByRole('combobox') as HTMLSelectElement).value).toBe('claude'));
 const trigger=ui.getByRole('button',{name:/删除 (ChatGPT|Claude|WorkBuddy) 连接配置/});fireEvent.click(trigger);
 fireEvent.click(within(ui.getByRole('dialog')).getByRole('button',{name:'取消'}));
 expect(document.activeElement).toBe(trigger);fireEvent.click(trigger);
 fireEvent(ui.getByRole('dialog'),new Event('cancel',{cancelable:true,bubbles:true}));
 expect(ui.queryByRole('dialog')).toBeNull();expect(invoke.mock.calls.some(([c])=>c==='connector_client_delete')).toBe(false);
});

it('keeps failure in the confirmation and permits retry, with no success claim',async()=>{
 const {ui,invoke}=fixture();await waitFor(()=>expect((ui.getByRole('combobox') as HTMLSelectElement).value).toBe('claude'));
 const original=invoke.getMockImplementation()!;
 let attempt=0;invoke.mockImplementation(async command=>{if(command==='connector_client_delete'&&attempt++===0)throw 'connector_client_busy';return original(command);});
 fireEvent.click(ui.getByRole('button',{name:/删除 (ChatGPT|Claude|WorkBuddy) 连接配置/}));fireEvent.click(within(ui.getByRole('dialog')).getByRole('button',{name:'删除配置'}));
 await waitFor(()=>expect(ui.getByRole('alert').textContent).toContain('还有请求正在处理'));
 expect(document.activeElement).toBe(within(ui.getByRole('dialog')).getByRole('button',{name:'取消'}));
 expect(ui.queryByText(/本机连接配置已删除/)).toBeNull();
 fireEvent.click(within(ui.getByRole('dialog')).getByRole('button',{name:'删除配置'}));
 await waitFor(()=>expect(ui.queryByRole('dialog')).toBeNull());
});

it('locks deletion controls until the native operation finishes',async()=>{
 const {ui,invoke}=fixture();await waitFor(()=>expect((ui.getByRole('combobox') as HTMLSelectElement).value).toBe('claude'));
 let done:()=>void=()=>{};const pending=new Promise<void>(resolve=>{done=resolve;});const original=invoke.getMockImplementation()!;
 invoke.mockImplementation(command=>command==='connector_client_delete'?pending:original(command));
 fireEvent.click(ui.getByRole('button',{name:/删除 (ChatGPT|Claude|WorkBuddy) 连接配置/}));fireEvent.click(within(ui.getByRole('dialog')).getByRole('button',{name:'删除配置'}));
 expect((ui.getByRole('combobox') as HTMLSelectElement).disabled).toBe(true);
 expect((within(ui.getByRole('dialog')).getByRole('button',{name:'取消'}) as HTMLButtonElement).disabled).toBe(true);
 expect((within(ui.getByRole('dialog')).getByRole('button',{name:'正在删除…'}) as HTMLButtonElement).disabled).toBe(true);
 await act(async()=>done());await waitFor(()=>expect(ui.queryByRole('dialog')).toBeNull());
});

it('shows English deletion scope and generic errors without exposing native details',async()=>{
 await setInterfaceLanguage('en');const {ui,invoke}=fixture('workbuddy');await waitFor(()=>expect((ui.getByRole('combobox') as HTMLSelectElement).disabled).toBe(false));
 invoke.mockRejectedValueOnce('synthetic_private_path');fireEvent.click(ui.getByRole('button',{name:'Delete WorkBuddy connection configuration'}));
 expect(ui.getByRole('dialog').textContent).toContain('does not uninstall');
 fireEvent.click(within(ui.getByRole('dialog')).getByRole('button',{name:'Delete configuration'}));
 await waitFor(()=>expect(ui.getByRole('alert').textContent).toContain('Deletion did not complete'));
 expect(ui.queryByText('synthetic_private_path')).toBeNull();
});
it('switches only after saving succeeds, retains separate instructions without a duplicate disconnect control',async()=>{
 const {ui,invoke,onSaved}=fixture();
 await waitFor(()=>expect((ui.getByRole('combobox') as HTMLSelectElement).value).toBe('claude'));
 fireEvent.change(ui.getByRole('combobox'),{target:{value:'workbuddy'}});
 await waitFor(()=>expect(ui.getByText('添加到 WorkBuddy')).toBeTruthy());
 expect(invoke).toHaveBeenCalledWith('connector_client_select',{client:'workbuddy'});
 expect(onSaved).not.toHaveBeenCalled();
 expect(ui.queryByText('断开连接')).toBeNull();
});
it('cancelled installation is not reported as success',async()=>{
 const {ui,invoke}=fixture();
 await waitFor(()=>expect((ui.getByRole('combobox') as HTMLSelectElement).value).toBe('claude'));
 invoke.mockImplementation(async()=>'cancelled' as never);
 fireEvent.click(ui.getByText('添加到 Claude'));
 await waitFor(()=>expect(ui.getByText('添加到 Claude').hasAttribute('disabled')).toBe(false));
 expect(ui.queryByRole('status')).toBeNull();
});
it('failed switching preserves selection',async()=>{
 const {ui,invoke,onSaved}=fixture();
 await waitFor(()=>expect((ui.getByRole('combobox') as HTMLSelectElement).value).toBe('claude'));
 invoke.mockImplementation(async()=>{throw Error('failed');});
 fireEvent.change(ui.getByRole('combobox'),{target:{value:'workbuddy'}});
 await waitFor(()=>expect(ui.getByRole('alert')).toBeTruthy());
 expect((ui.getByRole('combobox') as HTMLSelectElement).value).toBe('claude');
 expect(onSaved).not.toHaveBeenCalled();
});
it('failed WorkBuddy install offers a retry and does not report addition', async () => {
 const {ui,invoke}=fixture('workbuddy');
 await waitFor(()=>expect((ui.getByRole('combobox') as HTMLSelectElement).disabled).toBe(false));
 invoke.mockImplementation(async()=>{throw Error('invalid configuration');});
 fireEvent.click(ui.getByText('添加到 WorkBuddy'));
 await waitFor(()=>expect(ui.getByRole('alert').textContent).toContain('无法将 Ripple 添加到 WorkBuddy'));
 expect(ui.queryByRole('status')).toBeNull();
 expect(ui.getByText('添加到 WorkBuddy').hasAttribute('disabled')).toBe(false);
});

it('shows independent saved configuration badges and hides deletion for an unconfigured client',async()=>{
 const {ui}=fixture('chatgpt',{chatgpt:false,claude:true,workbuddy:false});
 await waitFor(()=>expect((ui.getByRole('combobox') as HTMLSelectElement).disabled).toBe(false));
 expect(ui.queryByRole('button',{name:/删除 .* 连接配置/})).toBeNull();
 expect(ui.getByRole('option',{name:'ChatGPT · 未配置'})).toBeTruthy();
 expect(ui.getByRole('option',{name:'Claude 桌面版（实验性） · 已配置'})).toBeTruthy();
 fireEvent.change(ui.getByRole('combobox'),{target:{value:'claude'}});
 await waitFor(()=>expect(ui.getByRole('button',{name:'删除 Claude 连接配置'})).toBeTruthy());
 fireEvent.change(ui.getByRole('combobox'),{target:{value:'workbuddy'}});
 await waitFor(()=>expect(ui.getByRole('button',{name:'添加到 WorkBuddy'})).toBeTruthy());
 expect(ui.queryByRole('button',{name:/删除 .* 连接配置/})).toBeNull();
});
it('refreshes configuration after adding a local client',async()=>{
 const config={chatgpt:false,claude:false,workbuddy:false};const {ui,invoke}=fixture('claude',config);
 await waitFor(()=>expect((ui.getByRole('combobox') as HTMLSelectElement).disabled).toBe(false));
 expect(ui.queryByRole('button',{name:'删除 Claude 连接配置'})).toBeNull();
 const original=invoke.getMockImplementation()!;
 invoke.mockImplementation(async command=>{if(command==='connector_client_add')config.claude=true;return original(command);});
 fireEvent.click(ui.getByRole('button',{name:'添加到 Claude'}));
 await waitFor(()=>expect(ui.getByRole('button',{name:'删除 Claude 连接配置'})).toBeTruthy());
});
it('uses beta and named delete actions in English, with unknown status hidden safely',async()=>{
 await setInterfaceLanguage('en');const {ui,invoke}=fixture();
 await waitFor(()=>expect(ui.getByRole('option',{name:'Claude Desktop (beta) · Configured'})).toBeTruthy());
 expect(ui.getByRole('button',{name:'Delete Claude connection configuration'})).toBeTruthy();
 const original=invoke.getMockImplementation()!;
 invoke.mockImplementation(async command=>{if(command==='connector_client_status')throw Error('unavailable');return original(command);});
 fireEvent.click(ui.getByRole('button',{name:'Add to Claude'}));
 await waitFor(()=>expect(ui.getByRole('option',{name:'Claude Desktop (beta) · Status unavailable'})).toBeTruthy());
 expect(ui.queryByRole('button',{name:'Delete Claude connection configuration'})).toBeNull();
});

it.each(['zh-CN','en'] as const)('offers manual Claude import when Windows has no association (%s)', async language => {
 await setInterfaceLanguage(language);
 const {ui,invoke}=fixture();
 await waitFor(()=>expect((ui.getByRole('combobox') as HTMLSelectElement).disabled).toBe(false));
 const original=invoke.getMockImplementation()!;
 invoke.mockImplementation(command=>command==='connector_client_add'?Promise.resolve('claude_manual'):original(command));
 fireEvent.click(ui.getByRole('button',{name:language==='en'?'Add to Claude':'添加到 Claude'}));
 await waitFor(()=>expect(ui.getByRole('status').textContent).toContain(language==='en'?'no usable extension file association':'没有可用的扩展文件关联'));
 const details=ui.container.querySelector('details')!;
 expect(details.open).toBe(true);
 expect(details.textContent).toContain('Ripple.mcpb');
 const reveal=ui.getByRole('button',{name:language==='en'?'Open extension folder':'打开扩展所在文件夹'}) as HTMLButtonElement;
 await waitFor(()=>expect(reveal.disabled).toBe(false));fireEvent.click(reveal);
 await waitFor(()=>expect(invoke).toHaveBeenCalledWith('connector_client_reveal',undefined));
 expect(details.open).toBe(true);
});

it('keeps export cancellation silent, prevents duplicate operations and never claims an AI connection',async()=>{
 const {ui,invoke}=fixture();
 await waitFor(()=>expect((ui.getByRole('combobox') as HTMLSelectElement).disabled).toBe(false));
 let done:(value:boolean)=>void=()=>{};
 const pending=new Promise<boolean>(resolve=>{done=resolve;});
 const original=invoke.getMockImplementation()!;
 invoke.mockImplementation(command=>command==='connector_client_export'?pending:original(command));
 fireEvent.click(ui.getByRole('button',{name:'导出 Claude 扩展'}));
 expect((ui.getByRole('button',{name:'添加到 Claude'}) as HTMLButtonElement).disabled).toBe(true);
 expect((ui.getByRole('button',{name:'导出 Claude 扩展'}) as HTMLButtonElement).disabled).toBe(true);
 await act(async()=>done(false));
 await waitFor(()=>expect((ui.getByRole('button',{name:'导出 Claude 扩展'}) as HTMLButtonElement).disabled).toBe(false));
 expect(ui.queryByRole('status')).toBeNull();
 expect(ui.queryByRole('alert')).toBeNull();
});

it.each(['export_failed','claude_open_failed'])('gives a stage-specific manual recovery for %s without exposing native details',async code=>{
 const {ui,invoke}=fixture();
 await waitFor(()=>expect((ui.getByRole('combobox') as HTMLSelectElement).disabled).toBe(false));
 const original=invoke.getMockImplementation()!;
 invoke.mockImplementation(command=>command==='connector_client_add'?Promise.reject(code):original(command));
 fireEvent.click(ui.getByRole('button',{name:'添加到 Claude'}));
 await waitFor(()=>expect(ui.getByRole('alert').textContent).toContain(code==='export_failed'?'生成或导出失败':'扩展已生成'));
 expect(ui.container.querySelector('details')!.open).toBe(true);
 expect(ui.queryByRole('status')).toBeNull();
});
