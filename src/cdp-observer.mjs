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
    authRetryIntervalMs = 1000,
    authRetryAttempts = 60,
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
    this.authRetryIntervalMs = authRetryIntervalMs;
    this.authRetryLimit = authRetryAttempts;
    this.authRetryTimer = null;
    this.authRetryCount = 0;
    this.targetRetryTimer = null;
    this.targetRetryCount = 0;
    this.socket = null;
    this.state = 'disconnected';
    this.instrumented = false;
    if (this.targetRetryTimer) clearTimeout(this.targetRetryTimer);
    if (this.authRetryTimer) clearTimeout(this.authRetryTimer);
    this.targetRetryTimer = null;
    this.authRetryTimer = null;
    this.targetRetryCount = 0;
    this.authRetryCount = 0;
    this.lastError = null;
    this.nextId = 1;
    this.pending = new Map();
    this.pendingResponseBodies = new Map();
    this.timeline = [];
    this.token = null;
    this.currentPage = null;
    this.storageCaptureInFlight = false;
    this.storageKeys = [];
    this.executionContexts = new Map();
    this.wxContextId = null;
    this.wmpfJsContexts = new Map();
    this.wmpfJsContextId = null;
    this.wmpfRoutingAvailable = null;
    this.capabilityMode = 'UNKNOWN';
    this.networkDebugSource = null;
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
      authRetrying: Boolean(this.authRetryTimer),
      authRetryCount: this.authRetryCount,
      authRetryLimit: this.authRetryLimit,
      storageKeys: [...this.storageKeys],
      runtimeContextCount: this.executionContexts.size,
      wxContextId: this.wxContextId,
      wmpfRoutingAvailable: this.wmpfRoutingAvailable,
      wmpfJsContextId: this.wmpfJsContextId,
      wmpfJsContexts: [...this.wmpfJsContexts.values()].map(context => ({...context})),
      capabilityMode: this.capabilityMode,
      networkDebugSource: this.networkDebugSource,
      runtimeAvailable: this.capabilityMode === 'FULL_RUNTIME',
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
    this.authRetryCount = 0;
    if (this.instrumented && this.capabilityMode !== 'NETWORK_ONLY') this._scheduleAuthRetry();
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

  _setCapabilityMode(mode, details = {}) {
    if (this.capabilityMode === mode &&
        (mode !== 'NETWORK_ONLY' || this.networkDebugSource === (details.source || this.networkDebugSource))) {
      return;
    }
    this.capabilityMode = mode;
    if (mode === 'NETWORK_ONLY') {
      this.networkDebugSource = details.source || this.networkDebugSource || 'network-debug';
      if (this.authRetryTimer) clearTimeout(this.authRetryTimer);
      this.authRetryTimer = null;
      this.authRetryCount = 0;
      this.storageKeys = [];
    } else if (mode === 'FULL_RUNTIME') {
      this.networkDebugSource = null;
    }
    this._record({
      kind: 'cdp_capability_mode',
      mode,
      source: details.source || null,
    });
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
    if (this.authRetryTimer) clearTimeout(this.authRetryTimer);
    this.authRetryTimer = null;
    this.authRetryCount = 0;
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
    this.executionContexts.clear();
    this.wxContextId = null;
    this.wmpfJsContexts.clear();
    this.wmpfJsContextId = null;
    this.wmpfRoutingAvailable = null;
    this.capabilityMode = 'UNKNOWN';
    this.networkDebugSource = null;
    this.storageKeys = [];
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
      const captured = await this.captureStoredToken().catch(error => {
        this._record({kind: 'auth_storage_capture_failed', code: error?.code || 'CDP_STORAGE_READ_FAILED'});
        return false;
      });
      if (!captured && !this.token && this.capabilityMode !== 'NETWORK_ONLY') this._scheduleAuthRetry();
    } else {
      this.lastError = 'CDP_TARGET_NOT_RESPONDING';
      this._scheduleInstrumentationRetry();
    }
    return this.status();
  }

  _scheduleAuthRetry() {
    if (this.authRetryTimer || this.token || !this.instrumented || this.state !== 'connected' ||
        this.capabilityMode === 'NETWORK_ONLY') return;
    if (this.authRetryCount >= this.authRetryLimit) return;

    this.authRetryTimer = setTimeout(async () => {
      this.authRetryTimer = null;
      if (this.token || !this.instrumented || this.state !== 'connected' ||
          this.capabilityMode === 'NETWORK_ONLY') return;
      this.authRetryCount += 1;
      this._record({kind: 'auth_storage_retry', attempt: this.authRetryCount, limit: this.authRetryLimit});
      try {
        const captured = await this.captureStoredToken();
        if (!captured && !this.token) this._scheduleAuthRetry();
      } catch (error) {
        this._record({kind: 'auth_storage_capture_failed', code: error?.code || 'CDP_STORAGE_READ_FAILED'});
        this._scheduleAuthRetry();
      }
    }, this.authRetryIntervalMs);
  }

  async _refreshWmpfJsContexts() {
    if (this.wmpfRoutingAvailable === false) return [];
    let result;
    try {
      result = await this.command('Longmao.getJsContexts');
    } catch (error) {
      if (error?.code === 'CDP_COMMAND_ERROR') this.wmpfRoutingAvailable = false;
      return [];
    }

    const contexts = Array.isArray(result?.contexts)
      ? result.contexts
          .filter(item => item && typeof item.id === 'string' && item.id)
          .map(item => ({
            id: item.id,
            name: typeof item.name === 'string' ? item.name : '',
          }))
      : [];

    const before = JSON.stringify([...this.wmpfJsContexts.values()]);
    this.wmpfJsContexts = new Map(contexts.map(context => [context.id, context]));
    this.wmpfRoutingAvailable = true;
    if (typeof result?.activeId === 'string' && result.activeId) {
      this.wmpfJsContextId = result.activeId;
    }
    const after = JSON.stringify(contexts);
    if (before !== after) {
      this._record({
        kind: 'wmpf_jscontexts',
        count: contexts.length,
        contexts: contexts.map(context => ({
          id: context.id,
          name: context.name || null,
        })),
      });
    }
    return contexts;
  }

  async _activateWmpfJsContext(context) {
    if (!context?.id) return false;
    await this.command('Longmao.connectJsContext', {id: context.id});
    this.wmpfRoutingAvailable = true;
    this.wmpfJsContextId = context.id;
    this.executionContexts.clear();
    this.wxContextId = null;
    this.storageKeys = [];
    this._record({
      kind: 'wmpf_jscontext_selected',
      id: context.id,
      name: context.name || null,
    });

    const results = await Promise.allSettled([
      this.command('Runtime.enable'),
      this.command('Network.enable'),
      this.command('Page.enable'),
    ]);
    return results.some(result => result.status === 'fulfilled');
  }

  _contextIds() {
    const ids = [...this.executionContexts.keys()];
    if (Number.isInteger(this.wxContextId)) {
      return [this.wxContextId, ...ids.filter(id => id !== this.wxContextId)];
    }
    return ids;
  }

  async _readWxState(contextId = null) {
    const params = {
      expression: '(() => { try { const hasWx = typeof wx !== "undefined" && typeof wx.getStorageSync === "function"; if (!hasWx) return {hasWx:false, token:"", keys:[]}; const token = String(wx.getStorageSync("token") || ""); const info = typeof wx.getStorageInfoSync === "function" ? wx.getStorageInfoSync() : null; const keys = info && Array.isArray(info.keys) ? info.keys.map(String).slice(0, 100) : []; return {hasWx:true, token, keys}; } catch { return {hasWx:false, token:"", keys:[]}; } })()',
      returnByValue: true,
      awaitPromise: false,
    };
    if (Number.isInteger(contextId)) params.contextId = contextId;
    const result = await this.command('Runtime.evaluate', params);
    const value = result?.result?.value;
    if (!value || typeof value !== 'object' || value.hasWx !== true) return null;
    return {
      contextId: Number.isInteger(contextId) ? contextId : null,
      token: typeof value.token === 'string' ? value.token : '',
      keys: Array.isArray(value.keys)
        ? value.keys.filter(key => typeof key === 'string').slice(0, 100)
        : [],
    };
  }

  async _findWxState() {
    const wmpfContexts = await this._refreshWmpfJsContexts();
    if (this.capabilityMode === 'NETWORK_ONLY' && wmpfContexts.length === 0 &&
        this.executionContexts.size === 0) {
      return null;
    }
    if (wmpfContexts.length > 0) {
      const ordered = [...wmpfContexts].sort((a, b) => {
        if (a.id === this.wmpfJsContextId) return -1;
        if (b.id === this.wmpfJsContextId) return 1;
        return 0;
      });

      for (const context of ordered) {
        try {
          await this._activateWmpfJsContext(context);
          const state = await this._readWxState(null);
          if (!state) continue;
          this.storageKeys = [...state.keys];
          this._setCapabilityMode('FULL_RUNTIME', {source: 'wmpf-jscontext'});
          this._record({
            kind: 'wx_context_found',
            contextId: null,
            jscontextId: context.id,
            name: context.name || null,
            origin: null,
            storageKeyCount: state.keys.length,
          });
          return {...state, jscontextId: context.id};
        } catch (error) {
          this._record({
            kind: 'wmpf_jscontext_probe_failed',
            id: context.id,
            name: context.name || null,
            code: error?.code || 'WMPF_JSCONTEXT_PROBE_FAILED',
          });
        }
      }
    }

    const candidates = this._contextIds();
    if (candidates.length === 0) candidates.push(null);

    for (const contextId of candidates) {
      let state;
      try {
        state = await this._readWxState(contextId);
      } catch (error) {
        this._record({
          kind: 'runtime_context_probe_failed',
          contextId: Number.isInteger(contextId) ? contextId : null,
          code: error?.code || 'CDP_CONTEXT_PROBE_FAILED',
        });
        continue;
      }
      if (!state) continue;

      const changed = this.wxContextId !== state.contextId;
      this.wxContextId = state.contextId;
      this.storageKeys = [...state.keys];
      this._setCapabilityMode('FULL_RUNTIME', {source: 'runtime-context'});
      if (changed || !this.timeline.some(event => event.kind === 'wx_context_found')) {
        const meta = Number.isInteger(state.contextId) ? this.executionContexts.get(state.contextId) : null;
        this._record({
          kind: 'wx_context_found',
          contextId: state.contextId,
          jscontextId: null,
          name: meta?.name || null,
          origin: meta?.origin || null,
          storageKeyCount: state.keys.length,
        });
      }
      return state;
    }
    return null;
  }

  async inspectStorageKeys() {
    if (!this.socket || this.socket.readyState !== 1 || !this.instrumented) return [];
    const state = await this._findWxState();
    return state ? [...state.keys] : [];
  }

  async captureStoredToken() {
    if (this.capabilityMode === 'NETWORK_ONLY' && this.wmpfJsContexts.size === 0 &&
        this.executionContexts.size === 0) return false;
    if (this.storageCaptureInFlight || !this.socket || this.socket.readyState !== 1 || !this.instrumented) {
      return false;
    }
    this.storageCaptureInFlight = true;
    try {
      const state = await this._findWxState();
      if (!state) return false;
      if (state.token.trim()) {
        return this._captureToken(state.token, 'wx-storage:token');
      }
      return false;
    } finally {
      this.storageCaptureInFlight = false;
    }
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

    if (message.method === 'Longmao.networkDebugAvailable') {
      const source = typeof params.source === 'string' ? params.source : 'network-debug';
      if (this.wmpfJsContexts.size === 0 && this.executionContexts.size === 0 && !this.token) {
        this._setCapabilityMode('NETWORK_ONLY', {source});
      }
      this._record({kind: 'network_debug_available', source});
      return true;
    }

    if (message.method === 'Longmao.jsContextAdded') {
      const id = typeof params.id === 'string' ? params.id : '';
      if (id) {
        const context = {id, name: typeof params.name === 'string' ? params.name : ''};
        this.wmpfJsContexts.set(id, context);
        this.wmpfRoutingAvailable = true;
        if (this.capabilityMode === 'NETWORK_ONLY') {
          this.capabilityMode = 'UNKNOWN';
          this.networkDebugSource = null;
          this._record({kind: 'cdp_capability_mode', mode: 'UNKNOWN', source: 'jscontext-added'});
        }
        this._record({kind: 'wmpf_jscontext_added', id, name: context.name || null});
        if (this.instrumented && !this.token) {
          queueMicrotask(() => this.captureStoredToken().catch(() => {}));
        }
      }
      return true;
    }

    if (message.method === 'Longmao.jsContextRemoved') {
      const id = typeof params.id === 'string' ? params.id : '';
      if (id) {
        this.wmpfJsContexts.delete(id);
        if (this.wmpfJsContextId === id) this.wmpfJsContextId = null;
        this._record({kind: 'wmpf_jscontext_removed', id});
      }
      return true;
    }

    if (message.method === 'Longmao.jsContextConnected') {
      const id = typeof params.id === 'string' ? params.id : '';
      if (id) {
        this.wmpfJsContextId = id;
        this.wmpfRoutingAvailable = true;
        this._record({kind: 'wmpf_jscontext_connected', id});
      }
      return true;
    }

    if (message.method === 'Network.requestWillBeSent') {
      const request = params.request || {};
      let observedUrl = null;
      try { observedUrl = new URL(request.url); } catch {}
      if (observedUrl && (observedUrl.protocol === 'https:' || observedUrl.protocol === 'http:')) {
        const matched = Boolean(this.captureConfig && observedUrl.origin === this.captureConfig.origin);
        this._record({
          kind: 'network_seen',
          direction: 'request',
          origin: observedUrl.origin,
          path: observedUrl.pathname,
          method: request.method || null,
          matchedCaptureOrigin: matched,
        });
      }
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
      let observedUrl = null;
      try { observedUrl = new URL(response.url); } catch {}
      if (observedUrl && (observedUrl.protocol === 'https:' || observedUrl.protocol === 'http:')) {
        const matched = Boolean(this.captureConfig && observedUrl.origin === this.captureConfig.origin);
        this._record({
          kind: 'network_seen',
          direction: 'response',
          origin: observedUrl.origin,
          path: observedUrl.pathname,
          status: response.status || null,
          matchedCaptureOrigin: matched,
        });
      }
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

    if (message.method === 'Runtime.executionContextCreated') {
      const context = params.context;
      if (context && Number.isInteger(context.id)) {
        const meta = {
          id: context.id,
          name: typeof context.name === 'string' ? context.name : '',
          origin: typeof context.origin === 'string' ? context.origin : '',
        };
        this.executionContexts.set(context.id, meta);
        this._record({
          kind: 'runtime_context',
          contextId: meta.id,
          name: meta.name || null,
          origin: meta.origin || null,
        });
      }
      if (this.instrumented && !this.token) {
        queueMicrotask(() => this.captureStoredToken().catch(() => {}));
      }
      return true;
    }

    if (message.method === 'Runtime.executionContextDestroyed') {
      const contextId = params.executionContextId;
      if (Number.isInteger(contextId)) {
        this.executionContexts.delete(contextId);
        if (this.wxContextId === contextId) {
          this.wxContextId = null;
          this.storageKeys = [];
        }
      }
      return true;
    }

    if (message.method === 'Runtime.executionContextsCleared') {
      this.executionContexts.clear();
      this.wxContextId = null;
      this.storageKeys = [];
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
