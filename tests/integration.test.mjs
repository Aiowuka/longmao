import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import {WebSocketServer} from 'ws';
import {sanitize} from '../src/integrations/wmpf/sanitizer.mjs';
import {CdpClient} from '../src/integrations/wmpf/cdp-client.mjs';
import {createLocalTransport, assertLoopbackUrl} from '../src/integrations/totoro/local-transport.mjs';
import {loadTotoroModules} from '../src/integrations/totoro/loader.mjs';
import {LabBackend} from '../src/lab-backend/server.mjs';
import {TotoroAdapter} from '../src/integrations/totoro/adapter.mjs';
import {BridgeController} from '../src/bridge/controller.mjs';
import {isPortReady} from '../src/integrations/wmpf/detector.mjs';

test('sanitizer removes nested credentials before logging', () => {
  const result = sanitize({headers: {Authorization: 'Bearer secret', Cookie: 'sid=secret'}, token: 'secret', text: 'openid=abc'});
  assert.equal(result.credentialPresent, true);
  assert.deepEqual(result.value.headers, {Authorization: '***', Cookie: '***'});
  assert.equal(result.value.token, '***');
  assert.ok(!JSON.stringify(result.value).includes('secret'));
  assert.ok(!JSON.stringify(result.value).includes('abc'));
});

test('WMPF detector reports a closed CDP port as unavailable', async () => {
  assert.equal(await isPortReady({port: 61999, timeoutMs: 100}), false);
  const client = new CdpClient({endpoint: 'ws://127.0.0.1:61999', connectTimeoutMs: 100, autoReconnect: false});
  await assert.rejects(client.connect(), /CDP_CONNECTION_FAILED|CDP_CONNECT_TIMEOUT/);
  client.close();
});

test('CDP client enables domains and receives real websocket events', async t => {
  const server = new WebSocketServer({host: '127.0.0.1', port: 0});
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  server.on('connection', socket => socket.on('message', bytes => {
    const request = JSON.parse(bytes.toString());
    socket.send(JSON.stringify({id: request.id, result: {}}));
    if (request.method === 'Page.enable') socket.send(JSON.stringify({method: 'Runtime.consoleAPICalled', params: {type: 'log', args: [{value: 'ready'}]}}));
  }));
  const {port} = server.address();
  const client = new CdpClient({endpoint: `ws://127.0.0.1:${port}`});
  t.after(() => client.close());
  const event = new Promise(resolve => client.once('event', resolve));
  await client.connect();
  assert.equal((await event).method, 'Runtime.consoleAPICalled');
});

test('CDP client reports malformed frames and reconnects after disconnect', async t => {
  const server = new WebSocketServer({host: '127.0.0.1', port: 0});
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  let connections = 0;
  server.on('connection', socket => {
    const connection = ++connections;
    socket.on('message', bytes => {
      const request = JSON.parse(bytes.toString());
      socket.send(JSON.stringify({id: request.id, result: {}}));
      if (request.method !== 'Page.enable') return;
      if (connection === 1) {
        socket.send('{malformed');
        setTimeout(() => socket.close(), 10);
      } else {
        socket.send(JSON.stringify({method: 'Runtime.exceptionThrown', params: {timestamp: 1}}));
      }
    });
  });
  const {port} = server.address();
  const client = new CdpClient({endpoint: `ws://127.0.0.1:${port}`, reconnectDelayMs: 20});
  t.after(() => client.close());
  const malformed = new Promise(resolve => client.once('protocolError', resolve));
  const reconnected = new Promise(resolve => client.once('reconnect', resolve));
  const secondEvent = new Promise(resolve => client.on('event', event => {
    if (event.method === 'Runtime.exceptionThrown') resolve(event);
  }));
  await client.connect();
  assert.equal((await malformed).code, 'MALFORMED_CDP_MESSAGE');
  await reconnected;
  assert.equal((await secondEvent).method, 'Runtime.exceptionThrown');
  assert.equal(connections, 2);
});

