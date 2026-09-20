import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTotoroConfig} from '../src/totoro-config.mjs';
import {TotoroClient, TOTORO_API_PATHS} from '../src/totoro-client.mjs';
import {CdpObserver} from '../src/cdp-observer.mjs';

function config(overrides = {}) {
  return {
    schemaVersion: 1,
    baseUrl: 'http://127.0.0.1:3000',
    capture: {
      origin: 'https://backend.example',
      pathPrefixes: ['/wxxcx/'],
      requestHeaderNames: ['authorization'],
      responseJsonPaths: ['data.token'],
    },
    ...overrides,
  };
}

test('Totoro sidecar must be loopback and remote capture origin must be HTTPS', () => {
  const parsed = validateTotoroConfig(config());
  assert.equal(parsed.baseUrl, 'http://127.0.0.1:3000');
  assert.equal(parsed.capture.origin, 'https://backend.example');
  assert.throws(() => validateTotoroConfig(config({baseUrl: 'https://totoro.example'})), {code: 'LOOPBACK_TOTORO_REQUIRED'});
  assert.throws(() => validateTotoroConfig(config({capture: {...config().capture, origin: 'http://backend.example'}})),
    {code: 'HTTPS_CAPTURE_ORIGIN_REQUIRED'});
});

test('CDP observer captures only the configured backend origin', () => {
  const parsed = validateTotoroConfig(config());
  const observer = new CdpObserver({captureConfig: parsed.capture});

  observer.ingest({
    method: 'Network.requestWillBeSent',
    params: {request: {
      url: 'https://other.example/wxxcx/user',
      method: 'GET',
      headers: {Authorization: 'Bearer should-not-capture'},
    }},
  });
  assert.equal(observer.getToken(), null);

  observer.ingest({
    method: 'Network.requestWillBeSent',
    params: {request: {
      url: 'https://backend.example/wxxcx/user',
      method: 'GET',
      headers: {Authorization: 'Bearer captured-token-1234'},
    }},
  });
  assert.equal(observer.getToken(), 'captured-token-1234');
  assert.equal(observer.status().auth.present, true);
  assert.notEqual(observer.status().auth.preview, observer.getToken());
});

test('Totoro client delegates the full flow to Totoro native API routes and payloads', async () => {
  const calls = [];
  const responses = new Map([
    ['GET /', {status: 200, body: {}}],
    ['POST /api/login/token', {status: 200, body: {
      success: true,
      data: {
        token: 'secret-token',
        stuNumber: 'S001',
        stuName: 'Owner',
        schoolCode: 'SC01',
        schoolName: 'Test School',
        campusId: 'C01',
        campusName: 'Main',
      },
    }}],
    ['POST /api/sunrun/tasks', {status: 200, body: {
      success: true,
      tasks: [{
        taskId: 'task-1',
        name: 'Run',
        mileage: '3.2',
        minTime: '10',
        maxTime: '25',
        runPointList: [{
          taskId: 'task-1',
          pointId: 'route-1',
          pointName: 'Route 1',
          pointList: [
            {longitude: '118.1', latitude: '31.1'},
            {longitude: '118.2', latitude: '31.2'},
          ],
        }],
      }],
    }}],
    ['POST /api/sunrun/preview', {status: 200, body: {
      success: true,
      preview: {
        previewToken: 'preview-1',
        expiresAt: '2026-09-20T10:10:00.000Z',
        track: {km: '3.20', usedTime: '00:20:00'},
      },
    }}],
    ['POST /api/sunrun/start', {status: 200, body: {
      success: true,
      result: {
        mode: 'queued',
        jobId: 'job-1',
        scantronId: 'scan-1',
        scheduledAt: '2026-09-20T10:20:00.000Z',
        track: {km: '3.20'},
      },
    }}],
    ['POST /api/sunrun/run-job', {status: 200, body: {
      success: true,
      jobs: [{jobId: 'job-1', state: 'delayed', scheduledAt: '2026-09-20T10:20:00.000Z'}],
    }}],
  ]);

  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    const method = init.method || 'GET';
    const key = `${method} ${parsed.pathname}`;
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({method, path: parsed.pathname, body});
    const response = responses.get(key);
    if (!response) throw new Error(`unexpected call ${key}`);
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      async json() { return response.body; },
    };
  };

  const client = new TotoroClient(validateTotoroConfig(config()), {fetchImpl});
  const health = await client.health();
  assert.equal(health.reachable, true);

  await client.sync('secret-token');
  const synced = client.state();
  assert.equal(synced.profile.stuNumber, 'S001');
  assert.equal('token' in synced.profile, false);
  assert.equal(synced.tasks.length, 1);

  await client.createPreview('secret-token', {taskId: 'task-1', routeId: 'route-1'});
  assert.equal(client.state().preview.previewToken, 'preview-1');

  await client.start('secret-token');
  assert.equal(client.state().lastRun.jobId, 'job-1');

  const jobs = await client.jobs('secret-token');
  assert.equal(jobs[0].jobId, 'job-1');

  assert.deepEqual(calls.map(call => `${call.method} ${call.path}`), [
    'GET /',
    'POST /api/login/token',
    'POST /api/sunrun/tasks',
    'POST /api/sunrun/preview',
    'POST /api/sunrun/start',
    'POST /api/sunrun/run-job',
  ]);

  const loginCall = calls.find(call => call.path === TOTORO_API_PATHS.login);
  assert.deepEqual(loginCall.body, {token: 'secret-token'});

  const tasksCall = calls.find(call => call.path === TOTORO_API_PATHS.tasks);
  assert.deepEqual(tasksCall.body, {token: 'secret-token', stu_number: 'S001', campus_id: 'C01'});

  const previewCall = calls.find(call => call.path === TOTORO_API_PATHS.preview);
  assert.equal(previewCall.body.stu_number, 'S001');
  assert.equal(previewCall.body.school_code, 'SC01');
  assert.equal(previewCall.body.task.taskId, 'task-1');
  assert.equal(previewCall.body.route.pointId, 'route-1');

  const startCall = calls.find(call => call.path === TOTORO_API_PATHS.start);
  assert.deepEqual(Object.keys(startCall.body).sort(), ['preview_token', 'route', 'task', 'token']);
  assert.equal(startCall.body.preview_token, 'preview-1');
});

test('Totoro client does not expose a generic upstream request primitive', async () => {
  const client = new TotoroClient(validateTotoroConfig(config()), {
    fetchImpl: async () => { throw new Error('should not run'); },
  });
  await assert.rejects(() => client.post('/api/arbitrary', {}), {code: 'TOTORO_PATH_NOT_ALLOWED'});
});

test('Totoro route selection follows Totoro task data instead of generating a route in Longmao', async () => {
  const client = new TotoroClient(validateTotoroConfig(config()), {
    fetchImpl: async (url) => {
      const path = new URL(url).pathname;
      if (path === '/api/login/token') return {ok: true, status: 200, async json() {
        return {success: true, data: {stuNumber: 'S1', schoolCode: 'SC', campusId: 'C'}};
      }};
      if (path === '/api/sunrun/tasks') return {ok: true, status: 200, async json() {
        return {success: true, tasks: [{taskId: 't', runPointList: [{pointId: 'r'}]}]};
      }};
      throw new Error('unexpected');
    },
  });
  await client.sync('12345678');
  assert.throws(() => client.select('t', ''), {code: 'TOTORO_ROUTE_REQUIRED'});
  assert.equal(client.select('t', 'r').route.pointId, 'r');
});
