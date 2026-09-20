import {createServer} from 'node:http';
import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runDemo, SCENARIOS} from './lab.mjs';
import {validateSourceManifest} from './provenance.mjs';
import {probeWmpf} from './wmpf-bridge.mjs';
import {CdpObserver} from './cdp-observer.mjs';
import {loadTotoroConfig, publicTotoroConfig} from './totoro-config.mjs';
import {TotoroClient} from './totoro-client.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const webRoot = join(root, 'web');
const reportPath = join(root, 'artifacts', 'last-report.json');
const MAX_BODY_BYTES = 16 * 1024;

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

function fail(res, status, code, details = null) {
  sendJson(res, status, {ok: false, code, details});
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

function totoroUnavailable(res, state) {
  return fail(res, 409, state?.error || 'TOTORO_NOT_CONFIGURED');
}

function statusForError(code) {
  if (code === 'JSON_REQUIRED') return 415;
  if (['INVALID_JSON', 'BODY_TOO_LARGE', 'INVALID_TOTORO_SELECTION', 'TOTORO_JOB_ID_REQUIRED'].includes(code)) return 400;
  if (['TOTORO_NOT_CONFIGURED', 'TOTORO_AUTH_REQUIRED', 'TOTORO_NOT_SYNCED', 'TOTORO_PREVIEW_REQUIRED',
    'CDP_NOT_AVAILABLE'].includes(code)) return 409;
  if (code?.startsWith('TOTORO_')) return 502;
  return 500;
}

export function createAppHandler({
  wmpfProbe = probeWmpf,
  cdpObserver = null,
  totoroClient = null,
  totoroState = {configured: false, path: null, config: null, error: null},
} = {}) {
  return async function app(req, res) {
    try {
      if (!validHostHeader(req)) return fail(res, 400, 'LOCAL_HOST_REQUIRED');
      const url = new URL(req.url || '/', 'http://127.0.0.1');

      if (req.method === 'GET' && await serveStatic(url.pathname, res)) return;

      if (req.method === 'GET' && url.pathname === '/api/status') {
        return sendJson(res, 200, {
          ok: true,
          app: 'longmao-local-web',
          mode: 'totoro-sidecar-orchestrator',
          node: process.versions.node,
          platform: process.platform,
          uptimeSeconds: Math.round(process.uptime()),
          bindHost: '127.0.0.1',
          wmpf: await wmpfProbe(),
          cdp: cdpObserver ? cdpObserver.status() : null,
          totoro: {
            config: publicTotoroConfig(totoroState),
            runtime: totoroClient ? totoroClient.state() : null,
          },
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

      if (req.method === 'GET' && url.pathname === '/api/totoro/status') {
        if (!totoroClient) {
          return sendJson(res, 200, {
            ok: true,
            config: publicTotoroConfig(totoroState),
            runtime: null,
            health: null,
            auth: cdpObserver?.status().auth || {present: false},
          });
        }
        return sendJson(res, 200, {
          ok: true,
          config: publicTotoroConfig(totoroState),
          runtime: totoroClient.state(),
          health: await totoroClient.health(),
          auth: cdpObserver?.status().auth || {present: false},
        });
      }

      if (url.pathname.startsWith('/api/totoro') && !totoroClient) return totoroUnavailable(res, totoroState);

      if (req.method === 'POST' && url.pathname === '/api/totoro/sync') {
        const token = cdpObserver?.getToken();
        if (!token) return fail(res, 409, 'TOTORO_AUTH_REQUIRED');
        return sendJson(res, 200, {ok: true, runtime: await totoroClient.sync(token)});
      }

      if (req.method === 'POST' && url.pathname === '/api/totoro/preview') {
        const token = cdpObserver?.getToken();
        if (!token) return fail(res, 409, 'TOTORO_AUTH_REQUIRED');
        const body = await readJsonBody(req);
        if (!exactKeys(body, ['taskId', 'routeId']) || typeof body.taskId !== 'string' ||
            !(typeof body.routeId === 'string' || body.routeId === null)) {
          return fail(res, 400, 'INVALID_TOTORO_SELECTION');
        }
        const runtime = await totoroClient.createPreview(token, {
          taskId: body.taskId,
          routeId: body.routeId || '',
        });
        return sendJson(res, 200, {ok: true, runtime});
      }

      if (req.method === 'POST' && url.pathname === '/api/totoro/start') {
        const token = cdpObserver?.getToken();
        if (!token) return fail(res, 409, 'TOTORO_AUTH_REQUIRED');
        return sendJson(res, 200, {ok: true, runtime: await totoroClient.start(token)});
      }

      if (req.method === 'GET' && url.pathname === '/api/totoro/jobs') {
        const token = cdpObserver?.getToken();
        if (!token) return fail(res, 409, 'TOTORO_AUTH_REQUIRED');
        return sendJson(res, 200, {ok: true, jobs: await totoroClient.jobs(token)});
      }

      if (req.method === 'POST' && url.pathname === '/api/totoro/job-status') {
        const body = await readJsonBody(req);
        if (!exactKeys(body, ['jobId']) || typeof body.jobId !== 'string' || !body.jobId.trim()) {
          return fail(res, 400, 'TOTORO_JOB_ID_REQUIRED');
        }
        return sendJson(res, 200, {ok: true, job: await totoroClient.jobStatus(body.jobId)});
      }

      return fail(res, 404, 'NOT_FOUND');
    } catch (error) {
      const code = error && typeof error.code === 'string' ? error.code : 'LOCAL_WEB_ERROR';
      return fail(res, statusForError(code), code, {
        path: error?.path || null,
        status: error?.status || null,
        message: error?.message && error.message !== code ? error.message : null,
      });
    }
  };
}

export function startCdpAutoConnect(cdpObserver, {intervalMs = 1500} = {}) {
  if (!cdpObserver) return () => {};
  let stopped = false;
  let inFlight = false;

  const attempt = async () => {
    if (stopped || inFlight) return;
    const status = cdpObserver.status();
    if (status.connected || status.state === 'connecting') return;
    inFlight = true;
    try {
      await cdpObserver.connect();
    } catch {
      // WMPF/CDP may not exist yet; the next interval retries automatically.
    } finally {
      inFlight = false;
    }
  };

  const timer = setInterval(attempt, intervalMs);
  timer.unref?.();
  queueMicrotask(attempt);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

export function startWebServer({
  host = '127.0.0.1',
  port = 3210,
  wmpfProbe = probeWmpf,
  cdpObserver = null,
  totoroClient = null,
  totoroState,
} = {}) {
  if (host !== '127.0.0.1') {
    return Promise.reject(Object.assign(new Error('LOOPBACK_BIND_REQUIRED'), {code: 'LOOPBACK_BIND_REQUIRED'}));
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    return Promise.reject(Object.assign(new Error('INVALID_WEB_PORT'), {code: 'INVALID_WEB_PORT'}));
  }

  return new Promise((resolveStart, rejectStart) => {
    const server = createServer(createAppHandler({wmpfProbe, cdpObserver, totoroClient, totoroState}));
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
  const totoroState = await loadTotoroConfig({root});
  const cdpObserver = new CdpObserver({captureConfig: totoroState.config?.capture || null});
  const totoroClient = totoroState.config ? new TotoroClient(totoroState.config) : null;
  const stopCdpAutoConnect = startCdpAutoConnect(cdpObserver);
  const started = await startWebServer({
    port: parseConfiguredPort(process.env.LONGMAO_WEB_PORT),
    cdpObserver,
    totoroClient,
    totoroState,
  });

  console.log(`Longmao Local Web: ${started.url}`);
  if (totoroState.config) {
    console.log(`Totoro sidecar: ${totoroState.config.baseUrl}`);
    console.log(`CDP capture origin: ${totoroState.config.capture.origin}`);
  } else {
    console.log('Totoro sidecar: not configured (copy config/totoro.example.json to config/totoro.json)');
  }
  console.log('Business logic is delegated to Totoro; Longmao only orchestrates WMPF/CDP + Totoro HTTP APIs.');

  const shutdown = () => {
    stopCdpAutoConnect();
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
