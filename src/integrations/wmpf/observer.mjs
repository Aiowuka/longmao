import {EventEmitter} from 'node:events';
import {sanitize} from './sanitizer.mjs';
import {createHash} from 'node:crypto';

const OBSERVED = /^(Runtime\.(consoleAPICalled|exceptionThrown|executionContextCreated)|Network\.(requestWillBeSent|responseReceived)|Page\.)/;
const TOTORO_ORIGINS = new Set(['https://wxxcx.xtotoro.com', 'https://app.xtotoro.com']);

function validToken(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 16384 && !/\s/.test(value);
}

function tokenFromEvent(event) {
  if (event?.method !== 'Network.requestWillBeSent') return null;
  const request = event.params?.request;
  let url;
  try { url = new URL(request?.url); } catch { return null; }
  if (!TOTORO_ORIGINS.has(url.origin)) return null;
  const authorization = Object.entries(request?.headers || {})
    .find(([name]) => name.toLowerCase() === 'authorization')?.[1];
  const bearer = typeof authorization === 'string' ? authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() : null;
  if (validToken(bearer)) return bearer;
  if (typeof request?.postData === 'string') {
    try {
      const bodyToken = JSON.parse(request.postData)?.token;
      if (validToken(bodyToken)) return bodyToken;
    } catch {}
  }
  return null;
}

export class WmpfObserver extends EventEmitter {
  #client;
  #credentialHashes = new Set();
  credentialPresent = false;

  constructor(client) {
    super();
    this.#client = client;
  }

  start() {
    this.#client.on('event', event => {
      if (!OBSERVED.test(event.method)) return;
      const token = tokenFromEvent(event);
      if (token) {
        const digest = createHash('sha256').update(token).digest('hex');
        if (!this.#credentialHashes.has(digest)) {
          this.#credentialHashes.add(digest);
          this.emit('credential', token);
        }
      }
      const clean = sanitize(event);
      this.credentialPresent ||= clean.credentialPresent;
      this.emit('event', {...clean.value, credentialPresent: clean.credentialPresent});
    });
    this.#client.on('disconnect', () => this.emit('disconnect'));
  }
}
