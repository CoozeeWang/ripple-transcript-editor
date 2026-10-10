// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { ConnectorSetup } from './ConnectorSetup';
vi.mock('../lib/desktopFs', () => ({ nativeDesktopAvailable: () => true }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function fixture(paired = false, available = true) {
 const invoke = vi.fn(async (command: string) => command === 'connector_pair_begin'
  ? {paired:false,available:true,pair_code:'ABCDEF123456',expires_at:Date.now()/1000+600}
  : {paired: command === 'connector_pair_revoke' ? false : paired, available});
 (window as unknown as {__TAURI__: unknown}).__TAURI__ = {core:{invoke}};
 const onSaved=vi.fn(), onRevoked=vi.fn(); const ui=render(<ConnectorSetup onSaved={onSaved} onRevoked={onRevoked}/>);
 return {invoke,ui,onSaved,onRevoked};
}
it('offers a single pairing flow without executable, endpoint, tunnel or secret fields',async()=>{
 const {ui,invoke,onSaved}=fixture();
 await waitFor(()=>expect(ui.getByText('显示配对码')).toBeTruthy());
 expect(ui.container.querySelectorAll('input').length).toBe(0);
 fireEvent.click(ui.getByText('显示配对码'));
 await waitFor(()=>expect(ui.getByText('ABCD-EF12-3456')).toBeTruthy());
 expect(invoke).toHaveBeenCalledWith('connector_pair_begin');
 expect(onSaved).not.toHaveBeenCalled();
});
it('shows paired state and disables access only after revocation succeeds',async()=>{
 const {ui,invoke,onRevoked}=fixture(true);
 await waitFor(()=>expect(ui.getByText('撤销连接')).toBeTruthy());
 expect(ui.getByText('连接另一个 AI 应用')).toBeTruthy();
 fireEvent.click(ui.getByText('撤销连接'));
 await waitFor(()=>expect(onRevoked).toHaveBeenCalledOnce());
 expect(invoke).toHaveBeenCalledWith('connector_pair_revoke');
});
it('does not claim readiness or offer pairing when the service is not deployed',async()=>{
 const {ui}=fixture(false,false);
 await waitFor(()=>expect(ui.getByText('连接服务尚未部署，此构建暂不能连接外部 AI。')).toBeTruthy());
 expect(ui.queryByText('显示配对码')).toBeNull();
});
it('preserves pairing state when revocation fails',async()=>{
 const {ui,invoke,onRevoked}=fixture(true);
 await waitFor(()=>expect(ui.getByText('撤销连接')).toBeTruthy());
 invoke.mockImplementation(async()=>{throw new Error('network unavailable');});
 fireEvent.click(ui.getByText('撤销连接'));
 await waitFor(()=>expect(ui.getByRole('alert')).toBeTruthy());
 expect(onRevoked).not.toHaveBeenCalled();
});
