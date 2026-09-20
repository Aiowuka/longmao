import {createServer} from 'node:http';
import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runDemo, SCENARIOS} from './lab.mjs';
import {validateSourceManifest} from './provenance.mjs';
import {probeWmpf} from './wmpf-bridge.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const webRoot = join(root, 'web');
const reportPath = join(root, 'artifacts', 'last-report.json');
const MAX_BODY_BYTES = 8192;

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
    const error = new Error('JSON_REQUIRED');
    error.code = 'JSON_REQUIRED';
    throw error;
  }

  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('BODY_TOO_LARGE');
      error.code = 'BODY_TOO_LARGE';
      throw error;
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    const error = new Error('INVALID_JSON');
    error.code = 'INVALID_JSON';
    throw error;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
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

export function createAppHandler({wmpfProbe = probeWmpf} = {}) {
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
          externalSubmission: false,
          credentialCapture: false,
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

      return fail(res, 404, 'NOT_FOUND');
    } catch (error) {
      const code = error && typeof error.code === 'string' ? error.code : 'LOCAL_WEB_ERROR';
      const status = code === 'JSON_REQUIRED' ? 415 :
        ['INVALID_JSON', 'BODY_TOO_LARGE'].includes(code) ? 400 : 500;
      return fail(res, status, code);
    }
  };
}

export function startWebServer({host = '127.0.0.1', port = 3210, wmpfProbe = probeWmpf} = {}) {
  if (host !== '127.0.0.1') {
    return Promise.reject(Object.assign(new Error('LOOPBACK_BIND_REQUIRED'), {code: 'LOOPBACK_BIND_REQUIRED'}));
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    return Promise.reject(Object.assign(new Error('INVALID_WEB_PORT'), {code: 'INVALID_WEB_PORT'}));
  }

  return new Promise((resolveStart, rejectStart) => {
    const server = createServer(createAppHandler({wmpfProbe}));
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
    const error = new Error('INVALID_WEB_PORT');
    error.code = 'INVALID_WEB_PORT';
    throw error;
  }
  return port;
}

async function main() {
  const started = await startWebServer({port: parseConfiguredPort(process.env.LONGMAO_WEB_PORT)});
  console.log(`Longmao Local Web: ${started.url}`);
  console.log('Local-only: mock workflow + WMPF loopback health bridge; no credential capture or external submission.');

  const shutdown = () => started.server.close(() => process.exit(0));
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
