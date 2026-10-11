// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { ChatGPTSetup } from './ChatGPTSetup';
vi.mock('../lib/desktopFs', () => ({ nativeDesktopAvailable: () => true }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('keeps acquisition guidance and native platform link visible for a configured tunnel without exposing its key', async () => {
  const invoke = vi.fn(async (command: string) => command === 'connector_setup_status'
    ? { client_path: '/synthetic/tunnel-client', tunnel_id: 'tunnel_synthetic', has_key: true, configured: true } : undefined);
  (window as unknown as { __TAURI__: unknown }).__TAURI__ = { core: { invoke } };
  const ui = render(<ChatGPTSetup />);
  fireEvent.click(ui.getByText('连接配置'));
  await waitFor(() => expect(ui.getByText('修改配置')).toBeTruthy());
  expect(ui.getByText(/首次连接：打开下方 OpenAI/)).toBeTruthy();
  expect(ui.getByLabelText(/^运行密钥（Runtime API key）/).getAttribute('value')).toBe('');
  fireEvent.click(ui.getByRole('link', { name: 'OpenAI 连接平台与程序下载' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('connector_open_platform', undefined));
});
it('copies only the tunnel identifier, never the stored runtime key', async () => {
 const invoke=vi.fn(async()=>({client_path:'/synthetic/tunnel-client',tunnel_id:'tunnel_synthetic',has_key:true,configured:true}));
 (window as unknown as {__TAURI__: unknown}).__TAURI__={core:{invoke}};
 const writeText=vi.fn(async()=>{});
 Object.defineProperty(navigator,'clipboard',{value:{writeText},configurable:true});
 const ui=render(<ChatGPTSetup/>);
 fireEvent.click(ui.getByText('连接配置'));
 await waitFor(()=>expect(ui.getByText('复制隧道标识')).toBeTruthy());
 fireEvent.click(ui.getByText('复制隧道标识'));
 await waitFor(()=>expect(writeText).toHaveBeenCalledWith('tunnel_synthetic'));
 expect(ui.getByText(/隧道标识已复制/)).toBeTruthy();
});
