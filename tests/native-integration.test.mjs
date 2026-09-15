import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import {createServer} from 'node:net';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {LabBackend} from '../src/lab-backend/server.mjs';
import {TotoroAdapter, createTotoroEnvironment} from '../src/integrations/totoro/adapter.mjs';
import {TotoroUiProxy} from '../src/ui/totoro-proxy.mjs';

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
  const proxy = new TotoroUiProxy({upstreamUrl: adapter.url, port: await freePort()});
  await proxy.start();
  t.after(() => proxy.close());
  const launch = await fetch(proxy.url, {redirect: 'manual'});
  const cookie = launch.headers.get('set-cookie').split(';')[0];
  const page = await fetch(proxy.origin, {headers: {cookie}});
  assert.equal(page.ok, true);
  assert.match(await page.text(), /data-longmao-bridge/);
  const login = await fetch(new URL('/api/login/token', proxy.origin), {
    method: 'POST', headers: {'content-type': 'application/json', cookie}, body: JSON.stringify({token: 'private-runtime-token'}),
  });
  assert.equal(login.ok, true);
  const loginResult = await login.json();
  assert.equal(loginResult.data.token, 'private-runtime-token');
  assert.ok(backend.requests.every(request => !JSON.stringify(request).includes('private-runtime-token')));
});

test('native Totoro transport starts the original page without requiring the local backend', async t => {
  const adapter = new TotoroAdapter({root: totoroRoot, transport: 'native', port: await freePort(), timeoutMs: 45000});
  t.after(() => adapter.close());
  await adapter.start();
  const page = await fetch(adapter.url);
  assert.equal(page.ok, true);
  assert.match(await page.text(), /Totoro Sunrun|阳光跑/);
  await assert.rejects(adapter.runNativeWorkflow(), /LOCAL_TOTORO_TRANSPORT_REQUIRED/);
});

test('native Totoro transport removes only longmao-owned routing from the spawned environment', () => {
  const guardUrl = new URL('../src/integrations/totoro/totoro-fetch-guard.mjs', import.meta.url).href;
  const environment = createTotoroEnvironment({
    transport: 'native',
    inherited: {
      NODE_OPTIONS: `--trace-warnings --import=${guardUrl} --max-old-space-size=2048`,
      LONGMAO_LOCAL_BACKEND_URL: 'http://127.0.0.1:3210/',
      SUNRUN_MINIPROGRAM_BASE_URL: 'https://wxxcx.xtotoro.com',
    },
  });
  assert.equal(environment.NODE_OPTIONS, '--trace-warnings --max-old-space-size=2048');
  assert.equal('LONGMAO_LOCAL_BACKEND_URL' in environment, false);
  assert.equal(environment.SUNRUN_MINIPROGRAM_BASE_URL, 'https://wxxcx.xtotoro.com');
});
