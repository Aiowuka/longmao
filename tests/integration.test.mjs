import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBackendConfig} from '../src/backend-config.mjs';
import {generateSyntheticRun} from '../src/run-generator.mjs';
import {CdpObserver} from '../src/cdp-observer.mjs';
import {SelfHostedBackend} from '../src/owned-backend.mjs';

function rawConfig(overrides = {}) {
  return {
    schemaVersion: 1,
    origin: 'http://127.0.0.1:8787',
    auth: {
      capture: {
        pathPrefixes: ['/api/'],
        requestHeaderNames: ['authorization', 'x-access-token'],
        responseJsonPaths: ['data.token'],
      },
      outbound: {header: 'Authorization', prefix: 'Bearer '},
    },
    endpoints: {
      profile: {method: 'GET', path: '/api/me'},
      tasks: {method: 'GET', path: '/api/run/tasks'},
      start: {method: 'POST', path: '/api/run/start'},
      submit: {method: 'POST', path: '/api/run/submit'},
      receipt: {method: 'GET', path: '/api/run/receipts/{receiptId}'},
    },
    ids: {runIdPath: 'runId', receiptIdPath: 'receiptId'},
    ...overrides,
  };
}

test('backend config only allows HTTPS remotely and exact endpoint paths', () => {
  const config = validateBackendConfig(rawConfig());
  assert.equal(config.origin, 'http://127.0.0.1:8787');
  assert.throws(() => validateBackendConfig(rawConfig({origin: 'http://example.com'})), {code: 'HTTPS_BACKEND_REQUIRED'});
  const bad = rawConfig();
  bad.endpoints.start.path = 'https://evil.example/run';
  assert.throws(() => validateBackendConfig(bad), {code: 'INVALID_BACKEND_PATH'});
});

test('synthetic generator produces bounded local test data and labels it', () => {
  const track = generateSyntheticRun({
    taskId: 'task-a',
    distanceMeters: 3000,
    durationSeconds: 1200,
    centerLat: 31.2304,
    centerLon: 121.4737,
  }, {startedAt: new Date('2026-09-20T00:00:00.000Z')});
  assert.equal(track.synthetic, true);
  assert.equal(track.generatedBy, 'longmao-test-generator');
  assert.equal(track.taskId, 'task-a');
  assert.ok(track.points.length >= 24 && track.points.length <= 2000);
  assert.ok(Math.abs(track.summary.generatedDistanceMeters - 3000) < 60);
  assert.equal(track.points[0].timestamp, '2026-09-20T00:00:00.000Z');
  assert.equal(track.points.at(-1).elapsedSeconds, 1200);
});

test('CDP observer captures auth only from the configured backend origin', () => {
  const config = validateBackendConfig(rawConfig());
  const observer = new CdpObserver({backendConfig: config});

  observer.ingest({
    method: 'Network.requestWillBeSent',
    params: {
      requestId: 'outside',
      request: {
        url: 'https://other.example/api/me',
        method: 'GET',
        headers: {Authorization: 'Bearer SHOULD-NOT-BE-CAPTURED'},
      },
    },
  });
  assert.equal(observer.getToken(), null);

  observer.ingest({
    method: 'Network.requestWillBeSent',
    params: {
      requestId: 'owned',
      request: {
        url: 'http://127.0.0.1:8787/api/me',
        method: 'GET',
        headers: {Authorization: 'Bearer abcdefgh-12345678'},
      },
    },
  });
  assert.equal(observer.getToken(), 'abcdefgh-12345678');
  assert.equal(observer.status().auth.present, true);
  assert.notEqual(observer.status().auth.preview, observer.getToken());
  assert.equal(observer.events(10).some(event => event.kind === 'request' && event.path === '/api/me'), true);
});

test('CDP observer can capture configured token path from owned backend JSON response', async () => {
  const config = validateBackendConfig(rawConfig());
  const observer = new CdpObserver({backendConfig: config});
  observer.command = async (method, params) => {
    assert.equal(method, 'Network.getResponseBody');
    assert.deepEqual(params, {requestId: 'r1'});
    return {body: JSON.stringify({data: {token: 'response-token-1234'}}), base64Encoded: false};
  };

  observer.ingest({
    method: 'Network.responseReceived',
    params: {
      requestId: 'r1',
      response: {url: 'http://127.0.0.1:8787/api/login', status: 200, mimeType: 'application/json'},
    },
  });
  observer.ingest({method: 'Network.loadingFinished', params: {requestId: 'r1'}});
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(observer.getToken(), 'response-token-1234');
  assert.equal(observer.status().auth.source, 'response-json:data.token');
});

test('self-hosted backend runs fixed profile/tasks/start/submit/receipt contract without exposing token in report', async () => {
  const config = validateBackendConfig(rawConfig());
  const calls = [];
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({path, init});
    assert.equal(init.headers.Authorization, 'Bearer secret-token-123456');
    const values = {
      '/api/me': {name: 'owner'},
      '/api/run/tasks': {tasks: [{id: 'task-a'}]},
      '/api/run/start': {runId: 'run-1'},
      '/api/run/submit': {receiptId: 'receipt-1'},
      '/api/run/receipts/receipt-1': {accepted: true},
    };
    if (!values[path]) return {ok: false, status: 404, async json() { return {}; }};
    return {ok: true, status: 200, async json() { return values[path]; }};
  };

  const backend = new SelfHostedBackend(config, {fetchImpl});
  const report = await backend.run({
    taskId: 'task-a',
    distanceMeters: 1000,
    durationSeconds: 420,
    centerLat: 31.2304,
    centerLon: 121.4737,
  }, 'secret-token-123456', {startedAt: new Date('2026-09-20T00:00:00.000Z')});

  assert.equal(report.ok, true);
  assert.equal(report.run.runId, 'run-1');
  assert.equal(report.run.receiptId, 'receipt-1');
  assert.deepEqual(report.receipt, {accepted: true});
  assert.deepEqual(calls.map(call => call.path), [
    '/api/me',
    '/api/run/tasks',
    '/api/run/start',
    '/api/run/submit',
    '/api/run/receipts/receipt-1',
  ]);
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /secret-token-123456/);
  const submitBody = JSON.parse(calls.find(call => call.path === '/api/run/submit').init.body);
  assert.equal(submitBody.track.synthetic, true);
  assert.equal(submitBody.track.generatedBy, 'longmao-test-generator');
});

test('self-hosted backend refuses to run without captured auth', async () => {
  const backend = new SelfHostedBackend(validateBackendConfig(rawConfig()), {
    fetchImpl: async () => { throw new Error('should not be called'); },
  });
  const report = await backend.run({
    taskId: 'task-a',
    distanceMeters: 1000,
    durationSeconds: 420,
    centerLat: 31,
    centerLon: 121,
  }, null);
  assert.equal(report.ok, false);
  assert.equal(report.error.code, 'BACKEND_AUTH_REQUIRED');
});
