// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import CredentialManager, { CredentialFields, FieldInput } from './CredentialManager';
import type { CredentialField } from './types';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const fields: CredentialField[] = [
  { key: 'model', label: '模型', secret: false, required: true, placeholder: '', options: ['preset-one'], default_value: 'preset-one' },
  { key: 'api_key', label: 'API 密钥', secret: true, required: true, placeholder: '' },
  { key: 'base_url', label: '服务地址', secret: false, required: true, placeholder: '', advanced: true, default_value: 'https://api.test/v1' },
];
function Form() {
  const [values, setValues] = useState({ model: 'preset-one', api_key: 'secret', base_url: 'https://api.test/v1' });
  return <CredentialFields fields={fields} values={values} visible={{}} servicePath="/api/ai/providers/test"
    onChange={(key, value) => setValues(previous => ({ ...previous, [key]: value }))} onToggle={() => {}} />;
}
it('keeps an existing custom model editable without replacing it with a preset', () => {
  render(<FieldInput field={fields[0]} value="my-existing-model" visible={false} onToggle={() => {}} onChange={() => {}} />);
  expect((screen.getByRole('textbox', { name: '模型 ID' }) as HTMLInputElement).value).toBe('my-existing-model');
});
it('supports manual model IDs and presets without losing keyboard editing', () => {
  render(<Form />);
  fireEvent.change(screen.getByRole('combobox', { name: '模型' }), { target: { value: '__custom__' } });
  fireEvent.change(screen.getByRole('textbox', { name: '模型 ID' }), { target: { value: 'exact/custom-id' } });
  expect((screen.getByRole('textbox', { name: '模型 ID' }) as HTMLInputElement).value).toBe('exact/custom-id');
  fireEvent.change(screen.getByRole('combobox', { name: '模型' }), { target: { value: 'preset-one' } });
  expect(screen.queryByRole('textbox', { name: '模型 ID' })).toBeNull();
});
it('reads additional models without changing the selection and keeps the key hidden', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ models: ['new-model'] })));
  vi.stubGlobal('fetch', fetcher);
  render(<Form />);
  fireEvent.click(screen.getByRole('button', { name: "读取模型" }));
  await screen.findByRole('option', { name: 'new-model' });
  expect((screen.getByRole('combobox', { name: '模型' }) as HTMLSelectElement).value).toBe('preset-one');
  expect((screen.getByLabelText('API 密钥') as HTMLInputElement).type).toBe('password');
  expect(fetcher.mock.calls[0][0]).toBe('/api/ai/providers/test/models');
});
it('failed model discovery leaves manual entry available', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: '服务不支持列表' }), { status: 502 })));
  render(<Form />);
  fireEvent.click(screen.getByRole('button', { name: "读取模型" }));
  await screen.findByRole('alert');
  fireEvent.change(screen.getByRole('combobox', { name: '模型' }), { target: { value: '__custom__' } });
  expect(screen.getByRole('textbox', { name: '模型 ID' })).toBeTruthy();
});
it('clears a successful test when the model changes', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }))));
  render(<Form />);
  fireEvent.click(screen.getByRole('button', { name: '测试连接' }));
  await screen.findByText(/连接与 JSON 输出测试通过/);
  fireEvent.change(screen.getByRole('combobox', { name: '模型' }), { target: { value: '__custom__' } });
  await waitFor(() => expect(screen.queryByText(/连接与 JSON 输出测试通过/)).toBeNull());
});
it('switching service replaces defaults and clears the previous secret', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/ai/providers') return new Response(JSON.stringify([{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }]));
    const id = url.includes('/one/') ? 'one' : 'two';
    return new Response(JSON.stringify({ provider_id: id, provider_name: id, profiles: [], fields: fields.map(f => f.key === 'base_url' ? { ...f, default_value: `https://${id}.test/v1` } : f) }));
  }));
  render(<CredentialManager kind="editing" />);
  fireEvent.click(await screen.findByRole('button', { name: '+ 添加配置' }));
  fireEvent.change(screen.getByRole('combobox', { name: '服务商' }), { target: { value: 'one' } });
  fireEvent.change(screen.getByLabelText('API 密钥'), { target: { value: 'first-key' } });
  fireEvent.change(screen.getByRole('combobox', { name: '服务商' }), { target: { value: 'two' } });
  expect((screen.getByLabelText('API 密钥') as HTMLInputElement).value).toBe('');
  expect((screen.getByLabelText('服务地址') as HTMLInputElement).value).toBe('https://two.test/v1');
});
