import net from 'node:net';

export const DEFAULT_WMPF_PORTS = Object.freeze({
  debug: 9421,
  cdp: 62000,
});

function parsePort(value, fallback, name) {
  if (value === undefined || value === null || value === '') return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    const error = new Error('INVALID_LOCAL_PORT');
    error.code = 'INVALID_LOCAL_PORT';
    error.field = name;
    throw error;
  }
  return port;
}

export function resolveWmpfPorts(env = process.env) {
  return Object.freeze({
    debug: parsePort(env.LONGMAO_WMPF_DEBUG_PORT, DEFAULT_WMPF_PORTS.debug, 'LONGMAO_WMPF_DEBUG_PORT'),
    cdp: parsePort(env.LONGMAO_WMPF_CDP_PORT, DEFAULT_WMPF_PORTS.cdp, 'LONGMAO_WMPF_CDP_PORT'),
  });
}

export function probeLoopbackPort(port, {timeoutMs = 700} = {}) {
  const checkedPort = parsePort(port, null, 'port');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 5000) {
    return Promise.reject(Object.assign(new Error('INVALID_TIMEOUT'), {code: 'INVALID_TIMEOUT'}));
  }

  return new Promise(resolve => {
    const startedAt = performance.now();
    let settled = false;
    const socket = net.createConnection({host: '127.0.0.1', port: checkedPort});

    const finish = (reachable, state) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({
        port: checkedPort,
        reachable,
        state,
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      });
    };

    socket.setTimeout(timeoutMs, () => finish(false, 'timeout'));
    socket.once('connect', () => finish(true, 'listening'));
    socket.once('error', error => {
      const state = error && error.code === 'ECONNREFUSED' ? 'closed' : 'unreachable';
      finish(false, state);
    });
  });
}

export async function probeWmpf({ports = resolveWmpfPorts(), timeoutMs = 700} = {}) {
  const [debug, cdp] = await Promise.all([
    probeLoopbackPort(ports.debug, {timeoutMs}),
    probeLoopbackPort(ports.cdp, {timeoutMs}),
  ]);

  return {
    mode: 'loopback-port-probe',
    host: '127.0.0.1',
    ready: debug.reachable && cdp.reachable,
    debug,
    cdp,
    capabilities: {
      readsTraffic: false,
      readsCredentials: false,
      replaysRequests: false,
      startsUpstreamProcess: false,
    },
  };
}
