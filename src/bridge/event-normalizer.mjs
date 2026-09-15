import {createHash} from 'node:crypto';

const SUPPORTED = /^(Runtime\.|Network\.|Page\.)/;

export function normalizeCdpEvent(event) {
  if (!event || typeof event.method !== 'string' || !SUPPORTED.test(event.method)) return null;
  const params = event.params && typeof event.params === 'object' ? event.params : {};
  return {
    type: event.method,
    eventId: String(params.requestId || params.loaderId || params.executionContextId || params.frame?.id ||
      createHash('sha256').update(JSON.stringify([event.method, params])).digest('hex')),
    timestamp: Number.isFinite(params.timestamp) ? params.timestamp : null,
    credentialPresent: event.credentialPresent === true,
    data: params,
  };
}
