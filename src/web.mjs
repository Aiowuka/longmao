import {createServer} from 'node:http';
import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runDemo, SCENARIOS} from './lab.mjs';
import {validateSourceManifest} from './provenance.mjs';
import {probeWmpf} from './wmpf-bridge.mjs';
import {CdpObserver} from './cdp-observer.mjs';
import {loadBackendConfig, publicBackendConfig} from './backend-config.mjs';
import {SelfHostedBackend} from './owned-backend.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const webRoot = join(root, 'web');
const reportPath = join(root, 'artifacts', 'last-report.json');
const MAX_BODY_BYTES = 32 * 1024;

const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);

function setSecurityHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
}

function sendJson(res, status, value) {
  setSecurityHeaders(res);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(value));
}

function fail(res, status, code) {
  sendJson(res, status, {ok: false, code});
}

async function readJsonBody(req) {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    throw Object.assign(new Error('JSON_REQUIRED'), {code: 'JSON_REQUIRED'});
  }

  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('BODY_TOO_LARGE'), {code: 'BODY_TOO_LARGE'});
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('INVALID_JSON'), {code: 'INVALID_JSON'});
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, names) {
  return isPlainObject(value) &&
    Reflect.ownKeys(value).every(key => typeof key === 'string' && names.includes(key)) &&
    names.every(name => Object.prototype.hasOwnProperty.call(value, name));
}

