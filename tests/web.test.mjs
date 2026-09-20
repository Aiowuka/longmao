import test from 'node:test';
import assert from 'node:assert/strict';
import {startWebServer} from '../src/web.mjs';
import {CdpObserver} from '../src/cdp-observer.mjs';
import {DEFAULT_WMPF_PORTS, resolveWmpfPorts} from '../src/wmpf-bridge.mjs';

let server;
let base;

test.before(async () => {
  const started = await startWebServer({
    port: 0,
    wmpfProbe: async () => ({
      mode: 'loopback-port-probe',
      host: '127.0.0.1',
      ready: false,
      debug: {port: 9421, reachable: false, state: 'closed', latencyMs: 0},
      cdp: {port: 62000, reachable: false, state: 'closed', latencyMs: 0},
      capabilities: {readsTraffic: false, readsCredentials: false, replaysRequests: false, startsUpstreamProcess: false},
    }),
  });
  server = started.server;
  base = started.url;
});

test.after(async () => {
  if (!server) return;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

test('WMPF port defaults match upstream defaults and reject invalid overrides', () => {
  assert.deepEqual(resolveWmpfPorts({}), DEFAULT_WMPF_PORTS);
  assert.deepEqual(resolveWmpfPorts({LONGMAO_WMPF_DEBUG_PORT: '19421', LONGMAO_WMPF_CDP_PORT: '62001'}), {
    debug: 19421,
    cdp: 62001,
  });
  assert.throws(() => resolveWmpfPorts({LONGMAO_WMPF_CDP_PORT: 'https://example.invalid'}), {code: 'INVALID_LOCAL_PORT'});
});

test('web root serves orchestrator UI with no raw credential input', async () => {
  const response = await fetch(base + '/');
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /WMPF \+ Totoro/);
  assert.doesNotMatch(html, /type=["']password["']/i);
  assert.doesNotMatch(html, /name=["']token["']/i);
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
});

test('status endpoint declares loopback binding and unconfigured Totoro sidecar', async () => {
  const response = await fetch(base + '/api/status');
  const status = await response.json();
  assert.equal(response.status, 200);
  assert.equal(status.bindHost, '127.0.0.1');
  assert.equal(status.mode, 'totoro-sidecar-orchestrator');
  assert.equal(status.cdp, null);
  assert.equal(status.totoro.config.configured, false);
});

test('Totoro status is readable but Totoro actions require explicit local config', async () => {
  const statusResponse = await fetch(base + '/api/totoro/status');
  const status = await statusResponse.json();
  assert.equal(statusResponse.status, 200);
  assert.equal(status.config.configured, false);

  const sync = await fetch(base + '/api/totoro/sync', {method: 'POST'});
  assert.equal(sync.status, 409);
  assert.equal((await sync.json()).code, 'TOTORO_NOT_CONFIGURED');
});

test('mock workflow remains available as an independent Longmao regression baseline', async () => {
  const response = await fetch(base + '/api/mock/run', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({scenario: 'success'}),
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.report.ok, true);
  assert.equal(result.report.mode, 'offline-mock');
});

test('web API rejects generic replay routes and arbitrary upstream routes', async () => {
  for (const path of ['/api/submit-real', '/api/replay', '/api/request', '/api/backend/run']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).code, 'NOT_FOUND');
  }
});

test('web server refuses non-loopback bind requests', async () => {
  await assert.rejects(() => startWebServer({host: '0.0.0.0', port: 0}), {code: 'LOOPBACK_BIND_REQUIRED'});
});


test('CDP observer retries instrumentation until the miniapp target responds', async () => {
  class FakeSocket {
    constructor() {
      this.readyState = 0;
      this.listeners = new Map();
      this.sendCount = 0;
      queueMicrotask(() => {
        this.readyState = 1;
        this.emit('open', {});
      });
    }

    addEventListener(name, callback) {
      const list = this.listeners.get(name) || [];
      list.push(callback);
      this.listeners.set(name, list);
    }

    emit(name, event) {
      for (const callback of this.listeners.get(name) || []) callback(event);
    }

    send(raw) {
      const message = JSON.parse(raw);
      this.sendCount += 1;
      if (this.sendCount <= 3) return;
      queueMicrotask(() => this.emit('message', {data: JSON.stringify({id: message.id, result: {}})}));
    }

    close() {
      this.readyState = 3;
      this.emit('close', {});
    }
  }

  const socket = new FakeSocket();
  const observer = new CdpObserver({
    wsFactory: () => socket,
    commandTimeoutMs: 15,
    targetRetryIntervalMs: 5,
    targetRetryAttempts: 5,
  });

  const first = await observer.connect();
  assert.equal(first.connected, true);
  assert.equal(first.instrumented, false);
  assert.equal(first.targetRetrying, true);

  await new Promise(resolve => setTimeout(resolve, 80));
  const final = observer.status();
  assert.equal(final.instrumented, true);
  assert.equal(final.lastError, null);
  assert.equal(final.targetRetryCount, 0);
  assert.ok(observer.events().some(event => event.kind === 'cdp_instrument_retry'));
  assert.ok(observer.events().some(event => event.kind === 'cdp_instrumented'));
  observer.disconnect();
});


test('CDP observer reads the miniapp token from wx storage without exposing arbitrary evaluation', async () => {
  class FakeSocket {
    constructor() {
      this.readyState = 0;
      this.listeners = new Map();
      queueMicrotask(() => {
        this.readyState = 1;
        this.emit('open', {});
      });
    }

    addEventListener(name, callback) {
      const list = this.listeners.get(name) || [];
      list.push(callback);
      this.listeners.set(name, list);
    }

    emit(name, event) {
      for (const callback of this.listeners.get(name) || []) callback(event);
    }

    send(raw) {
      const message = JSON.parse(raw);
      let result = {};
      if (message.method === 'Runtime.evaluate') {
        assert.match(message.params.expression, /wx\.getStorageSync\("token"\)/);
        result = {result: {type: 'string', value: 'fixture-storage-token'}};
      }
      queueMicrotask(() => this.emit('message', {data: JSON.stringify({id: message.id, result})}));
    }

    close() {
      this.readyState = 3;
      this.emit('close', {});
    }
  }

  const observer = new CdpObserver({
    wsFactory: () => new FakeSocket(),
    commandTimeoutMs: 50,
  });
  const status = await observer.connect();
  assert.equal(status.instrumented, true);
  assert.equal(observer.getToken(), 'fixture-storage-token');
  const publicStatus = observer.status();
  assert.equal(publicStatus.auth.present, true);
  assert.equal(publicStatus.auth.source, 'wx-storage:token');
  assert.notEqual(publicStatus.auth.preview, 'fixture-storage-token');
  assert.ok(observer.events().some(event => event.kind === 'auth_captured' && event.source === 'wx-storage:token'));
  observer.disconnect();
});


test('CDP observer polls wx storage until login completes', async () => {
  let evaluateCount = 0;
  class FakeSocket {
    constructor() {
      this.readyState = 0;
      this.listeners = new Map();
      queueMicrotask(() => {
        this.readyState = 1;
        this.emit('open', {});
      });
    }
    addEventListener(name, callback) {
      const list = this.listeners.get(name) || [];
      list.push(callback);
      this.listeners.set(name, list);
    }
    emit(name, event) {
      for (const callback of this.listeners.get(name) || []) callback(event);
    }
    send(raw) {
      const message = JSON.parse(raw);
      let result = {};
      if (message.method === 'Runtime.evaluate') {
        evaluateCount += 1;
        result = {result: {type: 'string', value: evaluateCount >= 3 ? 'late-login-token' : ''}};
      }
      queueMicrotask(() => this.emit('message', {data: JSON.stringify({id: message.id, result})}));
    }
    close() {
      this.readyState = 3;
      this.emit('close', {});
    }
  }

  const observer = new CdpObserver({
    wsFactory: () => new FakeSocket(),
    commandTimeoutMs: 50,
    authRetryIntervalMs: 5,
    authRetryAttempts: 10,
  });
  const initial = await observer.connect();
  assert.equal(initial.instrumented, true);
  assert.equal(initial.auth.present, false);
  assert.equal(initial.authRetrying, true);

  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(observer.getToken(), 'late-login-token');
  assert.equal(observer.status().auth.source, 'wx-storage:token');
  assert.equal(observer.status().authRetrying, false);
  assert.ok(observer.events().some(event => event.kind === 'auth_storage_retry'));
  observer.disconnect();
});


test('CDP observer records unmatched network metadata without credential material', async () => {
  const observer = new CdpObserver({
    captureConfig: {
      origin: 'https://capture.example',
      pathPrefixes: ['/api/'],
      requestHeaderNames: ['authorization'],
      responseJsonPaths: ['token'],
    },
  });
  observer.ingest({
    method: 'Network.requestWillBeSent',
    params: {
      requestId: 'r1',
      request: {
        url: 'https://other.example/login?secret=query-value',
        method: 'POST',
        headers: {authorization: 'Bearer should-not-appear'},
      },
    },
  });
  const events = observer.events();
  const seen = events.find(event => event.kind === 'network_seen');
  assert.equal(seen.origin, 'https://other.example');
  assert.equal(seen.path, '/login');
  assert.equal(seen.method, 'POST');
  assert.equal(seen.matchedCaptureOrigin, false);
  assert.doesNotMatch(JSON.stringify(seen), /should-not-appear|query-value/);
});

test('CDP observer can inspect miniapp storage key names without returning values', async () => {
  class FakeSocket {
    constructor() {
      this.readyState = 1;
      this.listeners = new Map();
    }
    addEventListener(name, callback) {
      const list = this.listeners.get(name) || [];
      list.push(callback);
      this.listeners.set(name, list);
    }
    emit(name, event) {
      for (const callback of this.listeners.get(name) || []) callback(event);
    }
    send(raw) {
      const message = JSON.parse(raw);
      const result = message.params?.expression?.includes('getStorageInfoSync')
        ? {result: {type: 'object', value: ['sessionKey', 'profile']}}
        : {};
      queueMicrotask(() => this.emit('message', {data: JSON.stringify({id: message.id, result})}));
    }
  }
  const socket = new FakeSocket();
  const observer = new CdpObserver({wsFactory: () => socket, commandTimeoutMs: 50});
  observer.socket = socket;
  observer.state = 'connected';
  observer.instrumented = true;
  socket.addEventListener('message', event => observer.ingest(event.data));
  const keys = await observer.inspectStorageKeys();
  assert.deepEqual(keys, ['sessionKey', 'profile']);
  assert.deepEqual(observer.status().storageKeys, ['sessionKey', 'profile']);
});


test('web UI exposes safe CDP diagnostic fields', async () => {
  const response = await fetch(base + '/');
  const html = await response.text();
  assert.match(html, /id="storage-keys"/);
  assert.match(html, /不记录请求头、Cookie、请求体、响应体或 query 值/);
});
