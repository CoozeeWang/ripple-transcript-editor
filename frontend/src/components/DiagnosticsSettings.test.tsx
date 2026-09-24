// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DiagnosticsSettings } from './DiagnosticsSettings';
import { CopyProblem } from './CopyProblem';
import { recordProblem } from '../lib/diagnostics';
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('shows recent local problems even if the backend is unavailable', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  recordProblem('rename', new DOMException('private filename', 'NotAllowedError'));
  render(<DiagnosticsSettings />);
  expect(screen.getByText('重命名：文件或服务访问权限不足')).toBeTruthy();
  await screen.findByText(/暂时无法读取后台记录/);
  expect((screen.getByRole('button', { name: "导出诊断与日志" }) as HTMLButtonElement).disabled).toBe(false);
});
it('shows an honest clipboard failure instead of claiming success', async () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => { throw new Error('denied'); }) } });
  render(<CopyProblem problem={recordProblem('save')} />);
  fireEvent.click(screen.getByText('复制错误详情'));
  await screen.findByText("复制失败，请从“设置 → 诊断与日志”导出");
  expect(screen.queryByText('已复制')).toBeNull();
});
it('exports only allowlisted records and environment fields', async () => {
  const id = '12345678-1234-1234-1234-123456789abc';
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ records: [{id, time: new Date().toISOString(), operation:'editing',status:502,raw:'secret-key'}] }))));
  const create = vi.fn<(blob: Blob) => string>(() => 'blob:diagnostic');
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(<DiagnosticsSettings />);
  await waitFor(() => expect((screen.getByRole('button', { name: "导出诊断与日志" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: "导出诊断与日志" }));
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  const content = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload=()=>resolve(String(reader.result)); reader.readAsText(create.mock.calls[0][0]); });
  expect(content).toContain('502'); expect(content).not.toContain('secret-key');
});
