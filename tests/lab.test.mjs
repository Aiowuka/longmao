import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {LabError, MockBackend, demoPayload, runDemo} from '../src/lab.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const codeIs = code => error => error instanceof LabError && error.code === code;
const cli = (...args) => spawnSync(process.execPath, [join(root, 'src/cli.mjs'), ...args], {cwd: root, encoding: 'utf8', timeout: 10000});
function fixture() {
  const backend = new MockBackend();
  const session = backend.login();
  const job = backend.openJob(session, 'demo-task');
  return {backend, session, job};
}

test('successful demo has all six verified stages', () => {
  const report = runDemo();
  assert.equal(report.ok, true);
  assert.equal(report.mode, 'offline-mock');
  assert.equal(report.steps.length, 6);
  assert.ok(report.steps.every(step => step.status === 'passed'));
  assert.equal(report.receipt.status, 'accepted-in-mock');
  assert.equal(report.error, null);
});
test('successful fixture is deterministic', () => assert.deepEqual(runDemo(), runDemo()));
test('expired session stops before creation and submission', () => {
  const report = runDemo({scenario: 'expired-session'});
  assert.equal(report.ok, false);
  assert.equal(report.error.code, 'SESSION_EXPIRED');
  assert.deepEqual(report.steps.map(step => step.name), ['mock-login', 'load-fixture-task']);
  assert.equal(report.receipt, null);
});
test('rejected submission never produces a receipt or verification success', () => {
  const report = runDemo({scenario: 'rejected-submission'});
  assert.equal(report.error.code, 'MOCK_REJECTED_SUBMISSION');
  assert.equal(report.steps.at(-1).status, 'failed');
  assert.equal(report.steps.length, 5);
  assert.equal(report.receipt, null);
});
test('unknown scenario is rejected', () => assert.throws(() => runDemo({scenario: 'production'}), codeIs('INVALID_SCENARIO')));
test('URL configuration is not supported', () => assert.throws(() => runDemo({baseUrl: 'https://example.invalid'}), codeIs('UNSUPPORTED_OPTION')));
test('credential input is not supported', () => assert.throws(() => runDemo({token: 'DO-NOT-LOG-ME'}), codeIs('UNSUPPORTED_OPTION')));
test('invalid options are rejected', () => {
  for (const options of [null, [], 1, 'demo', Object.create(null)]) assert.throws(() => runDemo(options), codeIs('INVALID_OPTIONS'));
});
test('symbol options are rejected', () => assert.throws(() => runDemo({[Symbol('target')]: true}), codeIs('UNSUPPORTED_OPTION')));
test('session must be from this backend', () => {
  const backend = new MockBackend();
  backend.login();
  assert.throws(() => backend.listTasks({kind: 'mock-session'}), codeIs('INVALID_SESSION'));
});
test('anonymous session is rejected', () => assert.throws(() => new MockBackend().listTasks(null), codeIs('INVALID_SESSION')));
test('task data is returned as a copy', () => {
  const backend = new MockBackend(); const session = backend.login();
  backend.listTasks(session)[0].id = 'changed';
  assert.equal(backend.listTasks(session)[0].id, 'demo-task');
});
test('unknown task is rejected', () => {
  const backend = new MockBackend(); const session = backend.login();
  assert.throws(() => backend.openJob(session, 'unknown'), codeIs('UNKNOWN_TASK'));
});
test('unknown job is rejected', () => {
  const backend = new MockBackend(); const session = backend.login();
  assert.throws(() => backend.submit(session, 'unknown', demoPayload(), 'demo-one'), codeIs('UNKNOWN_JOB'));
});
test('only explicitly synthetic fixture data can be submitted', () => {
  const {backend, session, job} = fixture();
  for (const payload of [{...demoPayload(), demoOnly: false}, {...demoPayload(), sampleCount: 0}, {...demoPayload(), fixtureId: 'real-data'}]) {
    assert.throws(() => backend.submit(session, job.id, payload, 'demo-one'), codeIs('INVALID_DEMO_PAYLOAD'));
  }
});
test('extra payload fields fail closed', () => {
  const {backend, session, job} = fixture();
  assert.throws(() => backend.submit(session, job.id, {...demoPayload(), token: 'unused'}, 'demo-one'), codeIs('UNSUPPORTED_OPTION'));
});
test('idempotent retry returns the same receipt', () => {
  const {backend, session, job} = fixture();
  const first = backend.submit(session, job.id, demoPayload(), 'demo-one');
  const again = backend.submit(session, job.id, demoPayload(), 'demo-one');
  assert.deepEqual(first, again);
});
test('an idempotency key cannot be reused for another job', () => {
  const {backend, session, job} = fixture();
  backend.submit(session, job.id, demoPayload(), 'demo-one');
  const second = backend.openJob(session, 'demo-task');
  assert.throws(() => backend.submit(session, second.id, demoPayload(), 'demo-one'), codeIs('IDEMPOTENCY_CONFLICT'));
});
test('one job cannot be submitted again under another key', () => {
  const {backend, session, job} = fixture();
  backend.submit(session, job.id, demoPayload(), 'demo-one');
  assert.throws(() => backend.submit(session, job.id, demoPayload(), 'demo-two'), codeIs('JOB_ALREADY_SUBMITTED'));
});
test('invalid idempotency keys are rejected', () => {
  const {backend, session, job} = fixture();
  for (const key of ['', null, 'real-token', 'demo-' + 'x'.repeat(49)]) {
    assert.throws(() => backend.submit(session, job.id, demoPayload(), key), codeIs('INVALID_IDEMPOTENCY_KEY'));
  }
});
test('receipt is immutable from the caller perspective', () => {
  const {backend, session, job} = fixture();
  const receipt = backend.submit(session, job.id, demoPayload(), 'demo-one');
  receipt.status = 'changed';
  assert.equal(backend.readReceipt(session, 'demo-one').status, 'accepted-in-mock');
});
test('nonexistent receipt fails verification', () => {
  const {backend, session} = fixture();
  assert.throws(() => backend.readReceipt(session, 'demo-missing'), codeIs('RECEIPT_NOT_FOUND'));
});
test('closed backend cannot be used or reopened', () => {
  const {backend, session} = fixture();
  backend.close(); backend.close();
  assert.throws(() => backend.listTasks(session), codeIs('BACKEND_CLOSED'));
  assert.throws(() => backend.login(), codeIs('BACKEND_CLOSED'));
});
test('demo does not use fetch', () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('NETWORK_CALL_FORBIDDEN'); };
  try { assert.equal(runDemo().ok, true); } finally { globalThis.fetch = original; }
});
test('offline core source has no network, subprocess or dynamic upstream imports', async () => {
  for (const name of ['lab.mjs', 'cli.mjs', 'provenance.mjs']) {
    const source = await readFile(join(root, 'src', name), 'utf8');
    assert.doesNotMatch(source, /node:(?:http|https|net|tls|dgram|child_process)|\bfetch\s*\(|\bWebSocket\s*\(|\bimport\s*\(/);
  }
});
test('web integration remains loopback-only and cannot launch upstream processes', async () => {
  const web = await readFile(join(root, 'src', 'web.mjs'), 'utf8');
  const bridge = await readFile(join(root, 'src', 'wmpf-bridge.mjs'), 'utf8');
  assert.match(web, /127\.0\.0\.1/);
  assert.match(bridge, /127\.0\.0\.1/);
  assert.doesNotMatch(web + bridge, /node:child_process|\bspawn\s*\(|\bexec\s*\(/);
  assert.doesNotMatch(bridge, /Authorization|Cookie|token/i);
});
test('reference commits are pinned and not runtime dependencies', async () => {
  const lock = JSON.parse(await readFile(join(root, 'upstreams.lock.json'), 'utf8'));
  assert.equal(lock.sources.length, 2);
  for (const source of lock.sources) {
    assert.match(source.commit, /^[a-f0-9]{40}$/);
    assert.equal(source.vendored, false);
    assert.equal(source.runtimeDependency, false);
  }
});
test('help succeeds without installation', () => {
  const result = cli('help');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /OFFLINE MOCK ONLY/);
});
test('doctor reports no upstream compatibility claim', () => {
  const result = cli('doctor');
  assert.equal(result.status, 0, result.stderr);
  const doctor = JSON.parse(result.stdout);
  assert.equal(doctor.externalConnections, false);
  assert.match(doctor.upstreamCompatibility, /^NOT_TESTED/);
});
test('CLI does not echo a credential passed as an invalid argument', () => {
  const result = cli('demo', '--token', 'SENSITIVE-DO-NOT-ECHO');
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout + result.stderr, /SENSITIVE-DO-NOT-ECHO/);
});
test('CLI rejects an unsupported command', () => assert.equal(cli('submit-real').status, 1));
test('CLI persists reports and returns correct status for all scenarios', async () => {
  for (const [scenario, expectedStatus] of [['success', 0], ['expired-session', 1], ['rejected-submission', 1]]) {
    const result = cli('demo', '--scenario', scenario);
    assert.equal(result.status, expectedStatus, result.stderr);
    const report = JSON.parse(await readFile(join(root, 'artifacts/last-report.json'), 'utf8'));
    assert.equal(report.scenario, scenario);
    assert.equal(report.ok, expectedStatus === 0);
  }
});
