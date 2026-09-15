import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import {createServer} from 'node:net';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {LabBackend} from '../src/lab-backend/server.mjs';
import {TotoroAdapter} from '../src/integrations/totoro/adapter.mjs';

const totoroRoot = fileURLToPath(new URL('../../Totoro/', import.meta.url));
await access(resolve(totoroRoot, 'node_modules/next/package.json'));

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => server.listen(0, '127.0.0.1', error => error ? reject(error) : resolveListen()));
  const {port} = server.address();
  await new Promise(resolveClose => server.close(resolveClose));
  return port;
}

test('native Totoro Next backend runs its API routes behind the local transport guard', async t => {
  const backend = new LabBackend({port: 0});
  await backend.start();
  t.after(() => backend.close());
  const adapter = new TotoroAdapter({root: totoroRoot, backendUrl: backend.url, port: await freePort(), timeoutMs: 45000});
  t.after(() => adapter.close());
  await adapter.start();
  const result = await adapter.runNativeWorkflow();
  assert.deepEqual(result, {
    mode: 'native-next-backend', taskId: 'demo-paper', routeId: 'demo-line', scantronId: 'local-scantron', steps: 10,
  });
  assert.equal(backend.requests.length, 12);
  assert.ok(backend.requests.every(request => !JSON.stringify(request).includes('DEMO_SESSION')));
});
