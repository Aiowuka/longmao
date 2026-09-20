import {readFile} from 'node:fs/promises';
import {isAbsolute, join, resolve} from 'node:path';

const HEADER_NAME = /^[A-Za-z0-9-]+$/;

function fail(code, details = {}) {
  throw Object.assign(new Error(code), {code, ...details});
}

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseOrigin(value, {loopbackOnly = false} = {}) {
  if (!nonempty(value)) fail('ORIGIN_REQUIRED');
  let url;
  try {
    url = new URL(value);
  } catch {
    fail('INVALID_ORIGIN');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    fail('INVALID_ORIGIN');
  }
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if (loopbackOnly && !loopback) fail('LOOPBACK_TOTORO_REQUIRED');
  if (!loopback && url.protocol !== 'https:') fail('HTTPS_CAPTURE_ORIGIN_REQUIRED');
  return url.origin;
}

function stringArray(value, code, {max = 8, headerNames = false} = {}) {
  if (!Array.isArray(value) || value.length > max || value.some(item => !nonempty(item))) fail(code);
  if (headerNames && value.some(item => !HEADER_NAME.test(item))) fail(code);
  return Object.freeze([...new Set(value.map(item => item.trim()))]);
}

export function validateTotoroConfig(raw) {
  if (!plain(raw) || raw.schemaVersion !== 1 || !plain(raw.capture)) fail('INVALID_TOTORO_CONFIG');
  const baseUrl = parseOrigin(raw.baseUrl, {loopbackOnly: true});
  const captureOrigin = parseOrigin(raw.capture.origin);

  const pathPrefixes = stringArray(raw.capture.pathPrefixes, 'INVALID_CAPTURE_PATHS');
  if (pathPrefixes.some(prefix => !prefix.startsWith('/') || prefix.includes('..'))) fail('INVALID_CAPTURE_PATHS');

  const requestHeaderNames = stringArray(
    raw.capture.requestHeaderNames,
    'INVALID_CAPTURE_HEADERS',
    {headerNames: true},
  ).map(name => name.toLowerCase());

  const responseJsonPaths = stringArray(raw.capture.responseJsonPaths, 'INVALID_CAPTURE_JSON_PATHS');
  if (responseJsonPaths.some(path => !/^[A-Za-z0-9_$-]+(?:\.[A-Za-z0-9_$-]+)*$/.test(path))) {
    fail('INVALID_CAPTURE_JSON_PATHS');
  }

  return Object.freeze({
    schemaVersion: 1,
    baseUrl,
    capture: Object.freeze({
      origin: captureOrigin,
      pathPrefixes,
      requestHeaderNames: Object.freeze([...requestHeaderNames]),
      responseJsonPaths,
    }),
  });
}

export async function loadTotoroConfig({root, env = process.env} = {}) {
  if (!root) fail('ROOT_REQUIRED');
  const configuredPath = env.LONGMAO_TOTORO_CONFIG;
  const path = configuredPath
    ? (isAbsolute(configuredPath) ? configuredPath : resolve(root, configuredPath))
    : join(root, 'config', 'totoro.json');

  try {
    const raw = JSON.parse(await readFile(path, 'utf8'));
    return {configured: true, path, config: validateTotoroConfig(raw), error: null};
  } catch (error) {
    if (error?.code === 'ENOENT') return {configured: false, path, config: null, error: null};
    return {
      configured: false,
      path,
      config: null,
      error: typeof error?.code === 'string' ? error.code : 'INVALID_TOTORO_CONFIG',
    };
  }
}

export function publicTotoroConfig(state) {
  if (!state?.configured || !state.config) {
    return {configured: false, configPath: state?.path || null, error: state?.error || null};
  }
  return {
    configured: true,
    configPath: state.path,
    error: null,
    baseUrl: state.config.baseUrl,
    captureOrigin: state.config.capture.origin,
    capturePathPrefixes: state.config.capture.pathPrefixes,
    captureHeaderNames: state.config.capture.requestHeaderNames,
    capturesResponseJson: state.config.capture.responseJsonPaths.length > 0,
  };
}
