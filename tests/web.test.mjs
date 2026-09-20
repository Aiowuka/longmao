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

test('web root serves the local dashboard with no credential input', async () => {
  const response = await fetch(base + '/');
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Longmao 控制台/);
  assert.doesNotMatch(html, /type=["']password["']/i);
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
});

test('status endpoint declares the local-only boundary', async () => {
  const response = await fetch(base + '/api/status');
  const status = await response.json();
  assert.equal(response.status, 200);
  assert.equal(status.bindHost, '127.0.0.1');
  assert.equal(status.externalSubmission, false);
  assert.equal(status.credentialCapture, false);
  assert.equal(status.wmpf.capabilities.readsTraffic, false);
});

test('mock workflow can run from the web API and is persisted locally', async () => {
  const runResponse = await fetch(base + '/api/mock/run', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({scenario: 'success'}),
  });
  const run = await runResponse.json();
  assert.equal(runResponse.status, 200);
  assert.equal(run.report.ok, true);
  assert.equal(run.report.mode, 'offline-mock');

  const reportResponse = await fetch(base + '/api/report');
  const saved = await reportResponse.json();
  assert.deepEqual(saved.report, run.report);
});

test('web API rejects production-like or extra mock options', async () => {
  for (const body of [
    {scenario: 'production'},
    {scenario: 'success', token: 'secret'},
    {scenario: 'success', url: 'https://example.invalid'},
  ]) {
    const response = await fetch(base + '/api/mock/run', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'INVALID_MOCK_SCENARIO');
  }
});

test('web API requires JSON and does not expose unknown routes', async () => {
  const wrongType = await fetch(base + '/api/mock/run', {method: 'POST', body: 'scenario=success'});
  assert.equal(wrongType.status, 415);
  assert.equal((await wrongType.json()).code, 'JSON_REQUIRED');

  const missing = await fetch(base + '/api/submit-real');
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).code, 'NOT_FOUND');
});

test('web server refuses non-loopback bind requests', async () => {
  await assert.rejects(() => startWebServer({host: '0.0.0.0', port: 0}), {code: 'LOOPBACK_BIND_REQUIRED'});
});
