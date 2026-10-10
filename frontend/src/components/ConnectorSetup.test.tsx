// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { ConnectorSetup } from './ConnectorSetup';
vi.mock('../lib/desktopFs', () => ({ nativeDesktopAvailable: () => true }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function fixture(client = 'claude') {
 const invoke=vi.fn(async(command:string)=>command==='connector_client_status'?{client}:command==='connector_client_export'?true:undefined);
 (window as unknown as {__TAURI__: unknown}).__TAURI__={core:{invoke}};
 const onSaved=vi.fn();
 const ui=render(<ConnectorSetup onSaved={onSaved}/>);
 return {ui,invoke,onSaved};
}
it('restores the chosen client and exports without claiming AI connection',async()=>{
 const {ui,invoke}=fixture();
 await waitFor(()=>expect((ui.getByRole('combobox') as HTMLSelectElement).value).toBe('claude'));
 fireEvent.click(ui.getByText('导出 Claude 扩展'));
 await waitFor(()=>expect(ui.getByRole('status').textContent).toContain('已导出'));
 expect(invoke).toHaveBeenCalledWith('connector_client_export',{client:'claude'});
 expect(invoke.mock.calls.flat()).not.toContain('connector_pair_begin');
});
it('switches only after saving succeeds, retains separate instructions without a duplicate disconnect control',async()=>{
 const {ui,invoke,onSaved}=fixture();
 await waitFor(()=>expect((ui.getByRole('combobox') as HTMLSelectElement).value).toBe('claude'));
 fireEvent.change(ui.getByRole('combobox'),{target:{value:'workbuddy'}});
 await waitFor(()=>expect(ui.getByText('导出 WorkBuddy 配置')).toBeTruthy());
 expect(invoke).toHaveBeenCalledWith('connector_client_select',{client:'workbuddy'});
 expect(onSaved).toHaveBeenCalledOnce();
 expect(ui.queryByText('断开连接')).toBeNull();
});
it('cancelled export is not reported as success',async()=>{
 const {ui,invoke}=fixture();
 await waitFor(()=>expect((ui.getByRole('combobox') as HTMLSelectElement).value).toBe('claude'));
 invoke.mockImplementation(async()=>false as never);
 fireEvent.click(ui.getByText('导出 Claude 扩展'));
 await waitFor(()=>expect(ui.getByText('导出 Claude 扩展').hasAttribute('disabled')).toBe(false));
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
