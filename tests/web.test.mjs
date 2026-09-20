import test from 'node:test';
import assert from 'node:assert/strict';
import {startWebServer} from '../src/web.mjs';
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
