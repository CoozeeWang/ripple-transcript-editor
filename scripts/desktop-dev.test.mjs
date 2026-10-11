import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import { assertPortFree, waitFor } from './desktop-dev.mjs';

test('occupied port is rejected without disturbing its owner', async () => {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    await assert.rejects(assertPortFree(port), /occupied/);
    assert.equal(server.listening, true);
  } finally { await new Promise(resolve => server.close(resolve)); }
  await assertPortFree(port);
});

test('readiness waits through unavailable responses and stops if child exits', async () => {
  let requests = 0;
  const server = http.createServer((_, res) => { res.writeHead(++requests < 2 ? 503 : 200); res.end(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    await waitFor(url, () => true, 2000);
    assert.equal(requests, 2);
    await assert.rejects(waitFor(url, () => false), /did not start/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
