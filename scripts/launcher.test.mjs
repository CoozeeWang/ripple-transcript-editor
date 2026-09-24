import test from 'node:test';
import assert from 'node:assert/strict';
import { isOwnedService, isOwnedChrome, backendNeedsUpdate } from './launcher.mjs';

test('startup refreshes old backends without treating storage failures as old versions', async () => {
  assert.equal(await backendNeedsUpdate(async () => ({ status: 404 })), true);
  assert.equal(await backendNeedsUpdate(async () => ({ status: 200 })), false);
  assert.equal(await backendNeedsUpdate(async () => ({ status: 500 })), false);
  await assert.rejects(backendNeedsUpdate(async () => { throw new Error('unreachable'); }), /unreachable/);
});

test('service cleanup distinguishes this checkout from other projects', () => {
  const root = '/projects/transcription editor';
  assert.equal(isOwnedService('python -m uvicorn app.main:app', `${root}/backend`, root), true);
  assert.equal(isOwnedService('node /deps/vite/bin/vite.js', `${root}/frontend`, root), true);
  assert.equal(isOwnedService('python -m uvicorn app.main:app', '/projects/other/backend', root), false);
  assert.equal(isOwnedService('node unrelated.js', `${root}/frontend`, root), false);
  assert.equal(isOwnedService('python -m uvicorn app.main:app', `${root}/backend-other`, root), false);
});

test('absolute service arguments require an exact directory or script path', () => {
  const root='/projects/transcription editor';
  assert.equal(isOwnedService(`python -m uvicorn app.main:app --app-dir "${root}/backend" --port 8000`, '', root), true);
  assert.equal(isOwnedService(`python -m uvicorn app.main:app --app-dir ${root}/backend-other --port 8000`, '', root), false);
  assert.equal(isOwnedService(`node "${root}/frontend/node_modules/vite/bin/vite.js" --strictPort`, '', root), true);
  assert.equal(isOwnedService(`node "${root}/frontend/node_modules/vite/bin/vite.js-other"`, '', root), false);
});


test('Chrome cleanup requires the exact Ripple profile and main executable', () => {
  const exe = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const profile = '/projects/ripple/.chrome-profile';
  assert.equal(isOwnedChrome(`${exe} --user-data-dir=${profile} --app=http://localhost:5173/`, profile), true);
  assert.equal(isOwnedChrome(exe, profile), false);
  assert.equal(isOwnedChrome(`${exe} --user-data-dir=${profile}-other`, profile), false);
  assert.equal(isOwnedChrome(`${exe} --user-data-dir=/projects/leaf/.chrome-profile`, profile), false);
  assert.equal(isOwnedChrome(`${exe} Helper --user-data-dir=${profile} --type=renderer`, profile), false);
  assert.equal(isOwnedChrome(`sh -c ${exe} --user-data-dir=${profile}`, profile), false);
});