test('closing a disconnected CDP client cancels pending reconnect', async t => {
  const server = new WebSocketServer({host: '127.0.0.1', port: 0});
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  let connections = 0;
  server.on('connection', socket => { connections++; setTimeout(() => socket.close(), 5); });
  const {port} = server.address();
  const client = new CdpClient({endpoint: `ws://127.0.0.1:${port}`, commandTimeoutMs: 10, reconnectDelayMs: 40});
  await client.connect();
  await new Promise(resolve => client.once('disconnect', resolve));
  client.close();
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(connections, 1);
});

test('transport guard routes Totoro production origins only to loopback', async t => {
  const backend = new LabBackend({port: 0});
  await backend.start();
  t.after(() => backend.close());
  const transport = createLocalTransport(backend.url);
  const response = await transport('https://wxxcx.xtotoro.com/wxxcx/platform/serverlist/GetStudentInfoByToken', {
    headers: {Authorization: 'Bearer DEMO_SESSION'},
  });
  assert.equal(response.status, 200);
  assert.throws(() => assertLoopbackUrl('https://example.com'), /EXTERNAL_BACKEND_BLOCKED/);
  await assert.rejects(transport('https://example.com/a'), /EXTERNAL_BACKEND_BLOCKED/);
});

test('real Totoro modules execute against the local contract backend', async t => {
  const root = new URL('../../Totoro/', import.meta.url);
  const modules = await loadTotoroModules({root});
  const backend = new LabBackend({port: 0});
  await backend.start();
  t.after(() => backend.close());
  const fetchImpl = createLocalTransport(backend.url);
  const profile = await modules.loginWithToken('DEMO_SESSION', {fetchImpl});
  const service = new modules.SunRunService({token: 'DEMO_SESSION', stuNumber: profile.stuNumber, campusId: profile.campusId}, {fetchImpl});
  const tasks = await service.getSunrunTasks();
  assert.equal(tasks[0].taskId, 'demo-paper');
  assert.ok(backend.requests.every(request => request.credentialPresent && !JSON.stringify(request).includes('DEMO_SESSION')));
});

test('real Totoro login masks malformed responses and timeouts', async () => {
  const modules = await loadTotoroModules({root: new URL('../../Totoro/', import.meta.url)});
  await assert.rejects(modules.loginWithToken('DEMO_SESSION', {fetchImpl: async () => new Response('not json')}), /响应异常/);
  const timeout = new Error('private timeout detail');
  timeout.name = 'TimeoutError';
  await assert.rejects(modules.loginWithToken('DEMO_SESSION', {fetchImpl: async () => { throw timeout; }}), error => {
    assert.equal(error.status, 504);
    assert.ok(!error.message.includes('private timeout detail'));
    return true;
  });
});

test('fake CDP event drives bridge through real Totoro workflow with duplicate suppression', async t => {
  class FakeObserver extends EventEmitter { start() {} }
  const backend = new LabBackend({port: 0});
  await backend.start();
  t.after(() => backend.close());
  const adapter = new TotoroAdapter({root: new URL('../../Totoro/', import.meta.url), backendUrl: backend.url});
  const observer = new FakeObserver();
  const controller = new BridgeController({observer, adapter, mode: 'modules'});
  controller.start();
  const completed = new Promise(resolve => controller.once('completed', resolve));
  const runtimeEvent = {method: 'Runtime.executionContextCreated', params: {executionContextId: 7}};
  observer.emit('event', runtimeEvent);
  observer.emit('event', runtimeEvent);
  const report = await completed;
  assert.equal(report.result.mode, 'upstream-modules');
  assert.equal(report.result.steps, 10);
  assert.equal(report.session.eventCount, 1);
  assert.equal(report.session.duplicateCount, 1);
  assert.ok(backend.requests.length >= 12);
  assert.ok(backend.requests.every(request => !JSON.stringify(request).includes('DEMO_SESSION')));
});