async function saveReport(report) {
  const directory = dirname(reportPath);
  await mkdir(directory, {recursive: true});
  const temporary = join(directory, `.web-report-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(report, null, 2) + '\n', {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    await rename(temporary, reportPath);
  } finally {
    await rm(temporary, {force: true});
  }
}

async function readLatestReport() {
  try {
    return JSON.parse(await readFile(reportPath, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function readSources() {
  const manifest = JSON.parse(await readFile(join(root, 'upstreams.lock.json'), 'utf8'));
  return validateSourceManifest(manifest);
}

function validHostHeader(req) {
  const host = String(req.headers.host || '').toLowerCase();
  return host === '127.0.0.1' || host.startsWith('127.0.0.1:') ||
    host === 'localhost' || host.startsWith('localhost:');
}

async function serveStatic(pathname, res) {
  const entry = staticFiles.get(pathname);
  if (!entry) return false;
  const [file, contentType] = entry;
  const body = await readFile(join(webRoot, file));
  setSecurityHeaders(res);
  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);
  res.end(body);
  return true;
}

function backendUnavailable(res, backendState) {
  return fail(res, 409, backendState?.error || 'BACKEND_NOT_CONFIGURED');
}

export function createAppHandler({
  wmpfProbe = probeWmpf,
  cdpObserver = null,
  backendRuntime = null,
  backendState = {configured: false, path: null, config: null, error: null},
} = {}) {
  return async function app(req, res) {
    try {
      if (!validHostHeader(req)) return fail(res, 400, 'LOCAL_HOST_REQUIRED');
      const url = new URL(req.url || '/', 'http://127.0.0.1');

      if (req.method === 'GET' && await serveStatic(url.pathname, res)) return;

      if (req.method === 'GET' && url.pathname === '/api/status') {
        const wmpf = await wmpfProbe();
        return sendJson(res, 200, {
          ok: true,
          app: 'longmao-local-web',
          mode: 'local-lab',
          node: process.versions.node,
          platform: process.platform,
          uptimeSeconds: Math.round(process.uptime()),
          bindHost: '127.0.0.1',
          selfHostedSubmission: Boolean(backendRuntime),
          cdp: cdpObserver ? cdpObserver.status() : null,
          backend: publicBackendConfig(backendState),
          wmpf,
        });
      }

      if (req.method === 'GET' && url.pathname === '/api/wmpf') {
        return sendJson(res, 200, {ok: true, wmpf: await wmpfProbe()});
      }

      if (req.method === 'GET' && url.pathname === '/api/sources') {
        return sendJson(res, 200, {ok: true, sources: (await readSources()).sources});
      }

      if (req.method === 'GET' && url.pathname === '/api/report') {
        return sendJson(res, 200, {ok: true, report: await readLatestReport()});
      }

      if (req.method === 'POST' && url.pathname === '/api/mock/run') {
        const body = await readJsonBody(req);
        if (!isPlainObject(body) || Reflect.ownKeys(body).length !== 1 ||
            !Object.prototype.hasOwnProperty.call(body, 'scenario') ||
            !SCENARIOS.includes(body.scenario)) {
          return fail(res, 400, 'INVALID_MOCK_SCENARIO');
        }
        const report = runDemo({scenario: body.scenario});
        await saveReport(report);
        return sendJson(res, 200, {ok: true, report});
      }

      if (url.pathname.startsWith('/api/cdp') && !cdpObserver) return fail(res, 409, 'CDP_NOT_AVAILABLE');

      if (req.method === 'GET' && url.pathname === '/api/cdp/status') {
        return sendJson(res, 200, {ok: true, cdp: cdpObserver.status()});
      }
      if (req.method === 'GET' && url.pathname === '/api/cdp/events') {
        const limit = Math.max(1, Math.min(300, Number(url.searchParams.get('limit')) || 100));
        return sendJson(res, 200, {ok: true, events: cdpObserver.events(limit)});
      }
      if (req.method === 'POST' && url.pathname === '/api/cdp/connect') {
        return sendJson(res, 200, {ok: true, cdp: await cdpObserver.connect()});
      }
      if (req.method === 'POST' && url.pathname === '/api/cdp/disconnect') {
        return sendJson(res, 200, {ok: true, cdp: cdpObserver.disconnect()});
      }
      if (req.method === 'POST' && url.pathname === '/api/cdp/auth/clear') {
        return sendJson(res, 200, {ok: true, cdp: cdpObserver.clearAuth()});
      }
      if (req.method === 'POST' && url.pathname === '/api/cdp/events/clear') {
        return sendJson(res, 200, {ok: true, cdp: cdpObserver.clearEvents()});
      }

      if (req.method === 'GET' && url.pathname === '/api/backend/status') {
        return sendJson(res, 200, {
          ok: true,
          backend: publicBackendConfig(backendState),
          runtime: backendRuntime ? backendRuntime.status() : null,
          auth: cdpObserver ? cdpObserver.status().auth : {present: false},
        });
      }

      if (url.pathname.startsWith('/api/backend') && !backendRuntime) {
        return backendUnavailable(res, backendState);
      }

      if (req.method === 'GET' && url.pathname === '/api/backend/tasks') {
        const token = cdpObserver?.getToken();
        if (!token) return fail(res, 409, 'BACKEND_AUTH_REQUIRED');
        return sendJson(res, 200, {ok: true, tasks: await backendRuntime.getTasks(token)});
      }

      if (req.method === 'GET' && url.pathname === '/api/backend/profile') {
        const token = cdpObserver?.getToken();
        if (!token) return fail(res, 409, 'BACKEND_AUTH_REQUIRED');
        return sendJson(res, 200, {ok: true, profile: await backendRuntime.getProfile(token)});
      }

      if (req.method === 'GET' && url.pathname === '/api/backend/report') {
        return sendJson(res, 200, {ok: true, report: backendRuntime.latestReport || null});
      }

      if (req.method === 'POST' && url.pathname === '/api/backend/run') {
        const token = cdpObserver?.getToken();
        if (!token) return fail(res, 409, 'BACKEND_AUTH_REQUIRED');
        const body = await readJsonBody(req);
        const keys = ['taskId', 'distanceMeters', 'durationSeconds', 'centerLat', 'centerLon'];
        if (!exactKeys(body, keys)) return fail(res, 400, 'INVALID_RUN_PLAN');
        const report = await backendRuntime.run(body, token);
        return sendJson(res, report.ok ? 200 : 502, {ok: report.ok, report, code: report.error?.code || null});
      }

      return fail(res, 404, 'NOT_FOUND');
    } catch (error) {
      const code = error && typeof error.code === 'string' ? error.code : 'LOCAL_WEB_ERROR';
      const status = code === 'JSON_REQUIRED' ? 415 :
        ['INVALID_JSON', 'BODY_TOO_LARGE', 'INVALID_RUN_PLAN', 'INVALID_TASK_ID', 'INVALID_DISTANCE',
          'INVALID_DURATION', 'INVALID_LATITUDE', 'INVALID_LONGITUDE'].includes(code) ? 400 :
        ['BACKEND_AUTH_REQUIRED', 'BACKEND_NOT_CONFIGURED', 'CDP_NOT_AVAILABLE'].includes(code) ? 409 :
        code.startsWith('BACKEND_') ? 502 : 500;
      return fail(res, status, code);
    }
  };
}

export function startWebServer({
  host = '127.0.0.1',
  port = 3210,
  wmpfProbe = probeWmpf,
  cdpObserver = null,
  backendRuntime = null,
  backendState,
} = {}) {
  if (host !== '127.0.0.1') {
    return Promise.reject(Object.assign(new Error('LOOPBACK_BIND_REQUIRED'), {code: 'LOOPBACK_BIND_REQUIRED'}));
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    return Promise.reject(Object.assign(new Error('INVALID_WEB_PORT'), {code: 'INVALID_WEB_PORT'}));
  }

  return new Promise((resolveStart, rejectStart) => {
    const server = createServer(createAppHandler({wmpfProbe, cdpObserver, backendRuntime, backendState}));
    server.once('error', rejectStart);
    server.listen(port, host, () => {
      server.removeListener('error', rejectStart);
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      resolveStart({server, host, port: actualPort, url: `http://127.0.0.1:${actualPort}`});
    });
  });
}

function parseConfiguredPort(value) {
  if (value === undefined || value === '') return 3210;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw Object.assign(new Error('INVALID_WEB_PORT'), {code: 'INVALID_WEB_PORT'});
  }
  return port;
}

async function main() {
  const backendState = await loadBackendConfig({root});
  const cdpObserver = new CdpObserver({backendConfig: backendState.config});
  const backendRuntime = backendState.config ? new SelfHostedBackend(backendState.config) : null;
  const started = await startWebServer({
    port: parseConfiguredPort(process.env.LONGMAO_WEB_PORT),
    cdpObserver,
    backendRuntime,
    backendState,
  });

  console.log(`Longmao Local Web: ${started.url}`);
  if (backendState.config) console.log(`Self-hosted backend: ${backendState.config.origin}`);
  else console.log(`Self-hosted backend: not configured (copy config/backend.example.json to config/backend.json)`);
  console.log('WMPF/CDP stays on loopback; captured auth remains in process memory.');

  const shutdown = () => {
    cdpObserver.disconnect();
    started.server.close(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(JSON.stringify({ok: false, code: error && error.code ? error.code : 'LOCAL_WEB_START_FAILED'}));
    process.exitCode = 1;
  });
}
