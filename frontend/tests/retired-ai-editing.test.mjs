import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';

test('settings no longer exposes built-in editing or editing plans', async () => {
  const source = await readFile(new URL('../src/components/SettingsModal.tsx', import.meta.url), 'utf8');

  expect(source).not.toContain('settings-tab-plans');
  expect(source).not.toContain('AIModelSettings');
});
