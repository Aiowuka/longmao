import {readFile} from 'node:fs/promises';
import {isAbsolute, join, resolve} from 'node:path';

const METHODS = new Set(['GET', 'POST']);
const HEADER_NAME = /^[A-Za-z0-9-]+$/;

function error(code, details = {}) {
  return Object.assign(new Error(code), {code, ...details});
}

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeOrigin(value) {
  if (!nonempty(value)) throw error('BACKEND_ORIGIN_REQUIRED');
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw error('INVALID_BACKEND_ORIGIN');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password ||
      parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw error('INVALID_BACKEND_ORIGIN');
  }
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !loopback) throw error('HTTPS_BACKEND_REQUIRED');
  return parsed.origin;
}

function validatePath(path, {allowTemplate = false} = {}) {
  if (!nonempty(path) || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
    throw error('INVALID_BACKEND_PATH');
  }
  const withoutTemplates = allowTemplate ? path.replaceAll('{receiptId}', 'x').replaceAll('{runId}', 'x') : path;
  if (withoutTemplates.includes('{') || withoutTemplates.includes('}') || withoutTemplates.split('/').includes('..')) {
    throw error('INVALID_BACKEND_PATH');
  }
  const parsed = new URL(withoutTemplates, 'https://longmao.invalid');
  if (parsed.origin !== 'https://longmao.invalid') throw error('INVALID_BACKEND_PATH');
  return path;
}

function validateEndpoint(value, name, {required = false, allowTemplate = false} = {}) {
  if (value == null && !required) return null;
  if (!plain(value) || !METHODS.has(value.method) || !nonempty(value.path)) {
    throw error('INVALID_BACKEND_ENDPOINT', {endpoint: name});
  }
  return Object.freeze({
    method: value.method,
    path: validatePath(value.path, {allowTemplate}),
  });
}

function validateStringArray(value, code, {max = 8, headerNames = false} = {}) {
  if (!Array.isArray(value) || value.length > max || value.some(item => !nonempty(item))) throw error(code);
  if (headerNames && value.some(item => !HEADER_NAME.test(item))) throw error(code);
  return Object.freeze([...new Set(value.map(item => item.trim()))]);
}

export function validateBackendConfig(raw) {
  if (!plain(raw) || raw.schemaVersion !== 1) throw error('INVALID_BACKEND_CONFIG');

  const origin = normalizeOrigin(raw.origin);
  const auth = raw.auth;
  if (!plain(auth) || !plain(auth.capture) || !plain(auth.outbound)) throw error('INVALID_BACKEND_AUTH');

  const pathPrefixes = validateStringArray(auth.capture.pathPrefixes, 'INVALID_AUTH_PATH_PREFIXES');
  if (pathPrefixes.some(prefix => !prefix.startsWith('/') || prefix.includes('..'))) {
    throw error('INVALID_AUTH_PATH_PREFIXES');
  }
  const requestHeaderNames = validateStringArray(
    auth.capture.requestHeaderNames,
    'INVALID_AUTH_HEADER_NAMES',
    {headerNames: true},
  ).map(name => name.toLowerCase());
  const responseJsonPaths = validateStringArray(auth.capture.responseJsonPaths, 'INVALID_AUTH_JSON_PATHS');
  if (responseJsonPaths.some(path => !/^[A-Za-z0-9_$-]+(?:\.[A-Za-z0-9_$-]+)*$/.test(path))) {
    throw error('INVALID_AUTH_JSON_PATHS');
  }

  if (!nonempty(auth.outbound.header) || !HEADER_NAME.test(auth.outbound.header) ||
      typeof auth.outbound.prefix !== 'string' || auth.outbound.prefix.length > 32) {
    throw error('INVALID_BACKEND_AUTH');
  }

  if (!plain(raw.endpoints) || !plain(raw.ids)) throw error('INVALID_BACKEND_CONFIG');
  const endpoints = Object.freeze({
    profile: validateEndpoint(raw.endpoints.profile, 'profile'),
    tasks: validateEndpoint(raw.endpoints.tasks, 'tasks'),
    start: validateEndpoint(raw.endpoints.start, 'start', {required: true}),
    submit: validateEndpoint(raw.endpoints.submit, 'submit', {required: true}),
    receipt: validateEndpoint(raw.endpoints.receipt, 'receipt', {allowTemplate: true}),
  });

  const ids = {
    runIdPath: raw.ids.runIdPath,
    receiptIdPath: raw.ids.receiptIdPath,
  };
  for (const [name, value] of Object.entries(ids)) {
    if (!nonempty(value) || !/^[A-Za-z0-9_$-]+(?:\.[A-Za-z0-9_$-]+)*$/.test(value)) {
      throw error('INVALID_BACKEND_ID_PATH', {field: name});
    }
  }

  return Object.freeze({
    schemaVersion: 1,
    origin,
    auth: Object.freeze({
      capture: Object.freeze({
        pathPrefixes,
        requestHeaderNames: Object.freeze([...requestHeaderNames]),
        responseJsonPaths,
      }),
      outbound: Object.freeze({
        header: auth.outbound.header,
        prefix: auth.outbound.prefix,
      }),
    }),
    endpoints,
    ids: Object.freeze(ids),
  });
}

export async function loadBackendConfig({root, env = process.env} = {}) {
  if (!root) throw error('ROOT_REQUIRED');
  const configuredPath = env.LONGMAO_BACKEND_CONFIG;
  const path = configuredPath
    ? (isAbsolute(configuredPath) ? configuredPath : resolve(root, configuredPath))
    : join(root, 'config', 'backend.json');

  try {
    const raw = JSON.parse(await readFile(path, 'utf8'));
    return {configured: true, path, config: validateBackendConfig(raw), error: null};
  } catch (cause) {
    if (cause && cause.code === 'ENOENT') {
      return {configured: false, path, config: null, error: null};
    }
    const code = cause && typeof cause.code === 'string' ? cause.code : 'INVALID_BACKEND_CONFIG';
    return {configured: false, path, config: null, error: code};
  }
}

export function publicBackendConfig(state) {
  if (!state?.configured || !state.config) {
    return {
      configured: false,
      configPath: state?.path || null,
      error: state?.error || null,
    };
  }
  const config = state.config;
  return {
    configured: true,
    configPath: state.path,
    error: null,
    origin: config.origin,
    capturePathPrefixes: config.auth.capture.pathPrefixes,
    captureHeaderNames: config.auth.capture.requestHeaderNames,
    capturesResponseJson: config.auth.capture.responseJsonPaths.length > 0,
    endpoints: Object.fromEntries(
      Object.entries(config.endpoints).map(([name, endpoint]) => [
        name,
        endpoint ? {method: endpoint.method, path: endpoint.path} : null,
      ]),
    ),
  };
}
