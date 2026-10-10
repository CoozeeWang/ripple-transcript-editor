import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('settings no longer exposes built-in editing or editing plans', async () => {
  const source = await readFile(new URL('../src/components/SettingsModal.tsx', import.meta.url), 'utf8');

  assert.equal(source.includes('settings-tab-plans'), false);
  assert.equal(source.includes('AIModelSettings'), false);
});
