import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { withLifecycleLock } from './lifecycle-lock.mjs';

test('simultaneous starts and cleanup cannot enter the critical section together', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ripple-lock-'));
  const file = path.join(dir, 'lock');
  let active = 0;
  try {
    await Promise.all(Array.from({ length: 4 }, () => withLifecycleLock(file, async () => {
      assert.equal(++active, 1);
      await new Promise(resolve => setTimeout(resolve, 30));
      assert.equal(--active, 0);
    })));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a failed start releases its lock for a subsequent start', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ripple-lock-'));
  const file = path.join(dir, 'lock');
  try {
    await assert.rejects(withLifecycleLock(file, () => { throw new Error('startup failed'); }), /startup failed/);
    assert.equal(await withLifecycleLock(file, () => 'reopened'), 'reopened');
    await writeFile(file, '2147483647');
    assert.equal(await withLifecycleLock(file, () => 'recovered'), 'recovered');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
