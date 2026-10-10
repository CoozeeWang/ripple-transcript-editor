// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { ConnectorSetup } from './ConnectorSetup';
vi.mock('../lib/desktopFs', () => ({ nativeDesktopAvailable: () => true }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function fixture(configured = true) {
 const invoke = vi.fn(async (command: string) => command === 'connector_setup_status' ? { client_path: '/synthetic/tunnel-client', tunnel_id: 'tunnel_synthetic', has_key: configured, configured } : undefined);
 (window as unknown as {__TAURI__: unknown}).__TAURI__ = {core:{invoke}};
 const onSaved=vi.fn(); const ui=render(<ConnectorSetup onSaved={onSaved}/>);
 return {invoke,ui,onSaved};
}
it('shows saved non-secret values and key presence, then cancels edits without losing configuration',async()=>{
 const {ui,invoke}=fixture();
 await waitFor(()=>expect(ui.getByText('修改配置')).toBeTruthy());
 expect(invoke).toHaveBeenCalledWith('connector_setup_status',undefined);
 const inputs=ui.container.querySelectorAll('input');
 expect(inputs[0].value).toBe('tunnel-client'); expect(inputs[1].value).toBe('tunnel_synthetic');
 expect(inputs[2].value).toBe(''); expect(inputs[2].placeholder).toBe('已保存（不显示）');
 fireEvent.click(ui.getByText('修改配置'));
 fireEvent.change(inputs[1],{target:{value:'tunnel_changed'}});
 fireEvent.change(inputs[2],{target:{value:'synthetic-key'}});
 fireEvent.click(ui.getByText('取消'));
 expect(inputs[1].value).toBe('tunnel_synthetic');expect(inputs[2].value).toBe('');
 expect(invoke).toHaveBeenCalledTimes(1);
});
it('retains the saved key on a blank-key save and reconnects only after success',async()=>{
 const {ui,invoke,onSaved}=fixture();
 await waitFor(()=>expect(ui.getByText('修改配置')).toBeTruthy()); fireEvent.click(ui.getByText('修改配置'));
 fireEvent.click(ui.getByText('保存连接配置'));
 await waitFor(()=>expect(onSaved).toHaveBeenCalledOnce());
 expect(invoke).toHaveBeenCalledWith('connector_setup',{clientPath:'/synthetic/tunnel-client',tunnelId:'tunnel_synthetic',runtimeKey:''});
});
it('requires a key when none has been saved yet',async()=>{
 const {ui}=fixture(false);
 await waitFor(()=>expect(ui.getByText('保存连接配置')).toBeTruthy());
 expect((ui.getByText('保存连接配置') as HTMLButtonElement).disabled).toBe(true);
 const key=ui.container.querySelector('input[type=password]')!;
 fireEvent.change(key,{target:{value:'synthetic-key'}});
 expect((ui.getByText('保存连接配置') as HTMLButtonElement).disabled).toBe(false);
});
