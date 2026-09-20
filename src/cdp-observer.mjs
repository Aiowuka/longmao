function makeError(code, details = {}) {
  return Object.assign(new Error(code), {code, ...details});
}

function throwError(code, details = {}) {
  throw makeError(code, details);
}

function getPath(value, path) {
  let current = value;
  for (const segment of path.split('.')) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = current[segment];
  }
  return current;
}

function toText(data) {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
  return String(data);
}

function redactToken(token) {
  if (!token) return {present: false, preview: null, length: 0, source: null, capturedAt: null};
  const head = token.value.slice(0, 4);
  const tail = token.value.length > 8 ? token.value.slice(-4) : '';
  return {
    present: true,
    preview: tail ? `${head}…${tail}` : `${head}…`,
    length: token.value.length,
    source: token.source,
    capturedAt: token.capturedAt,
  };
}

function headerValue(headers, names) {
  if (!headers || typeof headers !== 'object') return null;
  const normalized = new Map(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
  for (const name of names) {
    const value = normalized.get(name.toLowerCase());
    if (typeof value === 'string' && value.trim()) return {name, value: value.trim()};
  }
  return null;
}

function stripAuthPrefix(value) {
  const bearer = /^Bearer\s+(.+)$/i.exec(value);
  return (bearer ? bearer[1] : value).trim();
}

export class CdpObserver {
  constructor({
    captureConfig = null,
    url = 'ws://127.0.0.1:62000',
    wsFactory = null,
    commandTimeoutMs = 2000,
    maxEvents = 300,
    targetRetryIntervalMs = 1000,
    targetRetryAttempts = 30,
  } = {}) {
    this.captureConfig = captureConfig;
    this.url = url;
    this.wsFactory = wsFactory || (target => {
      if (typeof globalThis.WebSocket !== 'function') throwError('WEBSOCKET_UNAVAILABLE');
      return new globalThis.WebSocket(target);
    });
    this.commandTimeoutMs = commandTimeoutMs;
    this.maxEvents = maxEvents;
    this.targetRetryIntervalMs = targetRetryIntervalMs;
    this.targetRetryLimit = targetRetryAttempts;
    this.targetRetryTimer = null;
    this.targetRetryCount = 0;
    this.socket = null;
    this.state = 'disconnected';
    this.instrumented = false;
    if (this.targetRetryTimer) clearTimeout(this.targetRetryTimer);
    this.targetRetryTimer = null;
    this.targetRetryCount = 0;
    this.lastError = null;
    this.nextId = 1;
    this.pending = new Map();
    this.pendingResponseBodies = new Map();
    this.timeline = [];
    this.token = null;
    this.currentPage = null;
  }

  status() {
    return {
      state: this.state,
      connected: this.state === 'connected',
      instrumented: this.instrumented,
      url: this.url,
      currentPage: this.currentPage,
      eventCount: this.timeline.length,
      auth: redactToken(this.token),
      captureOrigin: this.captureConfig?.origin || null,
      lastError: this.lastError,
      filtersActive: Boolean(this.captureConfig),
      targetRetrying: Boolean(this.targetRetryTimer) ||
        (this.state === 'connected' && !this.instrumented &&
          this.targetRetryCount > 0 && this.targetRetryCount < this.targetRetryLimit),
      targetRetryCount: this.targetRetryCount,
      targetRetryLimit: this.targetRetryLimit,
    };
  }

  events(limit = 100) {
    const size = Math.max(1, Math.min(300, Number(limit) || 100));
    return structuredClone(this.timeline.slice(-size).reverse());
  }

  getToken() {
    return this.token?.value || null;
  }

  clearAuth() {
    this.token = null;
    return this.status();
  }

  clearEvents() {
    this.timeline = [];
    return this.status();
  }

  _record(event) {
    this.timeline.push({at: new Date().toISOString(), ...event});
    if (this.timeline.length > this.maxEvents) this.timeline.splice(0, this.timeline.length - this.maxEvents);
  }

  _allowedUrl(rawUrl) {
    if (!this.captureConfig || typeof rawUrl !== 'string') return null;
    try {
      const url = new URL(rawUrl);
      return url.origin === this.captureConfig.origin ? url : null;
    } catch {
      return null;
    }
  }

  _capturePath(url) {
    const prefixes = this.captureConfig.pathPrefixes;
    return prefixes.length === 0 || prefixes.some(prefix => url.pathname.startsWith(prefix));
  }

  _captureToken(value, source) {
    const token = stripAuthPrefix(String(value || ''));
    if (!token || token.length < 8 || token.length > 8192) return false;
    this.token = {value: token, source, capturedAt: new Date().toISOString()};
    this._record({kind: 'auth_captured', source, tokenLength: token.length});
    return true;
  }

  async connect() {
    if (this.socket && this.socket.readyState === 1) {
      await this.instrument();
      return this.status();
    }
    this.disconnect();
    this.state = 'connecting';
    this.lastError = null;

    let socket;
    try {
      socket = this.wsFactory(this.url);
    } catch (error) {
      this.state = 'error';
      this.lastError = error?.code || 'CDP_CONNECT_FAILED';
      throw error;
    }
    this.socket = socket;

    await new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { socket.close(); } catch {}
        reject(makeError('CDP_CONNECT_TIMEOUT'));
      }, this.commandTimeoutMs);

      socket.addEventListener('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      }, {once: true});
      socket.addEventListener('error', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(makeError('CDP_CONNECT_FAILED'));
      }, {once: true});
    }).catch(error => {
      this.state = 'error';
      this.lastError = error?.code || 'CDP_CONNECT_FAILED';
      throw error;
    });

    socket.addEventListener('message', event => this.ingest(event.data));
    socket.addEventListener('close', () => {
      if (this.socket === socket) {
        this.state = 'disconnected';
        this.instrumented = false;
        this.socket = null;
      }
    });
    socket.addEventListener('error', () => {
      this.lastError = 'CDP_SOCKET_ERROR';
    });

    this.state = 'connected';
    this.targetRetryCount = 0;
    this._record({kind: 'cdp_connected'});
    await this.instrument();
    return this.status();
  }

  disconnect() {
    if (this.socket) {
      try { this.socket.close(); } catch {}
    }
    this.socket = null;
    this.state = 'disconnected';
    this.instrumented = false;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(makeError('CDP_DISCONNECTED'));
    }
    this.pending.clear();
    return this.status();
  }

  _scheduleInstrumentationRetry() {
    if (this.targetRetryTimer || this.instrumented || this.state !== 'connected') return;
    if (this.targetRetryCount >= this.targetRetryLimit) return;

    this.targetRetryTimer = setTimeout(async () => {
      this.targetRetryTimer = null;
      if (this.instrumented || this.state !== 'connected') return;
      this.targetRetryCount += 1;
      this._record({
        kind: 'cdp_instrument_retry',
        attempt: this.targetRetryCount,
        limit: this.targetRetryLimit,
      });
      try {
        await this.instrument();
      } catch {}
    }, this.targetRetryIntervalMs);
  }

  async instrument() {
    if (!this.socket || this.socket.readyState !== 1) {
      this.instrumented = false;
      return this.status();
    }
    const results = await Promise.allSettled([
      this.command('Network.enable'),
      this.command('Runtime.enable'),
      this.command('Page.enable'),
    ]);
    this.instrumented = results.every(result => result.status === 'fulfilled');
    if (this.instrumented) {
      this.lastError = null;
      if (this.targetRetryTimer) clearTimeout(this.targetRetryTimer);
      this.targetRetryTimer = null;
      this.targetRetryCount = 0;
      this._record({kind: 'cdp_instrumented'});
    } else {
      this.lastError = 'CDP_TARGET_NOT_RESPONDING';
      this._scheduleInstrumentationRetry();
    }
    return this.status();
  }

  command(method, params = {}) {
    if (!this.socket || this.socket.readyState !== 1) return Promise.reject(makeError('CDP_NOT_CONNECTED'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(makeError('CDP_COMMAND_TIMEOUT', {method}));
      }, this.commandTimeoutMs);
      this.pending.set(id, {resolve, reject, timer, method});
      this.socket.send(JSON.stringify({id, method, params}));
    });
  }

  ingest(raw) {
    let message;
    try {
      message = typeof raw === 'object' && raw !== null && !(raw instanceof ArrayBuffer) && !ArrayBuffer.isView(raw)
        ? raw
        : JSON.parse(toText(raw));
    } catch {
      return false;
    }

    if (Number.isInteger(message.id)) {
      const pending = this.pending.get(message.id);
      if (pending) {
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(makeError('CDP_COMMAND_ERROR', {method: pending.method}));
        else pending.resolve(message.result || {});
      }
      return true;
    }

    const params = message.params || {};
    if (message.method === 'Network.requestWillBeSent') {
      const request = params.request || {};
      const url = this._allowedUrl(request.url);
      if (!url) return true;
      this._record({
        kind: 'request',
        requestId: params.requestId || null,
        method: request.method || null,
        path: url.pathname + url.search,
      });
      if (this._capturePath(url)) {
        const found = headerValue(request.headers, this.captureConfig.requestHeaderNames);
        if (found) this._captureToken(found.value, `request-header:${found.name.toLowerCase()}`);
      }
      return true;
    }

    if (message.method === 'Network.responseReceived') {
      const response = params.response || {};
      const url = this._allowedUrl(response.url);
      if (!url) return true;
      this._record({
        kind: 'response',
        requestId: params.requestId || null,
        status: response.status || null,
        path: url.pathname + url.search,
        mimeType: response.mimeType || null,
      });
      if (params.requestId && this._capturePath(url) && this.captureConfig.responseJsonPaths.length > 0) {
        this.pendingResponseBodies.set(params.requestId, url.href);
      }
      return true;
    }

    if (message.method === 'Network.loadingFinished' && this.pendingResponseBodies.has(params.requestId)) {
      const url = this.pendingResponseBodies.get(params.requestId);
      this.pendingResponseBodies.delete(params.requestId);
      this._captureResponseBody(params.requestId, url).catch(error => {
        this._record({kind: 'auth_body_capture_failed', code: error?.code || 'CDP_BODY_READ_FAILED'});
      });
      return true;
    }

    if (message.method === 'Runtime.consoleAPICalled') {
      this._record({
        kind: 'console',
        level: params.type || 'log',
        argumentCount: Array.isArray(params.args) ? params.args.length : 0,
      });
      return true;
    }

    if (message.method === 'Page.frameNavigated') {
      const frameUrl = params.frame?.url;
      this.currentPage = typeof frameUrl === 'string' && frameUrl ? frameUrl : this.currentPage;
      this._record({kind: 'navigation', url: this.currentPage});
      return true;
    }

    return true;
  }

  async _captureResponseBody(requestId, url) {
    const result = await this.command('Network.getResponseBody', {requestId});
    let body = result.body;
    if (typeof body !== 'string') return false;
    if (result.base64Encoded) body = Buffer.from(body, 'base64').toString('utf8');
    if (body.length > 1024 * 1024) return false;

    let json;
    try {
      json = JSON.parse(body);
    } catch {
      return false;
    }
    for (const path of this.captureConfig.responseJsonPaths) {
      const value = getPath(json, path);
      if (typeof value === 'string' && this._captureToken(value, `response-json:${path}`)) {
        this._record({kind: 'auth_response_matched', path: new URL(url).pathname});
        return true;
      }
    }
    return false;
  }
}
